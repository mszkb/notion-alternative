import { describe, expect, it } from 'vitest'
import { crc32, createZip, readZip } from './zip'

describe('zip', () => {
  it('computes the standard CRC-32', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926)
  })

  it('round-trips entries with UTF-8 names and binary data', () => {
    const binary = new Uint8Array([0, 1, 2, 255, 254])
    const archive = createZip([
      { path: 'Übersicht.md', data: '# Hallo ✓\n' },
      { path: 'ordner/bild.png', data: binary },
      { path: 'leer.txt', data: '' },
    ])
    const files = readZip(archive)
    expect(files.map((f) => f.path)).toEqual(['Übersicht.md', 'ordner/bild.png', 'leer.txt'])
    expect(new TextDecoder().decode(files[0]!.data)).toBe('# Hallo ✓\n')
    expect(Array.from(files[1]!.data)).toEqual([0, 1, 2, 255, 254])
    expect(files[2]!.data.length).toBe(0)
  })

  it('detects corrupted content', () => {
    const archive = createZip([{ path: 'a.txt', data: 'abc' }])
    archive[30 + 'a.txt'.length] = 'x'.charCodeAt(0)
    expect(() => readZip(archive)).toThrow(/CRC/)
  })
})
