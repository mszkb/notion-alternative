import { describe, expect, it } from 'vitest'
import { createZip, readZipCompressed } from './zip'

async function deflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as Uint8Array<ArrayBuffer>])
    .stream()
    .pipeThrough(new CompressionStream('deflate-raw'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

/** Rewrites a stored archive with deflate entries, as other programs write them. */
async function deflateArchive(entries: { path: string; data: Uint8Array }[]): Promise<Uint8Array> {
  const stored = createZip(entries.map((e) => ({ ...e, modified: new Date('2026-01-01') })))
  const out: number[] = []
  const view = new DataView(stored.buffer, stored.byteOffset, stored.byteLength)
  // Rebuild: local headers + data, central directory with method 8 and compressed sizes.
  const central: number[][] = []
  let position = 0
  const files: { offset: number }[] = []
  for (const entry of entries) {
    const name = new TextEncoder().encode(entry.path)
    const packed = await deflateRaw(entry.data)
    const crc = view.getUint32(position + 14, true)
    const header = new Uint8Array(30)
    const h = new DataView(header.buffer)
    h.setUint32(0, 0x04034b50, true)
    h.setUint16(4, 20, true)
    h.setUint16(8, 8, true)
    h.setUint32(14, crc, true)
    h.setUint32(18, packed.length, true)
    h.setUint32(22, entry.data.length, true)
    h.setUint16(26, name.length, true)
    files.push({ offset: out.length })
    out.push(...header, ...name, ...packed)
    const c = new Uint8Array(46)
    const cv = new DataView(c.buffer)
    cv.setUint32(0, 0x02014b50, true)
    cv.setUint16(10, 8, true)
    cv.setUint32(16, crc, true)
    cv.setUint32(20, packed.length, true)
    cv.setUint32(24, entry.data.length, true)
    cv.setUint16(28, name.length, true)
    cv.setUint32(42, files.at(-1)!.offset, true)
    central.push([...c, ...name])
    position += 30 + name.length + entry.data.length
  }
  const centralStart = out.length
  for (const c of central) out.push(...c)
  const end = new Uint8Array(22)
  const ev = new DataView(end.buffer)
  ev.setUint32(0, 0x06054b50, true)
  ev.setUint16(8, entries.length, true)
  ev.setUint16(10, entries.length, true)
  ev.setUint32(12, out.length - centralStart, true)
  ev.setUint32(16, centralStart, true)
  out.push(...end)
  return new Uint8Array(out)
}

describe('readZipCompressed', () => {
  it('reads deflate and stored entries and checks their CRC', async () => {
    const text = new TextEncoder().encode('Hallo '.repeat(1000))
    const archive = await deflateArchive([
      { path: 'Seite 0123456789abcdef0123456789abcdef.md', data: text },
      { path: 'Ordner/bild.png', data: new Uint8Array([1, 2, 3]) },
    ])
    expect(archive.length).toBeLessThan(text.length)
    const files = await readZipCompressed(archive)
    expect(files.map((f) => f.path)).toEqual([
      'Seite 0123456789abcdef0123456789abcdef.md',
      'Ordner/bild.png',
    ])
    expect(new TextDecoder().decode(files[0]!.data)).toBe('Hallo '.repeat(1000))
  })

  it('refuses archives that unpack beyond the limit', async () => {
    const archive = await deflateArchive([{ path: 'a.md', data: new Uint8Array(10_000) }])
    await expect(readZipCompressed(archive, 1000)).rejects.toThrow(/too large/)
  })

  it('rejects data that is not a ZIP archive', async () => {
    await expect(readZipCompressed(new TextEncoder().encode('kein zip'))).rejects.toThrow(
      /Not a ZIP archive/,
    )
  })
})
