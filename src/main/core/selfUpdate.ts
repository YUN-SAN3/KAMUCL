/**
 * 启动器自更新：GitHub Releases 检查（latest/列表）、ETag 条件请求、结果缓存、
 * 跳过版本逻辑、SHA256SUMS 获取。所有网络失败静默降级（记日志，不打扰用户）。
 *
 * 限流应对（未认证 60 次/时/IP）：
 * - 启动自动检查 1 次 + 结果缓存 6 小时
 * - ETag/If-None-Match 命中 304 不计入额度
 * - 手动检查走同一缓存（force 才绕过），403 限流时回退缓存
 */
import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import { GITHUB_REPO } from '../../shared/branding'
import { compareSemver, isNewerVersion } from '../../shared/semver'
import type { ReleaseInfo, UpdateCheckResult } from '../../shared/types'
import { httpFetch } from './httpClient'
import { logScope } from './launcherLog'
import { isolatedUpdateTest, trustedUpdateRelease } from './updateTrust'

const updateLog = logScope('self-update')

/** 检查缓存有效期 6 小时 */
const CACHE_TTL_MS = 6 * 3600_000
const API_TIMEOUT_MS = 10_000

/** GitHub API 基地址（env 覆盖供 mock 测试：KAMUCL_UPDATE_API_BASE=http://127.0.0.1:8310） */
function apiBase(): string {
  return (isolatedUpdateTest() ? process.env.KAMUCL_UPDATE_API_BASE! : 'https://api.github.com').replace(/\/+$/, '')
}
/** 文件下载基地址（镜像/mock 用；默认空 = 用 API 返回的 browser_download_url 原样） */
function downloadBaseOverride(): string {
  return (isolatedUpdateTest() ? process.env.KAMUCL_UPDATE_DOWNLOAD_BASE || '' : '').replace(/\/+$/, '')
}

interface CheckCache {
  source?: string
  etag?: string
  checkedAt: number
  latest?: ReleaseInfo | null
}

/** 当前版本（env 覆盖供测试） */
export function currentVersion(): string {
  return (isolatedUpdateTest() && process.env.KAMUCL_VERSION_OVERRIDE) || app.getVersion()
}
/** userData 目录（env 覆盖供测试） */
function userDataDir(): string {
  return isolatedUpdateTest() ? process.env.KAMUCL_USERDATA_DIR! : app.getPath('userData')
}

function cacheFile(): string {
  return path.join(userDataDir(), 'update-check-cache.json')
}

function readCache(): CheckCache | null {
  try {
    const j = JSON.parse(fs.readFileSync(cacheFile(), 'utf-8'))
    if (j && typeof j === 'object' && (!j.source || j.source === apiBase()) && (!j.latest || trustedUpdateRelease(j.latest))) return j as CheckCache
  } catch { /* 无缓存 */ }
  return null
}

function writeCache(cache: CheckCache): void {
  try {
    fs.mkdirSync(path.dirname(cacheFile()), { recursive: true })
    fs.writeFileSync(cacheFile(), JSON.stringify({ ...cache, source: apiBase() }), 'utf-8')
  } catch (e) {
    updateLog.debug('检查缓存写入失败（不影响功能）', e)
  }
}

interface GhAsset { name?: string; browser_download_url?: string; size?: number }
interface GhRelease {
  tag_name?: string
  name?: string
  body?: string
  published_at?: string
  draft?: boolean
  prerelease?: boolean
  assets?: GhAsset[]
}

/** 从 Release JSON 提取便携 exe 资产（排除 zip 与 SHA256SUMS） */
function pickPortableExe(assets: GhAsset[] | undefined): GhAsset | null {
  if (!Array.isArray(assets)) return null
  return assets.find((a) => /^KAMUCL-[\d.]+\.exe$/i.test(a.name ?? '')) ?? null
}

