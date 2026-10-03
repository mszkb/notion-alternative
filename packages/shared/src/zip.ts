/**
 * Minimal ZIP archive (PKWARE APPNOTE): entries are stored uncompressed, names in UTF-8.
 * Enough for exports (ADR 0004) without a dependency; every unzip tool reads it.
 * No ZIP64, so the archive is limited to 4 GB and 65535 entries.
 */

export interface ZipEntry {
  /** Path inside the archive, `/`-separated, no leading slash. */
  path: string
  data: Uint8Array | string
  modified?: Date
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

export function crc32(data: Uint8Array): number {
  let crc = 0xffffffff
  for (let i = 0; i < data.length; i++) crc = CRC_TABLE[(crc ^ data[i]!) & 0xff]! ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function dosDateTime(date: Date): { time: number; date: number } {
  const year = Math.max(1980, date.getFullYear())
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  }
}

const UTF8_FLAG = 0x0800
const MAX_32 = 0xffffffff

export function createZip(entries: ZipEntry[]): Uint8Array {
  const parts = createZipParts(entries)
  const result = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
  let position = 0
  for (const part of parts) {
    result.set(part, position)
    position += part.length
  }
  return result
}

/**
 * The archive as a list of byte ranges that reference the entry data without copying it;
 * `new Blob(parts)` builds the file without holding it twice in memory.
 */
export function createZipParts(entries: ZipEntry[]): Uint8Array[] {
  if (entries.length > 0xffff) throw new Error('Too many entries for a ZIP archive')
  const encoder = new TextEncoder()
  const locals: Uint8Array[] = []
  const centrals: Uint8Array[] = []
  let offset = 0

  for (const entry of entries) {
    const name = encoder.encode(entry.path)
    const data = typeof entry.data === 'string' ? encoder.encode(entry.data) : entry.data
    const crc = crc32(data)
    const { time, date } = dosDateTime(entry.modified ?? new Date())
    if (data.length > MAX_32 || offset > MAX_32) throw new Error('ZIP archive too large')

    const local = new Uint8Array(30 + name.length)
    const lv = new DataView(local.buffer)
    lv.setUint32(0, 0x04034b50, true)
    lv.setUint16(4, 20, true) // version needed
    lv.setUint16(6, UTF8_FLAG, true)
    lv.setUint16(8, 0, true) // stored
    lv.setUint16(10, time, true)
    lv.setUint16(12, date, true)
    lv.setUint32(14, crc, true)
    lv.setUint32(18, data.length, true)
    lv.setUint32(22, data.length, true)
    lv.setUint16(26, name.length, true)
    lv.setUint16(28, 0, true)
    local.set(name, 30)
    locals.push(local, data)

    const central = new Uint8Array(46 + name.length)
    const cv = new DataView(central.buffer)
    cv.setUint32(0, 0x02014b50, true)
    cv.setUint16(4, 20, true) // version made by
    cv.setUint16(6, 20, true)
    cv.setUint16(8, UTF8_FLAG, true)
    cv.setUint16(10, 0, true)
    cv.setUint16(12, time, true)
    cv.setUint16(14, date, true)
    cv.setUint32(16, crc, true)
    cv.setUint32(20, data.length, true)
    cv.setUint32(24, data.length, true)
    cv.setUint16(28, name.length, true)
    cv.setUint32(42, offset, true)
    central.set(name, 46)
    centrals.push(central)

    offset += local.length + data.length
  }

  const centralSize = centrals.reduce((sum, c) => sum + c.length, 0)
  if (offset + centralSize > MAX_32) throw new Error('ZIP archive too large')
  const end = new Uint8Array(22)
  const ev = new DataView(end.buffer)
  ev.setUint32(0, 0x06054b50, true)
  ev.setUint16(8, entries.length, true)
  ev.setUint16(10, entries.length, true)
  ev.setUint32(12, centralSize, true)
  ev.setUint32(16, offset, true)

  return [...locals, ...centrals, end]
}

export interface ZipFile {
  path: string
  data: Uint8Array
}

/** Rejects names that would escape a target folder or are ambiguous (zip slip). */
function checkEntryPath(path: string): void {
  const segments = path.split('/')
  if (
    !path ||
    path.startsWith('/') ||
    path.includes('\\') ||
    path.includes('\0') ||
    /^[a-zA-Z]:/.test(path) ||
    segments.some((s) => s === '..' || s === '.')
  ) {
    throw new Error(`Unsafe path in ZIP archive: ${JSON.stringify(path)}`)
  }
}

/**
 * Reads a ZIP archive with stored entries (as written by `createZip`); compressed entries
 * are rejected, so the content can never be larger than the archive (no zip bombs). Checks
 * bounds, paths (no zip slip), duplicates and the CRC of every entry.
 */
export function readZip(archive: Uint8Array): ZipFile[] {
  const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength)
  const fail = (reason: string): never => {
    throw new Error(reason)
  }
  let endOffset = -1
  for (let i = archive.length - 22; i >= Math.max(0, archive.length - 22 - 0xffff); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      endOffset = i
      break
    }
  }
  if (endOffset < 0) fail('Not a ZIP archive')
  const count = view.getUint16(endOffset + 10, true)
  let position = view.getUint32(endOffset + 16, true)
  const within = (offset: number, length: number) => offset + length <= archive.length
  const decoder = new TextDecoder('utf-8', { fatal: true })
  const files: ZipFile[] = []
  const seen = new Set<string>()
  for (let i = 0; i < count; i++) {
    if (!within(position, 46) || view.getUint32(position, true) !== 0x02014b50) {
      fail('Corrupt ZIP directory')
    }
    const flags = view.getUint16(position + 8, true)
    const method = view.getUint16(position + 10, true)
    const crc = view.getUint32(position + 16, true)
    const compressed = view.getUint32(position + 20, true)
    const size = view.getUint32(position + 24, true)
    const nameLength = view.getUint16(position + 28, true)
    const extraLength = view.getUint16(position + 30, true)
    const commentLength = view.getUint16(position + 32, true)
    const localOffset = view.getUint32(position + 42, true)
    if (!within(position + 46, nameLength)) fail('Corrupt ZIP directory')
    let path = ''
    try {
      path = decoder.decode(archive.subarray(position + 46, position + 46 + nameLength))
    } catch {
      fail('Invalid file name in ZIP archive')
    }
    checkEntryPath(path)
    if (seen.has(path)) fail(`Duplicate entry in ZIP archive: ${path}`)
    seen.add(path)
    if (method !== 0 || compressed !== size) fail(`Unsupported compression in ${path}`)
    if (flags & 0x1) fail(`Encrypted entry in ${path}`)
    if (!within(localOffset, 30) || view.getUint32(localOffset, true) !== 0x04034b50) {
      fail(`Corrupt entry ${path}`)
    }
    const localNameLength = view.getUint16(localOffset + 26, true)
    const localExtraLength = view.getUint16(localOffset + 28, true)
    const start = localOffset + 30 + localNameLength + localExtraLength
    if (!within(start, size)) fail(`Entry ${path} exceeds the archive`)
    const data = archive.slice(start, start + size)
    if (crc32(data) !== crc) fail(`CRC mismatch in ${path}`)
    if (!path.endsWith('/')) files.push({ path, data })
    position += 46 + nameLength + extraLength + commentLength
  }
  return files
}
