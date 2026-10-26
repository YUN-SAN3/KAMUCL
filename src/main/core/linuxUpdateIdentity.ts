import fs from 'node:fs'
import { createGunzip } from 'node:zlib'
export function assertLinuxElf(bytes: Uint8Array, arch: string = process.arch): void {
  const b = Buffer.from(bytes)
  if (!['x64', 'arm64'].includes(arch) || b.length < 20 || b.toString('binary', 0, 4) !== '\x7fELF' || b[4] !== 2 || b[5] !== 1 || b.readUInt16LE(18) !== (arch === 'arm64' ? 183 : 62)) throw Error('Linux 可执行文件不是当前架构的 64 位 ELF')
}
export function linuxTarHeader(header: Buffer): { name: string; size: number; directory: boolean } | null {
  if (header.length !== 512) throw Error('Linux 更新 TAR 头被截断')
  if (header.every(value => value === 0)) return null
  const number = (start: number, count: number) => {
    const value = header.toString('ascii', start, start + count).replace(/\0/g, '').trim()
    if (!/^[0-7]+$/.test(value)) throw Error('Linux TAR 数值无效')
    return parseInt(value, 8)
  }
  const sum = header.reduce((n, b, i) => n + (i >= 148 && i < 156 ? 32 : b), 0)
  if (number(148, 8) !== sum || header.toString('ascii', 257, 262) !== 'ustar') throw Error('Linux TAR 格式或头校验失败')
  const text = (start: number, count: number) => header.toString('utf8', start, start + count).split('\0')[0]
  const prefix = text(345, 155), name = (prefix ? prefix + '/' : '') + text(0, 100)
  const kind = header[156], size = number(124, 12)
  if (!['KAMUCL', 'KAMUCL/'].includes(name) && !name.startsWith('KAMUCL/')) throw Error('Linux 更新包必须使用 KAMUCL 根目录')
  if (name.includes('\\') || /[\x00-\x1f\x7f]/.test(name) || name.replace(/\/$/, '').split('/').some(p => !p || p === '..' || p === '.') || name.startsWith('/') || !Number.isSafeInteger(size) || size > 2 * 1024 ** 3 || ![0, 48, 53].includes(kind)) throw Error('Linux 更新 TAR 包含越界路径、链接或特殊文件')
  if (['KAMUCL', 'KAMUCL/'].includes(name) && kind !== 53) throw Error('Linux TAR 根目录类型无效')
  if (kind === 53 && size !== 0) throw Error('Linux TAR 目录大小无效')
  return { name: name.replace(/\/$/, ''), size, directory: kind === 53 }
}
/** The release uses USTAR regular files/directories only. Never delegate path validation to tar. */
export async function validateLinuxArchive(file: string): Promise<void> {
  const input = fs.createReadStream(file), unzip = input.pipe(createGunzip()), seen = new Set<string>()
  input.once('error', error => unzip.destroy(error))
  let pending = Buffer.alloc(0), remaining = 0, total = 0, ended = false, zeros = 0
  try {
    for await (const chunk of unzip) {
      pending = Buffer.concat([pending, chunk])
      while (pending.length) {
        if (remaining) { const count = Math.min(remaining, pending.length); pending = pending.subarray(count); remaining -= count; continue }
        if (pending.length < 512) break
        const header = pending.subarray(0, 512); pending = pending.subarray(512)
        const entry = linuxTarHeader(header)
        if (!entry) { zeros++; ended = true; continue }
        if (ended) throw Error('Linux TAR 结束标记后存在额外内容')
        if (seen.has(entry.name)) throw Error('Linux TAR 包含重复目标')
        seen.add(entry.name); total += entry.size
        if (seen.size > 20000 || total > 3 * 1024 ** 3) throw Error('Linux 更新解压大小异常')
        remaining = Math.ceil(entry.size / 512) * 512
      }
    }
    if (remaining || pending.length || zeros < 2 || !seen.has('KAMUCL/resources/app.asar') || !seen.has('KAMUCL/resources/kamucl-linux.json') || !seen.has('KAMUCL/kamucl')) throw Error('Linux 更新包被截断或缺少应用文件')
  } finally { input.destroy(); unzip.destroy() }
}
export function assertLinuxManifest(raw: string, version: string, kind: string, arch = process.arch): void {
  const info = JSON.parse(raw)
  if (info.product !== 'KAMUCL' || info.platform !== 'linux' || info.arch !== arch || info.version !== version || info.installationKind !== kind) throw Error('Linux 更新包身份、版本或架构不匹配')
}
