import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import AdmZip from 'adm-zip'
import { withFileJob } from './fileJobs'
import { protectModChange } from './changeProtection'
import { isModLocked } from './modState'
import { externalGameUsesDirectory } from './gameDirectoryUse'

const sha = (bytes: Buffer, algorithm = 'sha256') => crypto.createHash(algorithm).update(bytes).digest('hex')
// Exact payload of our released 1.0.0, independent of ZIP timestamps/JAR manifest
// build-JDK. Never replace a similarly named third-party or user-modified bridge.
const OLD_PAYLOAD = '730041b722253efb70c4e29f33c7d4e954fc0228ba24168c61bce1c6ba51c442'
export function bridgePayload(bytes: Buffer): string {
  const hash = crypto.createHash('sha256')
  const entries = new AdmZip(bytes).getEntries().filter(e => !e.isDirectory && e.entryName !== 'META-INF/MANIFEST.MF')
  if (entries.length > 100 || entries.some(e => e.header.size > 256 * 1024)) return ''
  const metadata = entries.find(e => e.entryName === 'fabric.mod.json')
  if (!metadata) return ''
  const info = JSON.parse(metadata.getData().toString('utf8'))
  if (info.id !== 'kamucl-bridge' || info.version !== '1.0.0') return ''
  for (const e of entries.sort((a, b) => a.entryName.localeCompare(b.entryName, 'en'))) {
    hash.update(e.entryName).update('\0').update(sha(e.getData())).update('\n')
  }
  return hash.digest('hex')
}

/** Called before creating the JVM, only for a stock bridge already installed. */
export async function upgradeInstalledBridge(gameDirectory: string, bundled: string): Promise<string[]> {
  const dir = path.join(gameDirectory, 'mods'), messages: string[] = []
  if (!fs.existsSync(dir)) return messages
  if (fs.lstatSync(dir).isSymbolicLink()) return ['桥接修复未执行：mods 是链接目录，请手动更新桥接 MOD']
  return withFileJob(dir, undefined, async () => {
    for (const name of await fs.promises.readdir(dir)) {
      if (!/\.jar$/i.test(name)) continue // Preserve explicitly disabled files.
      const file = path.join(dir, name), stat = await fs.promises.lstat(file)
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 128 * 1024) continue
      const old = await fs.promises.readFile(file)
      try { if (bridgePayload(old) !== OLD_PAYLOAD) continue } catch { continue }
      const oldSha1 = sha(old, 'sha1')
      if (isModLocked(dir, oldSha1)) { messages.push('旧桥接 MOD 已锁定，请解锁后重新启动以修复退出占用'); continue }
      if (await externalGameUsesDirectory(gameDirectory)) { messages.push('同目录游戏仍在运行，桥接退出修复将在全部退出后的下次启动应用'); continue }
      const next = await fs.promises.readFile(bundled)
      const metadata = JSON.parse(new AdmZip(next).readAsText('fabric.mod.json'))
      if (metadata.id !== 'kamucl-bridge' || metadata.version !== '1.0.1') throw new Error('内置桥接修复文件版本不匹配')
      await protectModChange(dir, [name], '桥接退出占用修复前')
      if (await externalGameUsesDirectory(gameDirectory) || isModLocked(dir, oldSha1)) throw new Error('桥接修复前目录占用或锁定状态发生变化')
      const temp = path.join(dir, '.kamucl-bridge-' + crypto.randomUUID() + '.tmp')
      try {
        await fs.promises.writeFile(temp, next, { flag: 'wx' })
        await fs.promises.chmod(temp, stat.mode)
        if (sha(await fs.promises.readFile(temp)) !== sha(next)) throw new Error('桥接修复文件校验失败')
        const current = await fs.promises.lstat(file)
        if (!current.isFile() || current.isSymbolicLink() || sha(await fs.promises.readFile(file)) !== sha(old)) throw new Error('桥接文件已变化，保留当前文件')
        // Atomic replacement; an occupied file leaves the original in place.
        await fs.promises.rename(temp, file)
        messages.push('已保护并更新内置桥接 MOD 至 1.0.1，修复退出后的后台线程占用')
      } finally { await fs.promises.rm(temp, { force: true }) }
    }
    return messages
  })
}
