/** 服务器：启动器记录、servers.dat 只读同步与 MC Server List Ping。 */
import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import net from 'node:net'
import dns from 'node:dns/promises'
import crypto from 'node:crypto'
import type {
  InstalledVersion,
  ServerEntry,
  ServerLaunchPreparation,
  ServerPingResult,
  ServerSyncResult
} from '../../shared/types'
import { parseNbt, buildServersDat } from './nbt'
import { logScope } from './launcherLog'

const serverLog = logScope('servers')
import { listAllInstalled } from './versions'
import { setActiveGameFolder } from './gameFolders'
import { canonicalPath, pathIdentity } from './folderPaths'
import { editedServers } from './serverEditing'
import {
  parseServerAddress,
  serverAssociationKey,
  supportsQuickPlayMultiplayer
} from './serverUtils'

function storeFile(): string {
  return path.join(app.getPath('userData'), 'servers.json')
}

export function listServers(): ServerEntry[] {
  try {
    const raw = JSON.parse(fs.readFileSync(storeFile(), 'utf-8'))
    if (!Array.isArray(raw)) return []
    const result: ServerEntry[] = []
    for (const value of raw) {
      if (!value || typeof value !== 'object') continue
      const old = value as Partial<ServerEntry>
      try {
        const parsed = parseServerAddress(String(old.address ?? ''))
        const entry: ServerEntry = {
          id: typeof old.id === 'string' && old.id ? old.id : crypto.randomUUID(),
          name: typeof old.name === 'string' && old.name.trim() ? old.name.trim() : parsed.address,
          address: parsed.address,
          normalizedAddress: parsed.normalizedAddress,
          host: parsed.host,
          port: parsed.port
        }
        if (old.versionId) entry.versionId = String(old.versionId)
        if (old.folder) entry.folder = canonicalPath(String(old.folder))
        if (old.minecraftVersion) entry.minecraftVersion = String(old.minecraftVersion)
        if (old.loader && ['forge', 'fabric', 'quilt', 'neoforge'].includes(old.loader)) {
          entry.loader = old.loader
        }
        if (old.loaderVersion) entry.loaderVersion = String(old.loaderVersion)
        if (old.lastUsedAt) entry.lastUsedAt = String(old.lastUsedAt)
        if (old.lastSeenAt) entry.lastSeenAt = String(old.lastSeenAt)
        if (old.source === 'minecraft' || old.source === 'launcher') entry.source = old.source
        if (Array.isArray(old.candidateVersionIds)) {
          entry.candidateVersionIds = [...new Set(old.candidateVersionIds.map(String))]
        }
        if (old.sourceGameDirectory) {
          entry.sourceGameDirectory = canonicalPath(String(old.sourceGameDirectory))
        }
        result.push(entry)
      } catch {
        // 旧记录若已损坏则不让它阻断整个服务器页。
      }
    }
    return result
  } catch {
    return []
  }
}

function persist(list: ServerEntry[]): void {
  fs.mkdirSync(path.dirname(storeFile()), { recursive: true })
  fs.writeFileSync(storeFile(), JSON.stringify(list, null, 2), 'utf-8')
}

export function addServer(name: string, address: string): ServerEntry[] {
  const n = name.trim()
  if (!n) throw new Error('服务器名称不能为空')
  const parsed = parseServerAddress(address)
  const list = listServers()
  if (
    list.some(
      (server) =>
        !server.versionId &&
        (server.normalizedAddress ?? parseServerAddress(server.address).normalizedAddress) ===
          parsed.normalizedAddress
    )
  ) {
    throw new Error('该服务器已在未绑定列表中')
  }
  list.push({
    id: crypto.randomUUID(),
    name: n,
    address: parsed.address,
    normalizedAddress: parsed.normalizedAddress,
    host: parsed.host,
    port: parsed.port,
    source: 'launcher'
  })
  persist(list)
  return list
}

export function removeServer(id: string): ServerEntry[] {
  const list = listServers().filter((s) => s.id !== id)
  persist(list)
  return list
}

/** 只编辑启动器记录，不写入用户游戏的 servers.dat。 */
export function editServer(id: string, name: string, address: string): ServerEntry[] {
  const list = editedServers(listServers(), id, name, address)
  persist(list)
  return list
}

// ---------------- 实例绑定与启动 ----------------

