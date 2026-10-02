import { scanManagedModDirectory } from './modScan'
import { resolveResourceDirectory } from './resourceDirectory'
import { folderOfVersion } from './paths'
/**
 * MOD 更新检测：按 jar 的 sha1 在 Modrinth version_files 批量反查项目，
 * 以实例真实的 MC 版本与加载器为约束取最新兼容版本，支持单个/批量下载替换。
 * 本地不留存源站溯源信息，因此 CF/手动安装且未同步到 Modrinth 的 MOD 会标记为未匹配来源。
 */
import fs from 'node:fs'
import path from 'node:path'
import { readVersionJson } from './versions'
import { resolveInstanceMetadata } from './instanceMetadata'
import { getSettings } from './settings'
import { httpFetch } from './httpClient'
import { logScope } from './launcherLog'
import { withFileJob } from './fileJobs'
import { modHash, replaceModFiles, validateModFile } from './modTransaction'
import { isModLocked, rememberModIdentity, transferModLock } from './modState'

const MR_BASES = ['https://api.modrinth.com/v2', 'https://mod.mcimirror.top/modrinth/v2']
const UA = { 'User-Agent': 'KAMUCL-Launcher (github.com/kamubaba-i/KAMUCL)' }
const TIMEOUT = 15_000
const updateLog=logScope('mod-updates')

export interface ModUpdateTarget {
  oldSha1?: string
  /** 本地旧文件名（更新成功后删除） */
  fileName: string
  /** 新文件下载地址 */
  url: string
  /** 新文件落盘文件名 */
  targetName: string
  sha1?: string
  size?: number
}

export interface ModUpdateEntry {
  fileName: string
  name: string
  modId: string
  currentVersion: string
  sha1: string
  /** null = 未在 Modrinth 匹配到来源（可能来自 CurseForge 或手动安装） */
  source: 'modrinth' | null
  alreadyLatest: boolean
  update: null | {
    projectId: string
    versionId: string
    versionNumber: string
    fileName: string
    url: string
    sha1?: string
    size?: number
  }
}

export interface ModUpdateReport {
  mcVersion: string
  loader: string
  entries: ModUpdateEntry[]
}

interface MrVersionFile {
  hashes?: { sha1?: string; sha512?: string }
  url?: string
  filename?: string
  primary?: boolean
  size?: number
}
interface MrVersion {
  id?: string
  project_id?: string
  version_number?: string
  files?: MrVersionFile[]
}

