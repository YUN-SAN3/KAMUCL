import { recycleFile } from './recycleFile'
import { withFileJob } from './fileJobs'
/**
 * 皮肤/披风模块：官方 Minecraft Services API + 本地历史皮肤存储
 * 存储：userData/skins/<id>.png + userData/skins.json [{id,variant,time}]（新→旧）
 * 所有 API 均以当前选中微软账号的 MC accessToken 走 Bearer 鉴权
 */
import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import type {
  CapeInfo,
  ProfileSkins,
  SkinHistoryEntry,
  SkinHistoryItem,
  SkinInfo,
  SkinVariant
} from '../../shared/types'
import { accountById, getValidAccount, selectedAccount } from './accounts'
import { gameDir } from './paths'
import { externalProfile } from './yggdrasil'
import { SkinProfileCache } from './skinProfileCache'
import type { Account } from '../../shared/types'
const profileCache = new SkinProfileCache(() => path.join(app.getPath('userData'), 'skin-cache'))

const API = 'https://api.minecraftservices.com'
/** 历史皮肤上限，超出删除最旧 */
const HISTORY_LIMIT = 30

function skinsDir(): string {
  return path.join(app.getPath('userData'), 'skins')
}

function historyFile(): string {
  return path.join(app.getPath('userData'), 'skins.json')
}

/** 取当前账号可用的 MC token：无账号 / 非微软账号直接抛中文错误 */
async function requireMcToken(): Promise<string> {
  const acc = selectedAccount()
  if (!acc) throw new Error('请先选择账号')
  if (acc.type !== 'microsoft') throw new Error('皮肤功能需要微软正版账号')
  const valid = await getValidAccount(acc)
  if (!valid.accessToken) throw new Error('登录状态已失效，请重新登录微软账号')
  return valid.accessToken
}

/** 解析官方 API 的错误响应，转成中文友好错误 */
async function apiError(res: Response, fallback: string): Promise<Error> {
  const data = (await res.json().catch(() => ({}))) as {
    error?: string
    errorMessage?: string
    message?: string
  }
  const raw = String(data.errorMessage ?? data.message ?? data.error ?? '')
  if (res.status === 401 || res.status === 403) {
    return new Error('登录状态已失效或无权限，请重新登录微软账号')
  }
  if (res.status === 404 || /not_found|not found/i.test(raw)) {
    return new Error('该账号未拥有 Minecraft 或尚未创建游戏档案')
  }
  if (res.status === 429) return new Error('操作过于频繁，请稍后再试')
  return new Error(raw || `${fallback}（HTTP ${res.status}）`)
}

/** 校验皮肤文件：存在、PNG 魔数（89 50 4E 47）、IHDR 尺寸必须 64×64，返回文件内容 */
function validateSkinPng(filePath: string): Buffer {
  if (!filePath) throw new Error('请选择皮肤文件')
  let stat: fs.Stats
  try {
    stat = fs.statSync(filePath)
  } catch {
    throw new Error('皮肤文件不存在')
  }
  if (!stat.isFile()) throw new Error('皮肤文件不存在')
  const buf = fs.readFileSync(filePath)
  // PNG 魔数 + IHDR 头长度校验
  if (
    buf.length < 24 ||
    buf[0] !== 0x89 ||
    buf[1] !== 0x50 ||
    buf[2] !== 0x4e ||
    buf[3] !== 0x47
  ) {
    throw new Error('皮肤必须是 64×64 的 PNG 图片')
  }
  // IHDR：宽 = 偏移 16 大端 UInt32，高 = 偏移 20
  const width = buf.readUInt32BE(16)
  const height = buf.readUInt32BE(20)
  if (width !== 64 || height !== 64) throw new Error('皮肤必须是 64×64 的 PNG 图片')
  return buf
}

/**
 * 下载图片并转成 data:image/png;base64 形式（30s 超时）。
 * 主进程下载纹理后随档案返回，前端不再直连 textures.minecraft.net（CORS/网络不稳）。
 * 失败返回 undefined，不阻断主流程。
 */
/**
 * 下载纹理图片转 dataURL（主进程侧，规避 renderer 的 CORS/WebGL 跨域限制）。
 * 重试 2 次；最终失败返回 undefined 并写日志，不阻断主流程。
 */
async function fetchDataUrl(url: string): Promise<string | undefined> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(8000) })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const buf = Buffer.from(await res.arrayBuffer())
      if (!buf.length) throw new Error('空响应')
      return `data:image/png;base64,${buf.toString('base64')}`
    } catch (e) {
      if (attempt === 1) {
        console.error(`[KAMUCL] 皮肤纹理下载失败(${url}):`, e instanceof Error ? e.message : e)
        appendLauncherLog(`皮肤纹理下载失败(${url}): ${e instanceof Error ? e.message : e}`)
      }
    }
  }
  return undefined
}