function findInstalledTarget(
  versionId: string,
  folder?: string,
  targets = listAllInstalled()
): InstalledVersion {
  let matches = targets.filter((target) => target.id === versionId)
  if (folder) {
    const identity = pathIdentity(folder)
    matches = matches.filter((target) => pathIdentity(target.folder) === identity)
  }
  if (!matches.length) throw new Error(`关联实例「${versionId}」已被删除或所在磁盘不可用`)
  if (matches.length > 1) throw new Error(`多个游戏文件夹中都存在「${versionId}」，请重新选择具体实例`)
  return matches[0]
}

function applyTarget(entry: ServerEntry, target: InstalledVersion): void {
  entry.versionId = target.id
  entry.folder = canonicalPath(target.folder)
  entry.minecraftVersion = target.mcVersion
  if (target.loader) entry.loader = target.loader
  else delete entry.loader
  if (target.loaderVersion) entry.loaderVersion = target.loaderVersion
  else delete entry.loaderVersion
  delete entry.candidateVersionIds
  delete entry.sourceGameDirectory
}

export function bindServer(id: string, versionId: string, folder?: string): ServerEntry[] {
  const list = listServers()
  const s = list.find((x) => x.id === id)
  if (!s) throw new Error('服务器不存在')
  if (versionId) {
    const target = findInstalledTarget(versionId, folder)
    const endpoint = s.normalizedAddress ?? parseServerAddress(s.address).normalizedAddress
    const duplicate = list.some(
      (entry) =>
        entry.id !== s.id &&
        (entry.normalizedAddress ?? parseServerAddress(entry.address).normalizedAddress) === endpoint &&
        entry.versionId === target.id &&
        !!entry.folder &&
        pathIdentity(entry.folder) === pathIdentity(target.folder)
    )
    if (duplicate) throw new Error('该服务器已关联到所选实例')
    applyTarget(s, target)
  } else {
    delete s.versionId
    delete s.folder
    delete s.minecraftVersion
    delete s.loader
    delete s.loaderVersion
  }
  persist(list)
  // 新增并绑定版本后：按该版本的存储方式把服务器写入其游戏 servers.dat（不动启动链路）
  if (versionId) writeServerToGameDat(id)
  return list
}

/**
 * 把已绑定服务器写入该实例游戏目录的 servers.dat：
 * 合并进现有列表（已在列表中的同地址条目不重复追加），不覆盖玩家在游戏内维护的其他条目。
 */
export function writeServerToGameDat(id: string): void {
  const list = listServers()
  const entry = list.find((x) => x.id === id)
  if (!entry?.versionId) return
  try {
    const target = findInstalledTarget(entry.versionId, entry.folder)
    if (target.failed || target.incomplete) return
    const dir = canonicalPath(target.gameDirectory || target.folder)
    const endpoint = entry.normalizedAddress ?? parseServerAddress(entry.address).normalizedAddress
    const read = readServersDat(dir)
    const exists = read.list.some((s) => {
      try {
        return parseServerAddress(s.ip).normalizedAddress === endpoint
      } catch {
        return false
      }
    })
    if (exists) return
    const next = [...read.list, { name: entry.name, ip: endpoint }]
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'servers.dat'), buildServersDat(next))
    serverLog.info(`服务器「${entry.name}」已写入实例 ${target.id} 的 servers.dat（共 ${next.length} 条）`)
  } catch (e) {
    // 写入失败不影响绑定流程（下次启动同步仍可识别）
    serverLog.warn('写入 servers.dat 失败', e)
  }
}