function toReleaseInfo(j: GhRelease): ReleaseInfo | null {
  const version = String(j.tag_name ?? '').replace(/^v/i, '')
  if (!version) return null
  const asset = pickPortableExe(j.assets)
  const release: ReleaseInfo = {
    version,
    publishedAt: String(j.published_at ?? ''),
    body: String(j.body ?? ''),
    assetUrl: asset?.browser_download_url ?? '',
    assetSize: Number(asset?.size ?? 0),
    assetName: asset?.name ?? ''
  }
  return trustedUpdateRelease(release) ? release : null
}

async function ghFetch(url: string, etag?: string): Promise<Response> {
  // 国内网络对 GitHub TLS 偶发重置：失败后 1.5s 重试一次（幂等 GET 安全）
  for (let attempt = 0; attempt < 2; attempt++) {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), API_TIMEOUT_MS)
    try {
      return await httpFetch(url, {
        signal: ctrl.signal,
        headers: {
          Accept: 'application/vnd.github+json',
          'User-Agent': 'KAMUCL-Launcher',
          ...(etag ? { 'If-None-Match': etag } : {})
        }
      })
    } catch (e) {
      if (attempt === 1) throw e
      updateLog.debug('GitHub 请求失败，1.5s 后重试一次', e)
      await new Promise((r) => setTimeout(r, 1500))
    } finally {
      clearTimeout(timer)
    }
  }
  throw new Error('unreachable')
}

/**
 * 检查最新 Release。force=false 时 6h 缓存有效直接返回缓存；
 * 网络失败/限流静默降级（有缓存回退缓存）。
 */
