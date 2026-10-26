import crypto from 'node:crypto'
import path from 'node:path'

const RESERVED_DEVICE = /^(?:con|prn|aux|nul|clock\$|conin\$|conout\$|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i
const MAX_NAME_BYTES = 200 // Leave room for .part and .segments-cache on every target filesystem.

function trimToBytes(value: string, budget: number): string {
  let result = '', bytes = 0
  for (const character of value) {
    const length = Buffer.byteLength(character)
    if (bytes + length > budget) break
    result += character
    bytes += length
  }
  return result
}

/**
 * Provider filenames are labels, never paths or encoded URLs. Keep legal names
 * byte-for-byte; make only the local destination portable, with a stable suffix
 * so distinct invalid labels cannot overwrite one another after replacement.
 */
export function downloadFileName(input: string): string {
  const original = String(input ?? '')
  if (/[\\/]/.test(original) || /^\.{1,2}$/.test(original.trim())) {
    throw new Error('下载文件名不能包含目录或路径跳转')
  }
  if (!original) return 'download.bin'
  let safe = original.replace(/[<>:"|?*\u0000-\u001f\u007f]/g, '_').replace(/[. ]+$/, '')
  if (!safe) safe = 'download'
  // Windows also reserves device names before extensions and with spaces before the dot.
  if (RESERVED_DEVICE.test(safe.split('.')[0].trimEnd())) safe = '_' + safe
  if (safe === original && Buffer.byteLength(safe) <= MAX_NAME_BYTES) return safe
  const digest = crypto.createHash('sha256').update(original).digest('hex').slice(0, 12)
  const candidateExtension = path.extname(safe)
  const extension = Buffer.byteLength(candidateExtension) <= 32 ? candidateExtension : ''
  const suffix = '-' + digest + extension
  const stem = extension ? safe.slice(0, -extension.length) : safe
  return (trimToBytes(stem, MAX_NAME_BYTES - Buffer.byteLength(suffix)).replace(/[. ]+$/, '') || 'download') + suffix
}