export function prepareServerLaunch(
  id: string,
  versionId?: string,
  folder?: string
): ServerLaunchPreparation {
  const list = listServers()
  const entry = list.find((server) => server.id === id)
  if (!entry) throw new Error('服务器记录不存在')
  const requestedVersion = versionId || entry.versionId
  if (!requestedVersion) throw new Error('请先选择要启动的游戏实例')
  const target = findInstalledTarget(requestedVersion, folder || entry.folder)
  if (target.failed) throw new Error(`实例「${target.id}」安装事务未完成，请先清理或重新安装`)
  if (target.incomplete) throw new Error(`实例「${target.id}」缺少关键文件，请先修复或重新下载`)

  // 切换活动目录后，versions 的寻址表会在前端刷新时按该目录重建。
  setActiveGameFolder(target.folder)
  const parsed = parseServerAddress(entry.address)
  entry.address = parsed.address
  entry.normalizedAddress = parsed.normalizedAddress
  entry.host = parsed.host
  entry.port = parsed.port
  entry.lastUsedAt = new Date().toISOString()
  if (entry.versionId === target.id && (!entry.folder || pathIdentity(entry.folder) === pathIdentity(target.folder))) {
    applyTarget(entry, target)
  }
  persist(list)
  return {
    serverId: entry.id,
    versionId: target.id,
    folder: canonicalPath(target.folder),
    address: parsed.address,
    minecraftVersion: target.mcVersion,
    loader: target.loader,
    loaderVersion: target.loaderVersion,
    directJoin: supportsQuickPlayMultiplayer(target.mcVersion)
  }
}

/** 实例重命名后同步 servers.json 中的绑定 versionId */
export function renameBinding(oldId: string, newId: string): void {
  const list = listServers()
  let changed = false
  for (const s of list) {
    if (s.versionId === oldId) {
      s.versionId = newId
      changed = true
    }
    if (s.candidateVersionIds?.includes(oldId)) {
      s.candidateVersionIds = s.candidateVersionIds.map((id) => (id === oldId ? newId : id))
      changed = true
    }
  }
  if (changed) persist(list)
}

// ---------------- servers.dat 只读同步 ----------------

interface DatServer {
  name: string
  ip: string
}

function readServersDat(dir: string): { list: DatServer[]; error?: string } {
  const file = path.join(dir, 'servers.dat')
  if (!fs.existsSync(file)) return { list: [] }
  try {
    const root = parseNbt(fs.readFileSync(file))
    const list = root.servers
    if (!Array.isArray(list)) return { list: [], error: 'servers.dat 缺少 servers 列表' }
    return {
      list: list
        .map((e) => {
          const o = e as { name?: unknown; ip?: unknown }
          return { name: String(o.name ?? ''), ip: String(o.ip ?? '') }
        })
        .filter((s) => s.ip)
    }
  } catch (error) {
    return { list: [], error: error instanceof Error ? error.message : String(error) }
  }
}

interface ScanGroup {
  directory: string
  targets: InstalledVersion[]
}

/**
 * 从实际实例目录读取 servers.dat。此路径永不写回游戏文件，因此游戏运行时刷新、
 * 启动器内删除或重新绑定都不会覆盖玩家在 Minecraft 内维护的服务器列表。
 * 指定 versionId/folder 时用于游戏退出后的精确关联；全量扫描遇到共享目录时保留候选列表。
 */
