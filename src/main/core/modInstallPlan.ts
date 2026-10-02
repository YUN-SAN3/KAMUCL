import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import type { CommunityFile, CommunitySource, InstalledVersion, ModInfo, ModInstallPlan, ModRequirement, ProgressEvent } from '../../shared/types'
import { communityFileMatchesInstance } from '../../shared/communityPolicy'
import { matchesVersionRange, modMatchesInstance, normalizeLoader } from '../../shared/modCompatibility'
import { parseModFile } from './modinfo'
import { communityExactFile, communityFiles, communitySearch } from './community'
import { downloadAll } from './download'

export interface DependencyRepository {
  files(source: CommunitySource, projectId: string, target: InstalledVersion): Promise<CommunityFile[]>
  exact(source: CommunitySource, projectId: string | undefined, fileId: string): Promise<CommunityFile>
  find(id: string, target: InstalledVersion): Promise<CommunityFile | undefined>
}
export const dependencyRepository: DependencyRepository = {
  files: (source, projectId, target) => communityFiles(source, projectId, { mcVersion: target.mcVersion, loader: target.loader }),
  exact: communityExactFile,
  async find(id, target) {
    // Search is only a candidate lookup. The downloaded JAR's actual mod id and
    // version must satisfy the requirement before anything reaches the mods folder.
    const hits = await communitySearch({ keyword: id, kind: 'mod', source: 'all', mcVersion: target.mcVersion, loader: target.loader, offset: 0, limit: 20 })
    const key = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')
    for (const hit of hits.filter(h => key(h.slug) === key(id) || key(h.title) === key(id))) {
      const files = await this.files(hit.source, hit.projectId, target)
      if (files[0]) return files[0]
    }
  }
}

const provided = (mod: ModInfo) => mod.provides ?? [{ id: mod.id, version: mod.version }]
export function requirementsFor(mod: ModInfo, target: InstalledVersion): ModRequirement[] {
  return mod.variants?.filter(v => normalizeLoader(v.loader) === normalizeLoader(target.loader)).flatMap(v => v.requirements ?? []) ?? mod.requirements ?? mod.dependencies.map(id => ({ id, range: '*' }))
}
export function missingRequirements(mods: ModInfo[], target: InstalledVersion, available: ModInfo[]): ModRequirement[] {
  return mods.flatMap(mod => requirementsFor(mod, target)).filter(dep => !available.some(mod => provided(mod).some(p => p.id === dep.id && matchesVersionRange(dep.range, p.version))))
}
function installedMods(target: InstalledVersion): ModInfo[] {
  const dir = path.join(target.gameDirectory!, 'mods')
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir).filter(f => f.toLowerCase().endsWith('.jar')).map(f => parseModFile(path.join(dir, f))).filter(m => !m.error)
}

/** Required transitive graph; pinned version IDs stay pinned, optional edges never download.
 * This phase reads repository metadata only, not dependency JARs. */
export async function dependencyGraph(roots: CommunityFile[], target: InstalledVersion, repo: DependencyRepository): Promise<CommunityFile[]> {
  const result: CommunityFile[] = [], seen = new Set<string>(), projects = new Map<string, string>()
  async function visit(file: CommunityFile) {
    const key = `${file.source}:${file.fileId}`
    if (seen.has(key)) return
    if (!communityFileMatchesInstance(file, target)) throw new Error(`${file.fileName} 不支持 MC ${target.mcVersion} / ${target.loader}`)
    if (seen.size >= 96) throw new Error('依赖图超过 96 项，请检查项目元数据')
    const project = `${file.source}:${file.projectId}`
    if (file.projectId && projects.has(project) && projects.get(project) !== file.fileId) throw new Error(`前置版本冲突：${file.projectId}`)
    if (file.projectId) projects.set(project, file.fileId)
    seen.add(key)
    for (const dep of file.dependencies ?? []) {
      if (!dep.required) continue
      if (!file.source || (!dep.projectId && !dep.fileId)) throw new Error(`无法定位 ${file.fileName} 的必要前置，请手动安装`)
      const selected = roots.find(root => root.source === file.source && (dep.projectId ? root.projectId === dep.projectId : root.fileId === dep.fileId))
      if (selected && dep.fileId && selected.fileId !== dep.fileId) throw new Error(`前置版本冲突：${dep.projectId || dep.fileId}`)
      const next = selected || (dep.fileId ? await repo.exact(file.source, dep.projectId, dep.fileId) : (await repo.files(file.source, dep.projectId!, target))[0])
      if (!next) throw new Error(`前置 ${dep.projectId} 没有兼容版本`)
      await visit(next)
    }
    result.push(file)
  }
  for (const root of roots) await visit(root)
  return result
}