/** 启动器自身诊断日志：gameDir/kamucl-logs/launcher.log */
function appendLauncherLog(line: string): void {
  try {
    const dir = path.join(gameDir(), 'kamucl-logs')
    fs.mkdirSync(dir, { recursive: true })
    fs.appendFileSync(
      path.join(dir, 'launcher.log'),
      `[${new Date().toISOString()}] ${line}\n`,
      'utf-8'
    )
  } catch {
    /* 忽略 */
  }
}

/** 拉取当前账号皮肤/披风档案 */
export async function getProfile(refresh = false, accountId?: string): Promise<ProfileSkins> {
  const account = accountId ? accountById(accountId) : selectedAccount()
  if (!account) throw new Error('请先选择账号')
  const key = JSON.stringify([account.type, account.id, account.uuid, account.providerId, account.apiRoot])
  return profileCache.get(key, () => fetchProfile(account), refresh)
}

async function fetchProfile(account: Account): Promise<ProfileSkins> {
  if (account.type === 'offline') {
    // 离线账号没有官方档案；复用头像服务的公开用户名皮肤接口给首页 3D 预览。
    // 请求失败时返回空皮肤列表，由渲染器显示本地生成的可动画角色，不阻断首页。
    const url = `https://minotar.net/skin/${encodeURIComponent(account.username)}`
    const dataUrl = await fetchDataUrl(url)
    return {
      username: account.username,
      skins: dataUrl ? [{ variant: 'classic', url, dataUrl, state: 'ACTIVE' }] : [],
      capes: []
    }
  }
  if (account.type === 'yggdrasil') {
    const valid = await getValidAccount(account)
    const profile = await externalProfile(valid)
    await Promise.all([
      ...profile.skins.map(async (skin) => {
        skin.dataUrl = await fetchDataUrl(skin.url)
      }),
      ...profile.capes.map(async (cape) => {
        if (cape.url) cape.dataUrl = await fetchDataUrl(cape.url)
      })
    ])
    return profile
  }
  const token = (await getValidAccount(account)).accessToken
  if (!token) throw new Error('登录状态已失效，请重新登录')
  const res = await fetch(`${API}/minecraft/profile`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(30000)
  })
  if (!res.ok) throw await apiError(res, '获取皮肤档案失败')
  const data = (await res.json()) as {
    name?: string
    skins?: { id: string; state?: string; url?: string; variant?: string }[]
    capes?: { id: string; state?: string; alias?: string; url?: string }[]
  }
  const skins: SkinInfo[] = (data.skins ?? [])
    .filter((s): s is typeof s & { url: string } => typeof s.url === 'string' && !!s.url)
    .map((s) => ({
      variant: s.variant?.toUpperCase() === 'SLIM' ? 'slim' : 'classic',
      url: s.url,
      state: s.state
    }))
  // ACTIVE 状态排最前（skins[0] = 当前皮肤）
  skins.sort((a, b) => Number(b.state === 'ACTIVE') - Number(a.state === 'ACTIVE'))
  const capes: CapeInfo[] = (data.capes ?? []).map((c) => ({
    id: c.id,
    alias: c.alias || '披风',
    active: c.state === 'ACTIVE',
    url: c.url
  }))
  // 主进程并发下载纹理转 dataURL 随档案返回；失败跳过该项的 dataUrl
  await Promise.all([
    ...skins.map(async (s) => {
      s.dataUrl = await fetchDataUrl(s.url)
    }),
    ...capes.map(async (c) => {
      if (c.url) c.dataUrl = await fetchDataUrl(c.url)
    })
  ])
  return { username: data.name ?? '', skins, capes }
}

// ---------------- 方块头像 ----------------

/** 头像与 3D 预览共享同一份账户级磁盘纹理缓存。 */
export async function getAvatar(accountId?: string): Promise<string | null> {
  try { return (await getProfile(false, accountId)).skins[0]?.dataUrl ?? null }
  catch { return null }
}

/** 上传皮肤（multipart/form-data），成功后写入本地历史并返回最新档案 */
export async function uploadSkin(filePath: string, variant: SkinVariant): Promise<ProfileSkins> {
  if (variant !== 'classic' && variant !== 'slim') throw new Error('无效的皮肤模型')
  const buf = validateSkinPng(String(filePath ?? ''))
  const token = await requireMcToken()
  const form = new FormData()
  form.append('variant', variant)
  form.append(
    'file',
    // Buffer 拷贝为独立 Uint8Array（满足 BlobPart 的 ArrayBuffer 约束）
    new Blob([new Uint8Array(buf)], { type: 'image/png' }),
    path.basename(filePath) || 'skin.png'
  )
  const res = await fetch(`${API}/minecraft/profile/skins`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
    signal: AbortSignal.timeout(60000)
  })
  if (!res.ok) throw await apiError(res, '皮肤上传失败')
  saveHistory(buf, variant, path.basename(String(filePath ?? '')) || undefined)
  return await getProfile(true)
}

/** 激活披风（PUT {capeId}）；传 null 卸下（DELETE） */
export async function changeCape(capeId: string | null): Promise<ProfileSkins> {
  const token = await requireMcToken()
  const url = `${API}/minecraft/profile/capes/active`
  const res =
    capeId === null
      ? await fetch(url, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(30000)
        })
      : await fetch(url, {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ capeId: String(capeId) }),
          signal: AbortSignal.timeout(30000)
        })
  if (!res.ok) throw await apiError(res, '披风更换失败')
  return await getProfile(true)
}

