import { readFile, stat } from 'node:fs/promises'
import { Inflate } from 'fflate'

const MAX_ZIP_BYTES = 200 * 1024 * 1024
const MAX_BYTES = 400 * 1024 * 1024
const MAX_FILES = 2048

/** 使用所有平台都明确支持的相对路径，避免 Windows 别名与 ADS。 */
export function validateThemePath(path: string): string {
  const parts = path.split('/')
  if (!path || parts.some(part => !part || part === '.' || part === '..'
    || /[\\:\x00-\x1f<>"|?*]/.test(part) || /[. ]$/.test(part)
    || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) {
    throw new Error('主题资源路径无效或越界')
  }
  return path
}

const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
  return value >>> 0
})
function crc32(data: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of data) crc = crcTable[(crc ^ byte) & 255]! ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

/** 先核对 ZIP 目录，再分块解压；限制同时覆盖声明大小与实际输出。 */
export async function readStartupThemeArchive(
  zipPath: string,
  limits: { maxBytes?: number; maxFiles?: number } = {},
): Promise<Map<string, Uint8Array>> {
  if ((await stat(zipPath)).size > MAX_ZIP_BYTES) throw new Error('主题 ZIP 大小超过 200 MiB')
  const data = await readFile(zipPath)
  if (data.length > MAX_ZIP_BYTES) throw new Error('主题 ZIP 大小超过 200 MiB')
  const maxBytes = limits.maxBytes ?? MAX_BYTES
  const maxFiles = limits.maxFiles ?? MAX_FILES
  let end = data.length - 22
  while (end >= Math.max(0, data.length - 65557)) {
    if (data.readUInt32LE(end) === 0x06054b50 && end + 22 + data.readUInt16LE(end + 20) === data.length) break
    end--
  }
  if (end < 0 || end < data.length - 65557) throw new Error('ZIP 目录无效')
  const count = data.readUInt16LE(end + 10)
  if (count > maxFiles) throw new Error('主题文件或目录数量超过限制')
  const centralSize = data.readUInt32LE(end + 12)
  const centralStart = data.readUInt32LE(end + 16)
  if (data.readUInt16LE(end + 4) !== 0 || data.readUInt16LE(end + 6) !== 0
    || data.readUInt16LE(end + 8) !== count || count === 65535
    || centralStart + centralSize !== end) throw new Error('不支持多卷或 ZIP64 主题包')
  const result = new Map<string, Uint8Array>()
  const names = new Set<string>()
  const ranges: [number, number][] = []
  const decoder = new TextDecoder('utf-8', { fatal: true })
  let cursor = centralStart, total = 0, declared = 0
  for (let index = 0; index < count; index++) {
    if (cursor + 46 > end || data.readUInt32LE(cursor) !== 0x02014b50) throw new Error('ZIP 文件目录损坏')
    const flags = data.readUInt16LE(cursor + 8), method = data.readUInt16LE(cursor + 10)
    const crc = data.readUInt32LE(cursor + 16), compressed = data.readUInt32LE(cursor + 20), size = data.readUInt32LE(cursor + 24)
    const nameLength = data.readUInt16LE(cursor + 28), extraLength = data.readUInt16LE(cursor + 30), commentLength = data.readUInt16LE(cursor + 32)
    const attrs = data.readUInt32LE(cursor + 38), offset = data.readUInt32LE(cursor + 42)
    const next = cursor + 46 + nameLength + extraLength + commentLength
    if (next > end || compressed === 0xffffffff || size === 0xffffffff || offset === 0xffffffff) throw new Error('ZIP 条目无效或使用 ZIP64')
    if ((flags & 1) !== 0 || ![0, 8].includes(method)) throw new Error('不支持加密或此压缩方式的主题包')
    const rawName = data.subarray(cursor + 46, cursor + 46 + nameLength)
    const name = decoder.decode(rawName), directory = name.endsWith('/')
    validateThemePath(directory ? name.slice(0, -1) : name)
    const key = name.replace(/\/$/, '').normalize('NFC').toLowerCase()
    if (names.has(key)) throw new Error('ZIP 包包含重复资源路径')
    names.add(key)
    const mode = (attrs >>> 16) & 0xf000
    if (mode !== 0 && mode !== 0x8000 && mode !== 0x4000) throw new Error('主题包不允许链接或特殊文件')
    if (data.readUInt16LE(cursor + 34) !== 0 || offset + 30 > centralStart || data.readUInt32LE(offset) !== 0x04034b50) throw new Error('ZIP 本地头无效')
    const localNameLength = data.readUInt16LE(offset + 26), localExtraLength = data.readUInt16LE(offset + 28)
    const start = offset + 30 + localNameLength + localExtraLength
    if (start + compressed > centralStart || !data.subarray(offset + 30, offset + 30 + localNameLength).equals(rawName)
      || data.readUInt16LE(offset + 6) !== flags || data.readUInt16LE(offset + 8) !== method
      || ((flags & 8) === 0 && (data.readUInt32LE(offset + 14) !== crc || data.readUInt32LE(offset + 18) !== compressed || data.readUInt32LE(offset + 22) !== size))) {
      throw new Error('ZIP 本地头与目录不一致')
    }
    ranges.push([offset, start + compressed])
    cursor = next
    if (directory) { if (size !== 0) throw new Error('ZIP 目录内容无效'); continue }
    if (result.size >= maxFiles) throw new Error('主题文件数量超过限制')
    declared += size
    if (declared > maxBytes) throw new Error('主题解压大小超过限制')
    const chunks: Uint8Array[] = []
    let actual = 0
    const accept = (chunk: Uint8Array) => {
      actual += chunk.length
      total += chunk.length
      if (actual > size || total > maxBytes) throw new Error('主题实际解压大小超过限制或与目录不一致')
      chunks.push(chunk)
    }
    if (method === 0) accept(data.subarray(start, start + compressed))
    else {
      const inflater = new Inflate(chunk => accept(chunk))
      for (let pos = 0; pos < compressed; pos += 16384) {
        inflater.push(data.subarray(start + pos, start + Math.min(pos + 16384, compressed)), pos + 16384 >= compressed)
      }
    }
    const output = Buffer.concat(chunks, actual)
    if (actual !== size || crc32(output) !== crc) throw new Error('主题文件大小或 CRC 校验失败')
    result.set(name, output)
  }
  if (cursor !== end) throw new Error('ZIP 目录数量不一致')
  ranges.sort((a, b) => a[0] - b[0])
  for (let index = 1; index < ranges.length; index++) {
    if (ranges[index]![0] < ranges[index - 1]![1]) throw new Error('ZIP 条目数据重叠')
  }
  for (const name of result.keys()) {
    const parts = name.split('/')
    parts.pop()
    while (parts.length) {
      if ([...result.keys()].some(other => other.toLowerCase() === parts.join('/').toLowerCase())) throw new Error('ZIP 文件与目录路径冲突')
      parts.pop()
    }
  }
  return result
}