export async function checkLatest(force = false): Promise<UpdateCheckResult> {
  const current = currentVersion()
  const cache = readCache()
  if (!force && cache?.checkedAt && Date.now() - cache.checkedAt < CACHE_TTL_MS && cache.latest !== undefined) {
    const has = !!cache.latest && isNewerVersion(cache.latest.version, current)
    return { ok: true, hasUpdate: has, release: cache.latest ?? undefined, fromCache: true }
  }
  try {
    const res = await ghFetch(`${apiBase()}/repos/${GITHUB_REPO}/releases/latest`, cache?.etag)
    if (res.status === 304) {
      // 未变化：刷新缓存时间，沿用上次结果（304 不计限流）
      const latest = cache?.latest ?? null
      writeCache({ etag: cache?.etag, checkedAt: Date.now(), latest })
      const has = !!latest && isNewerVersion(latest.version, current)
      return { ok: true, hasUpdate: has, release: latest ?? undefined, fromCache: true }
    }
    if (res.status === 403 || res.status === 429) {
      const remain = res.headers.get('x-ratelimit-remaining')
      updateLog.info(`GitHub API 限流（remaining=${remain}），静默降级`)
      if (cache?.latest !== undefined) {
        const has = !!cache.latest && isNewerVersion(cache.latest.version, current)
        return { ok: true, hasUpdate: has, release: cache.latest ?? undefined, fromCache: true, reason: 'rate-limited' }
      }
      return { ok: false, hasUpdate: false, reason: 'rate-limited' }
    }
    if (res.status === 404) {
      // 仓库还没有任何 Release：等同于"已是最新"，记缓存避免每次启动重试
      writeCache({ etag: res.headers.get('etag') ?? cache?.etag, checkedAt: Date.now(), latest: null })
      return { ok: true, hasUpdate: false }
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const json = (await res.json()) as GhRelease
    const latest = toReleaseInfo(json)
    writeCache({ etag: res.headers.get('etag') ?? cache?.etag, checkedAt: Date.now(), latest })
    const has = !!latest && isNewerVersion(latest.version, current)
    return { ok: true, hasUpdate: has, release: latest ?? undefined }
  } catch (e) {
    updateLog.info('更新检查失败（静默降级）', e)
    if (cache?.latest !== undefined) {
      const has = !!cache.latest && isNewerVersion(cache.latest.version, current)
      return { ok: true, hasUpdate: has, release: cache.latest ?? undefined, fromCache: true, reason: 'network' }
    }
    return { ok: false, hasUpdate: false, reason: 'network' }
  }
}

/** 是否应向用户弹更新提示：有更新且未被跳过（跳过的版本不再提示，直到更新的版本出现） */
export function shouldPrompt(release: ReleaseInfo | undefined, skipVersion: string | undefined, current: string): boolean {
  if (!release) return false
  if (!isNewerVersion(release.version, current)) return false
  if (skipVersion && compareSemver(release.version, skipVersion) <= 0) return false
  return true
}

/**
 * 检查到更新后的动作决策（纯函数，可测试）：
 * - none：无更新/已跳过/已在下载/已有同版或更新版就绪待装
 * - auto-download：自动安装模式（默认）且运行形态支持 → 静默后台下载
 * - prompt：弹窗询问模式（自动安装关闭或不支持自更新的形态）
 */
export function decideUpdateAction(opts: {
  release?: ReleaseInfo
  skipVersion?: string
  current: string
  autoUpdate: boolean
  supported: boolean
  downloading: boolean
  pendingVersion?: string
}): 'auto-download' | 'prompt' | 'none' {
  if (!shouldPrompt(opts.release, opts.skipVersion, opts.current)) return 'none'
  const version = opts.release!.version
  if (opts.downloading) return 'none'
  if (opts.pendingVersion && compareSemver(opts.pendingVersion, version) >= 0) return 'none'
  if (opts.autoUpdate && opts.supported) return 'auto-download'
  return 'prompt'
}

/** 版本回退候选：全部正式 Release（含当前与更旧版本，按发布时间倒序） */
export async function listReleases(): Promise<ReleaseInfo[]> {
  try {
    const res = await ghFetch(`${apiBase()}/repos/${GITHUB_REPO}/releases?per_page=20`)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const list = (await res.json()) as GhRelease[]
    return list
      .filter((r) => !r.draft && !r.prerelease)
      .map(toReleaseInfo)
      .filter((r): r is ReleaseInfo => !!r && !!r.assetUrl)
  } catch (e) {
    updateLog.info('获取历史版本列表失败', e)
    return []
  }
}

/** 解析 SHA256SUMS.txt（sha256sum 标准格式：`<hash>  <filename>` 每行一条） */
export function parseSha256Sums(text: string): Map<string, string> {
  const map = new Map<string, string>()
  for (const line of text.split(/\r?\n/)) {
    const m = /^([0-9a-f]{64})\s+\*?(.+)$/.exec(line.trim())
    if (m) map.set(m[2].trim(), m[1].toLowerCase())
  }
  return map
}

/** 拉取 latest Release 的 SHA256SUMS.txt（用于下载后校验与本地文件校验）；失败返回 null */
export async function fetchSha256Sums(releaseAssetUrlHint?: string): Promise<Map<string, string> | null> {
  const urls: string[] = []
  // mock/测试：下载基地址覆盖时直接从该基地址取
  const dlBase = downloadBaseOverride()
  if (dlBase) urls.push(`${dlBase}/SHA256SUMS.txt`)
  try {
    const res = await ghFetch(`${apiBase()}/repos/${GITHUB_REPO}/releases/latest`)
    if (res.ok) {
      const json = (await res.json()) as GhRelease
      const sums = (json.assets ?? []).find((a) => a.name === 'SHA256SUMS.txt')
      if (sums?.browser_download_url) urls.push(sums.browser_download_url)
    }
  } catch { /* 继续用候选 */ }
  if (releaseAssetUrlHint) {
    urls.push(releaseAssetUrlHint.replace(/[^/]+$/, 'SHA256SUMS.txt'))
  }
  for (const url of urls) {
    try {
      const res = await ghFetch(url)
      if (res.ok) return parseSha256Sums(await res.text())
    } catch { /* 下一个候选 */ }
  }
  return null
}

/** 计算文件的 SHA256（hex 小写） */
export async function sha256File(file: string): Promise<string> {
  const crypto = await import('node:crypto')
  const hash = crypto.createHash('sha256')
  await new Promise<void>((resolve, reject) => {
    const stream = fs.createReadStream(file)
    stream.on('data', (d) => hash.update(d))
    stream.on('end', () => resolve())
    stream.on('error', reject)
  })
  return hash.digest('hex')
}