// ---------------- 历史皮肤 ----------------

let historyCache: SkinHistoryItem[] | null = null

function loadHistory(): SkinHistoryItem[] {
  if (historyCache) return historyCache
  try {
    const raw = JSON.parse(fs.readFileSync(historyFile(), 'utf-8')) as unknown
    historyCache = Array.isArray(raw)
      ? raw.filter(
          (i): i is SkinHistoryItem =>
            !!i && typeof i.id === 'string' && typeof i.time === 'number'
        )
      : []
  } catch {
    historyCache = []
  }
  return historyCache
}

function persistHistory(): void {
  try {
    fs.mkdirSync(skinsDir(), { recursive: true })
    fs.writeFileSync(historyFile(), JSON.stringify(loadHistory(), null, 2), 'utf-8')
  } catch (e) {
    console.error('[KAMUCL] 皮肤历史写入失败:', e)
  }
}

/** 上传成功后保存副本：按内容哈希去重（同一皮肤重复上传只保留一条并移到最前），上限 30 条，超出删最旧 */
function saveHistory(buf: Buffer, variant: SkinVariant, sourceName?: string): void {
  const hash = crypto.createHash('sha1').update(buf).digest('hex')
  const list = loadHistory()
  // 已有记录缺 hash 时补算（旧版本数据迁移）
  for (const item of list) {
    if (!item.hash) {
      try {
        item.hash = crypto.createHash('sha1').update(fs.readFileSync(path.join(skinsDir(), `${path.basename(item.id)}.png`))).digest('hex')
      } catch { /* 文件缺失则下次被跳过 */ }
    }
  }
  const existing = list.find((i) => i.hash === hash)
  if (existing) {
    // 重复使用同一皮肤：不重复入库，更新时间与变体后移到最前
    existing.time = Date.now()
    existing.variant = variant
    if (!existing.name && sourceName) existing.name = sourceName
    list.splice(list.indexOf(existing), 1)
    list.unshift(existing)
    persistHistory()
    return
  }
  const id = `${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`
  try {
    fs.mkdirSync(skinsDir(), { recursive: true })
    fs.writeFileSync(path.join(skinsDir(), `${id}.png`), buf)
  } catch (e) {
    console.error('[KAMUCL] 皮肤历史保存失败:', e)
    return
  }
  list.unshift({ id, variant, time: Date.now(), name: sourceName || undefined, hash })
  while (list.length > HISTORY_LIMIT) {
    const removed = list.pop()
    if (removed) {
      try {
        fs.rmSync(path.join(skinsDir(), `${removed.id}.png`), { force: true })
      } catch {
        /* 删除失败不影响主流程 */
      }
    }
  }
  persistHistory()
}

/** 历史列表（新→旧），每条附带 data:image/png;base64 缩略图 */
export async function history(): Promise<SkinHistoryEntry[]> {
  const out: SkinHistoryEntry[] = []
  for (const item of loadHistory()) {
    try {
      const buf = fs.readFileSync(path.join(skinsDir(), `${path.basename(item.id)}.png`))
      out.push({ ...item, dataUrl: `data:image/png;base64,${buf.toString('base64')}` })
    } catch {
      /* 文件缺失的记录跳过 */
    }
  }
  return out
}

/** 删除某条历史（文件 + 记录），返回最新历史列表 */
export async function historyDelete(id: string): Promise<SkinHistoryEntry[]> {
  return withFileJob(skinsDir(), undefined, async () => {
    const list = loadHistory()
    const idx = list.findIndex(item => item.id === id)
    if (idx < 0) throw new Error('历史皮肤不存在，请刷新后重试')
    await recycleFile(skinsDir(), id + '.png')
    const currentIndex = list.findIndex(item => item.id === id)
    if (currentIndex >= 0) list.splice(currentIndex, 1)
    persistHistory()
    return history()
  })
}

/** 重命名历史记录（仅改显示名，不动文件），返回最新历史列表 */
export async function historyRename(id: string, name: string): Promise<SkinHistoryEntry[]> {
  const safe = path.basename(String(id ?? ''))
  const trimmed = String(name ?? '').trim().slice(0, 80)
  const list = loadHistory()
  const item = list.find((i) => i.id === safe)
  if (item) {
    if (trimmed) item.name = trimmed
    else delete item.name
    persistHistory()
  }
  return history()
}

/** 用历史记录快速换回：找到记录后走标准上传流程 */
export async function uploadHistory(id: string): Promise<ProfileSkins> {
  const safe = path.basename(String(id ?? ''))
  const item = loadHistory().find((i) => i.id === safe)
  if (!item) throw new Error('历史记录不存在')
  const file = path.join(skinsDir(), `${safe}.png`)
  if (!fs.existsSync(file)) throw new Error('历史皮肤文件已丢失')
  return await uploadSkin(file, item.variant)
}