export function syncFromServersDat(versionId?: string, folder?: string): ServerSyncResult {
  const list = listServers()
  const targets = listAllInstalled()
  const selected = versionId ? [findInstalledTarget(versionId, folder, targets)] : targets
  const groupsByDirectory = new Map<string, ScanGroup>()
  for (const target of selected) {
    const directory = canonicalPath(target.gameDirectory || target.folder)
    const identity = pathIdentity(directory)
    const group = groupsByDirectory.get(identity)
    if (group) group.targets.push(target)
    else groupsByDirectory.set(identity, { directory, targets: [target] })
  }

  let added = 0
  let updated = 0
  const errors: string[] = []
  const seenAt = new Date().toISOString()
  for (const [directoryIdentity, group] of groupsByDirectory) {
    const read = readServersDat(group.directory)
    if (read.error) {
      errors.push(`${group.targets.map((target) => target.id).join(' / ')}：${read.error}`)
      continue
    }
    for (const datServer of read.list) {
      let parsed
      try {
        parsed = parseServerAddress(datServer.ip)
      } catch (error) {
        errors.push(
          `${datServer.name || datServer.ip}：${error instanceof Error ? error.message : String(error)}`
        )
        continue
      }

      const exactTarget = group.targets.length === 1 ? group.targets[0] : undefined
      let matches: ServerEntry[] = []
      if (exactTarget) {
        const key = serverAssociationKey(
          parsed.normalizedAddress,
          exactTarget.id,
          pathIdentity(exactTarget.folder)
        )
        matches = list.filter(
          (entry) =>
            serverAssociationKey(
              entry.normalizedAddress ?? parseServerAddress(entry.address).normalizedAddress,
              entry.versionId,
              entry.folder ? pathIdentity(entry.folder) : undefined,
              entry.sourceGameDirectory ? pathIdentity(entry.sourceGameDirectory) : undefined
            ) === key
        )
        if (!matches.length) {
          // 兼容旧格式（只有 versionId、没有 folder）以及先前共享目录的待确认记录。
          matches = list.filter((entry) => {
            const sameEndpoint =
              (entry.normalizedAddress ?? parseServerAddress(entry.address).normalizedAddress) ===
              parsed.normalizedAddress
            if (!sameEndpoint) return false
            if (entry.versionId === exactTarget.id && !entry.folder) return true
            if (entry.versionId) return false
            return (
              !entry.sourceGameDirectory ||
              pathIdentity(entry.sourceGameDirectory) === directoryIdentity
            )
          })
          // 不把多个手工收藏同时折叠到一个实例；歧义时保留原记录并创建精确关联。
          if (matches.length > 1) matches = []
        }
      } else {
        // 同一共享根目录对应多个非隔离实例：已有精确关联优先，否则保留一个待确认记录。
        const candidateKeys = new Set(
          group.targets.map((target) => `${pathIdentity(target.folder)}\u0000${target.id}`)
        )
        matches = list.filter(
          (entry) =>
            (entry.normalizedAddress ?? parseServerAddress(entry.address).normalizedAddress) ===
              parsed.normalizedAddress &&
            !!entry.versionId &&
            !!entry.folder &&
            candidateKeys.has(`${pathIdentity(entry.folder)}\u0000${entry.versionId}`)
        )
        if (!matches.length) {
          matches = list.filter(
            (entry) =>
              !entry.versionId &&
              (entry.normalizedAddress ?? parseServerAddress(entry.address).normalizedAddress) ===
                parsed.normalizedAddress &&
              !!entry.sourceGameDirectory &&
              pathIdentity(entry.sourceGameDirectory) === directoryIdentity
          )
        }
      }

      if (!matches.length) {
        const entry: ServerEntry = {
          id: crypto.randomUUID(),
          name: datServer.name || parsed.address,
          address: parsed.address,
          normalizedAddress: parsed.normalizedAddress,
          host: parsed.host,
          port: parsed.port,
          lastSeenAt: seenAt,
          source: 'minecraft'
        }
        if (exactTarget) applyTarget(entry, exactTarget)
        else {
          entry.candidateVersionIds = [...new Set(group.targets.map((target) => target.id))]
          entry.sourceGameDirectory = group.directory
        }
        list.push(entry)
        added++
        continue
      }

      for (const entry of matches) {
        const before = JSON.stringify(entry)
        entry.address = parsed.address
        entry.normalizedAddress = parsed.normalizedAddress
        entry.host = parsed.host
        entry.port = parsed.port
        entry.lastSeenAt = seenAt
        if (entry.source === 'minecraft') entry.name = datServer.name || parsed.address
        if (exactTarget) applyTarget(entry, exactTarget)
        else if (!entry.versionId) {
          entry.candidateVersionIds = [...new Set(group.targets.map((target) => target.id))]
          entry.sourceGameDirectory = group.directory
        }
        if (JSON.stringify(entry) !== before) updated++
      }
    }
  }
  if (added || updated) persist(list)
  return { list, targets, added, updated, errors }
}

// ---------------- Server List Ping ----------------

/** VarInt 编码 */
function writeVarInt(v: number): Buffer {
  const out: number[] = []
  let x = v >>> 0
  if (v < 0) x = v // 协议版本用负数（-1）时按 32 位处理
  do {
    let b = x & 0x7f
    x >>>= 7
    if (x !== 0) b |= 0x80
    out.push(b)
  } while (x !== 0)
  return Buffer.from(out)
}

/** 组包：VarInt 长度 + 包 id + 载荷 */
function pack(id: number, payload: Buffer): Buffer {
  const body = Buffer.concat([writeVarInt(id), payload])
  return Buffer.concat([writeVarInt(body.length), body])
}

/** MOTD 对象转纯文本并去掉 § 格式化码 */
function motdText(desc: unknown): string {
  let text = ''
  const walk = (node: unknown): void => {
    if (typeof node === 'string') text += node
    else if (node && typeof node === 'object') {
      const o = node as { text?: unknown; extra?: unknown[] }
      if (typeof o.text === 'string') text += o.text
      if (Array.isArray(o.extra)) o.extra.forEach(walk)
    }
  }
  walk(desc)
  return text.replace(/§[0-9a-fk-or]/gi, '').trim()
}