/** Modrinth POST（主备双域名互备，与 community.ts 的 GET 互备同源策略） */
async function mrPost(pathname: string, body: unknown): Promise<unknown> {
  let lastErr: unknown = null
  const bases=getSettings().mirror==='bmclapi'?[...MR_BASES].reverse():MR_BASES
  for (const base of bases) {
    try {
      const init = {
        method: 'POST',
        signal: AbortSignal.timeout(TIMEOUT),
        headers: { ...UA, 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      }
      let res:Response
      try{res=await httpFetch(base+pathname,init)}catch(error){
        if(!process.versions.electron||!(error instanceof TypeError))throw error
        res=await httpFetch(base+pathname,{...init,signal:AbortSignal.timeout(TIMEOUT),systemProxy:true})
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return await res.json()
    } catch (error) {
      lastErr = error
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr))
}

function modsDirOf(versionId: string): Promise<string> {
  return resolveResourceDirectory(folderOfVersion(versionId), versionId, 'mods')
}

/** 把 Modrinth version_files/update 的响应映射为更新项（纯函数，可测试）：
 * 同 sha1 = 已最新；无响应 = 未匹配来源；有响应且文件不同 = 可更新。 */
export function mapUpdateEntries(
  entries: ModUpdateEntry[],
  byHash: Record<string, MrVersion | undefined>
): ModUpdateEntry[] {
  for (const entry of entries) {
    const version = byHash[entry.sha1]
    if (!version) continue
    // hash 被 Modrinth 识别即标记来源；无可用文件时不产生更新项
    entry.source = 'modrinth'
    if (!Array.isArray(version.files) || !version.files.length) continue
    const file = version.files.find((f) => f.primary) ?? version.files[0]
    const newSha1 = file?.hashes?.sha1
    if (!file?.url || !file.filename) continue
    if (newSha1 && newSha1 === entry.sha1) {
      entry.alreadyLatest = true
      continue
    }
    entry.update = {
      projectId: version.project_id ?? '',
      versionId: version.id ?? '',
      versionNumber: version.version_number ?? '',
      fileName: file.filename,
      url: file.url,
      sha1: newSha1,
      size: file.size
    }
  }
  return entries
}

/** 检测实例 mods 目录内全部 jar 的可用更新（只读网络查询，不改动任何本地文件） */
export async function checkModUpdates(versionId: string): Promise<ModUpdateReport> {
  const dir = await modsDirOf(versionId)
  const scanned = await scanManagedModDirectory(dir)
  const meta = resolveInstanceMetadata(readVersionJson(versionId), (id) => {
    try { return readVersionJson(id) } catch { return undefined }
  })
  const loader = meta.loader
  const report: ModUpdateReport = { mcVersion: meta.mcVersion || '', loader: loader ?? '', entries: [] }
  if (!scanned.length) return report
  if (!meta.mcVersion || !loader) throw new Error('实例缺少加载器或 Minecraft 版本元数据，无法检测更新')

  const entries: ModUpdateEntry[] = scanned.filter(info => !info.error && info.sha1).map(info => ({
    fileName: info.fileName, name: info.name || info.id || info.fileName,
    modId: info.id || '', currentVersion: info.version || '', sha1: info.sha1,
    source: null, alreadyLatest: false, update: null
  }))

  const byHash = (await mrPost('/version_files/update', {
    hashes: entries.map((e) => e.sha1),
    algorithm: 'sha1',
    loaders: [loader],
    game_versions: [meta.mcVersion]
  })) as Record<string, MrVersion | undefined>

  report.entries = mapUpdateEntries(entries, byHash)
  for(const e of report.entries)if(e.update?.projectId)rememberModIdentity(dir,e.sha1,'modrinth:'+e.update.projectId)
  return report
}

/** 应用更新：按所选下载源校验临时文件，保存备份后替换；单项失败不影响其他项。 */
export async function applyModUpdates(
  versionId: string,
  items: ModUpdateTarget[],
  onItem?: (fileName: string, state: 'start' | 'ok' | 'error', message?: string) => void
): Promise<Array<{ fileName: string; ok: boolean; error?: string }>> {
  const dir = await modsDirOf(versionId)
  fs.mkdirSync(dir, { recursive: true })
  const { assertModsIdle } = await import('./modManagement')
  return withFileJob(dir,undefined,async()=>{
  const results: Array<{ fileName: string; ok: boolean; error?: string }> = []
  for (const item of items) {
    updateLog.info(`开始更新 ${item.fileName} → ${item.targetName}（实例 ${versionId}，目录 ${dir}）`)
    onItem?.(item.fileName,'start')
    try {
      await assertModsIdle(dir)
      await validateModFile(dir,item.fileName,item.oldSha1)
      const oldHash=await modHash(path.join(dir,item.fileName))
      if(isModLocked(dir,oldHash))throw new Error('此模组已锁定，请解除锁定后更新')
      const name=item.targetName.replace(/\.disabled$/i,'')+(/\.disabled$/i.test(item.fileName)?'.disabled':'')
      await replaceModFiles(dir,[{oldName:item.fileName,oldSha1:oldHash,name,sha1:item.sha1||'',url:item.url,size:item.size}],async()=>{await assertModsIdle(dir);if(isModLocked(dir,oldHash))throw new Error('此模组已锁定')})
      transferModLock(dir,oldHash,item.sha1!)
      updateLog.info(`模组更新完成：${item.fileName} → ${name}`)
      onItem?.(item.fileName,'ok');results.push({fileName:item.fileName,ok:true})
    }catch(error){const message=error instanceof Error?error.message:String(error);updateLog.error(`模组更新失败：${item.fileName}（实例 ${versionId}）`,error);onItem?.(item.fileName,'error',message);results.push({fileName:item.fileName,ok:false,error:message})}
  }
  return results
  })
}