interface PrivatePlan {
  view: ModInstallPlan; directory: string; roots: string[]; downloads: CommunityFile[]; expires: number
}
const plans = new Map<string, PrivatePlan>()
const hash = (file: string) => crypto.createHash('sha1').update(fs.readFileSync(file)).digest('hex')
const clean = (plan: PrivatePlan) => { fs.rmSync(plan.directory, { recursive: true, force: true }); plans.delete(plan.view.id) }

export async function prepareModInstall(target: InstalledVersion, input: { paths?: string[]; file?: CommunityFile }, emit: (e: ProgressEvent) => void, signal?: AbortSignal, repository = dependencyRepository): Promise<ModInstallPlan> {
  for (const p of plans.values()) if (p.expires < Date.now()) clean(p)
  if (plans.size >= 8) throw new Error('待确认安装过多，请取消已有安装计划')
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'kamucl-mod-plan-'))
  const id = crypto.randomUUID()
  const plan: PrivatePlan = { directory, roots: [], downloads: [], expires: Date.now() + 20 * 60_000, view: { id, target, files: [], missing: [], warnings: [] } }
  try {
    const roots: CommunityFile[] = []
    if (input.file) {
      if (!input.file.source || !input.file.projectId) throw new Error('缺少项目来源，请重新打开下载页')
      const file = await repository.exact(input.file.source, input.file.projectId, input.file.fileId)
      if (!communityFileMatchesInstance(file, target)) throw new Error('所选 MOD 文件与目标实例不兼容')
      const dest = path.join(directory, path.basename(file.fileName))
      emit({ stage: 'download', progress: 0, text: '读取所选 MOD，解析内置前置要求…' })
      await downloadAll([{ url:file.url, dest, sha1:file.sha1, size:file.size || undefined }], (_d,_t,speed,detail) => emit({stage:'download', progress:detail.fraction ?? 0, text:'下载所选 MOD', speed, bytesDone:detail.bytesDone, bytesTotal:detail.bytesTotal ?? undefined, etaSeconds:detail.etaSeconds ?? undefined}), 8, 'official', signal)
      plan.roots.push(dest); roots.push(file)
    } else {
      for (const [index, file] of (input.paths ?? []).entries()) {
        const destDir = path.join(directory, String(index)); fs.mkdirSync(destDir)
        const dest = path.join(destDir, path.basename(file)); fs.copyFileSync(file, dest); plan.roots.push(dest)
      }
    }
    if (!plan.roots.length) throw new Error('没有待安装的 MOD')
    const mods = plan.roots.map(parseModFile)
    for (const mod of mods) if (!modMatchesInstance(mod, target)) throw new Error(`${mod.name || mod.fileName}：${mod.error || '与目标实例的 MC / Loader 版本不兼容'}`)
    const installed = installedMods(target)
    const missing = missingRequirements(mods, target, [...installed, ...mods])
    const graph = await dependencyGraph(roots, target, repository)
    const rootKeys = new Set(roots.map(f => `${f.source}:${f.fileId}`))
    plan.downloads = graph.filter(f => !rootKeys.has(`${f.source}:${f.fileId}`))
    // Local drops lack repository project IDs; resolve mod-id candidates separately.
    for (const req of [...new Map(missing.map(d => [d.id, d])).values()]) {
      if (plan.downloads.some(f => f.projectId && f.projectId.replace(/[-_]/g, '') === req.id.replace(/[-_]/g, ''))) continue
      const candidate = await repository.find(req.id, target)
      if (candidate) plan.downloads.push(...await dependencyGraph([candidate], target, repository))
      else if (!plan.downloads.length) plan.view.warnings.push(`无法自动定位前置 ${req.id} ${req.range}，请手动补齐后重试`)
    }
    plan.downloads = [...new Map(plan.downloads.map(f => [`${f.source}:${f.fileId}`, f])).values()]
      .filter(f => !f.sha1 || !installed.some(m => hash(m.filePath) === f.sha1))
    plan.view.missing = missing.map(d => `${d.id} ${d.range}`)
    plan.view.files = [...mods.map(m => ({ name: m.name, version: m.version, dependency: false, fileName: m.fileName })),
      ...plan.downloads.map(f => ({ name: f.projectId ?? f.fileName, version: f.version, dependency: true, fileName: f.fileName }))]
    plans.set(id, plan)
    return plan.view
  } catch (error) { clean(plan); throw error }
}