interface StatusJson {
  players?: { online?: number; max?: number }
  version?: { name?: string }
  description?: unknown
}

/**
 * 对 MC 服务器执行 Server List Ping。
 * 6 秒超时；offline 时不抛错，返回 online:false。
 */
export function pingServer(address: string): Promise<ServerPingResult> {
  return new Promise((resolve) => {
    const offline: ServerPingResult = {
      online: false,
      players: '-',
      motd: '无法连接（服务器离线或地址错误）',
      version: '-',
      latencyMs: 0
    }
    let parsed
    try {
      parsed = parseServerAddress(address)
    } catch {
      resolve(offline)
      return
    }
    void (async () => {
      let connectHost = parsed.host
      let connectPort = parsed.port
      // Java 客户端对未显式写端口的域名会查询 _minecraft._tcp SRV；状态探测保持一致。
      if (!parsed.explicitPort && net.isIP(parsed.host) === 0) {
        try {
          const records = await dns.resolveSrv(`_minecraft._tcp.${parsed.host}`)
          const selected = [...records].sort(
            (a, b) => a.priority - b.priority || b.weight - a.weight
          )[0]
          if (selected) {
            connectHost = selected.name.replace(/\.$/, '')
            connectPort = selected.port
          }
        } catch {
          // 没有 SRV 时按默认 25565 直连。
        }
      }

      // 延迟只计协议往返：TCP 建连后发出 Status Request 起表，收到响应首字节止。
      // DNS/SRV 解析与三次握手不计入，否则会混入数百毫秒伪延迟。
      let start = 0
      let done = false
      const sock = net.connect({ host: connectHost, port: connectPort })
      const finish = (r: ServerPingResult): void => {
        if (done) return
        done = true
        try {
          sock.destroy()
        } catch {
          /* 忽略 */
        }
        resolve(r)
      }
      sock.setNoDelay(true)
      sock.setTimeout(6000)

      sock.on('connect', () => {
        start = Date.now()
        // Handshake 保留玩家填写的原始主机与逻辑端口，TCP 目标可由 SRV 改写。
        const addrBuf = Buffer.from(parsed.host, 'utf-8')
        const payload = Buffer.concat([
          writeVarInt(-1),
          writeVarInt(addrBuf.length),
          addrBuf,
          Buffer.from([parsed.port >> 8, parsed.port & 0xff]),
          writeVarInt(1)
        ])
        sock.write(pack(0x00, payload))
        sock.write(pack(0x00, Buffer.alloc(0)))
      })

      let buf = Buffer.alloc(0)
      let rttMs = 0
      sock.on('data', (chunk) => {
        if (start > 0 && rttMs === 0) rttMs = Math.max(1, Date.now() - start)
        buf = Buffer.concat([buf, chunk])
        let len = 0
        let shift = 0
        let i = 0
        for (; i < buf.length && i < 5; i++) {
          len |= (buf[i] & 0x7f) << (shift * 7)
          shift++
          if ((buf[i] & 0x80) === 0) break
        }
        if (i >= buf.length || (i < buf.length && (buf[i] & 0x80) !== 0)) return
        const headLen = i + 1
        if (buf.length < headLen + len) return
        const body = buf.subarray(headLen, headLen + len)
        let j = 1
        let jsonLen = 0
        let jshift = 0
        for (; j < body.length && j < 6; j++) {
          jsonLen |= (body[j] & 0x7f) << (jshift * 7)
          jshift++
          if ((body[j] & 0x80) === 0) break
        }
        const json = body.subarray(j + 1, j + 1 + jsonLen).toString('utf-8')
        try {
          const s = JSON.parse(json) as StatusJson
          finish({
            online: true,
            players: `${s.players?.online ?? 0}/${s.players?.max ?? 0}`,
            motd: motdText(s.description) || '这个服务器没有介绍',
            version: s.version?.name ?? '未知',
            latencyMs: rttMs
          })
        } catch {
          finish(offline)
        }
      })
      sock.on('timeout', () => finish(offline))
      sock.on('error', () => finish(offline))
    })().catch(() => resolve(offline))
  })
}