export function discardModPlan(id: string) { const plan = plans.get(id); if (plan) clean(plan) }

export async function executeModPlan(id: string, includeDependencies: boolean, revalidate: (target: InstalledVersion) => InstalledVersion, emit: (e: ProgressEvent) => void, signal?: AbortSignal): Promise<string> {
  const plan = plans.get(id)
  if (!plan || plan.expires < Date.now()) throw new Error('安装计划已过期，请重新解析')
  plans.delete(id) // A plan may only commit once, including concurrent invoke calls.
  const created: string[] = []
  try {
    const target = revalidate(plan.view.target)
    if (target.gameDirectory !== plan.view.target.gameDirectory) throw new Error('实例隔离目录已变更，请重新解析')
    let installed = installedMods(target)
    const rootMods = plan.roots.map(parseModFile)
    const staged = [...rootMods]
    const dependencies = includeDependencies ? plan.downloads.map((file,index) => ({ ...file, dest:path.join(plan.directory, 'dep-'+index, path.basename(file.fileName)) })) : []
    await downloadAll(dependencies.map(f => ({url:f.url,dest:f.dest,sha1:f.sha1,size:f.size || undefined})), (_d,_t,speed,detail) => emit({stage:'download',progress:detail.fraction ?? 0,text:'下载必要前置',speed,bytesDone:detail.bytesDone,bytesTotal:detail.bytesTotal ?? undefined,etaSeconds:detail.etaSeconds ?? undefined}), 8, 'official', signal)
    for (const file of dependencies) {
      signal?.throwIfAborted()
      const mod = parseModFile(file.dest)
      if (!modMatchesInstance(mod, target)) throw new Error(`${file.fileName} 的 JAR 元数据不兼容目标实例：${mod.error ?? ''}`)
      // Keep an installed compatible provider; never install a second copy by filename.
      if (!installed.some(m => provided(m).some(p => p.id === mod.id))) staged.push(mod)
    }
    const current = revalidate(plan.view.target)
    if (current.gameDirectory !== target.gameDirectory) throw new Error('下载期间实例目录发生变化，未安装任何 MOD')
    installed = installedMods(current)
    for (const mod of staged) if (!modMatchesInstance(mod, current)) throw new Error(`${mod.name} 的兼容性已变化，请重新解析`)
    const missing = missingRequirements(staged, target, [...staged, ...installed])
    if (missing.length) throw new Error(`未写入任何 MOD；仍缺少或版本不满足：${missing.map(d => `${d.id} ${d.range}`).join('、')}。请补齐前置或处理旧版冲突后重试`)
    const accepted: ModInfo[] = []
    for (const mod of staged) {
      const existing = [...installed, ...accepted].find(m => provided(m).some(p => p.id === mod.id))
      if (existing) {
        if (hash(existing.filePath) === hash(mod.filePath)) continue
        throw new Error(`已存在 ${mod.id}，未覆盖或重复安装；请先处理旧文件`)
      }
      accepted.push(mod)
    }
    const dir = path.join(target.gameDirectory!, 'mods'); fs.mkdirSync(dir, { recursive: true })
    for (const mod of accepted) {
      signal?.throwIfAborted()
      const dest = path.join(dir, path.basename(mod.fileName))
      fs.copyFileSync(mod.filePath, dest, fs.constants.COPYFILE_EXCL); created.push(dest)
    }
    return `已安装 ${created.length} 个 MOD 到 ${dir}`
  } catch (error) {
    // Only files created by this transaction, never existing user content.
    for (const file of created) fs.unlinkSync(file)
    throw error
  } finally { clean(plan) }
}
