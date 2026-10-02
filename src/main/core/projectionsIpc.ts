import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { dialog, ipcMain, shell, type BrowserWindow } from 'electron'
import { IPC_EVENT } from '../../shared/types'
import { type ProjectionCatalog, type ProjectionEntry, type ProjectionFormat, type ProjectionRequest, type ProjectionResult } from '../../shared/projections'
import { getSettings } from './settings'
import { scanInstalledFolder } from './versions'
import { startNativeFileDrag } from './nativeFileDrag'
import { dragPath } from './resourceDragPaths'
import { centerTarget, assertInstanceIdle } from './instanceCenter'
import { safePath } from './backupStore'
import { copyRecording } from './recordingFiles'
import { runProjectionWorker, registerProjectionConversion } from './projectionJobs'
const PROJECTION_DIRS: Record<ProjectionFormat,string>={litematic:'schematics',schem:'schematics',schematic:'schematics',nbt:'schematics'}
import { recycleFile } from './recycleFile'
import { withFileJob } from './fileJobs'
import { registerTask, finishTask, waitIfTaskPaused } from './tasks'

type Source = { folder?: string; root: string; label: string; library: boolean }
type Stored = { entry: ProjectionEntry; source: Source; rel: string }
const catalog = new Map<string, Stored>()
const key = (s: string) => process.platform === 'win32' ? path.resolve(s).toLowerCase() : path.resolve(s)
let scanGeneration = 0
const metadataCache=new Map<string,{size:number;modified:number;metadata:Partial<ProjectionEntry>}>()
function activeRoot() {
  const settings = getSettings(), root = settings.activeFolder || settings.gameDir
  if (!root || !settings.folders.some(f => key(f.path) === key(root))) throw new Error('请先选择已登记的游戏文件夹')
  return path.resolve(root)
}
async function library(root: string) {
  const dir = await safePath(root, 'projections', true)
  await fs.promises.mkdir(dir, { recursive: true })
  return dir
}
function selectedItems(ids: unknown): Stored[] {
  const bound = new Set(getSettings().folders.map(f => key(f.path)))
  if (!Array.isArray(ids) || !ids.length || ids.length > 10000) throw new Error('请选择投影文件')
  return [...new Set(ids)].map(id => { const s = catalog.get(id); if (!s || !s.source.folder || !bound.has(key(s.source.folder))) throw new Error('投影所属文件夹已解除绑定，请刷新列表'); return s })
}
async function recordingDirectory(root: string, kind: ProjectionFormat, create = false) {
  const dir = await safePath(root, PROJECTION_DIRS[kind], true)
  if (create) await fs.promises.mkdir(dir, { recursive: true })
  return dir
}
async function scan(getWin:()=>BrowserWindow|null): Promise<ProjectionCatalog> {
  const task=registerTask('投影 · 扫描全部目录','world'),signal=task.controller.signal;let ok=false
  try{
  const generation = ++scanGeneration, collection = path.join(activeRoot(), 'projections')
  const sources: Source[] = []
  const warnings: string[] = [], instances: ProjectionCatalog['instances'] = []
  const roots = [...new Map(getSettings().folders.map(f => [key(f.path), f])).values()]
  for (const registered of roots) {
    const root = path.resolve(registered.path), label = registered.name || root
    sources.push({ folder: root, root: path.join(root, 'projections'), label: label + ' · 集中收藏', library: true }, { folder: root, root, label: label + ' · 共享目录', library: false })
    try {
      const result = scanInstalledFolder(root)
      warnings.push(...result.errors.map(error => root + '：' + error))
      for (const v of result.versions) {
        try { const c = centerTarget({ folder: root, id: v.id }); sources.push({ folder: root, root: c.dir, label: v.id, library: false }); instances.push({ folder: root, id: v.id, name: v.id + ' · ' + root }) }
        catch { warnings.push('无法读取实例：' + root + ' / ' + v.id) }
      }
    } catch (e) { warnings.push(root + '：' + String(e)) }
  }
  const found = new Map<string, Stored>(), seen = new Set<string>(); let visited = 0
  for (const source of sources) {
    if (seen.has(key(source.root))) continue
    seen.add(key(source.root))
    for (const kind of ['litematic','schem','schematic','nbt'] as const) {
      async function visit(rel: string, depth: number): Promise<void> {
        signal.throwIfAborted();await waitIfTaskPaused(signal)
        if (++visited > 20000) throw new Error('扫描已达到 20000 个目录/文件上限，请分目录整理')
        const dir = await safePath(source.root, rel, true)
        let entries: fs.Dirent[]
        try { entries = await fs.promises.readdir(dir, { withFileTypes: true }) } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return; throw e }
        for (const file of entries) {
          if (file.isSymbolicLink() || file.name.startsWith('.')) continue
          const next = rel + '/' + file.name
          if (file.isDirectory()) { if (depth < 4 && !/\.(cache|tmp|del)$/i.test(file.name)) await visit(next, depth + 1); continue }
          if (!file.isFile() || !file.name.toLowerCase().endsWith('.'+kind)) continue
          if (found.size >= 10000) throw new Error('仅显示前 10000 个投影文件')
          const full = await safePath(source.root, next), stat = await fs.promises.lstat(full)
          const id = crypto.createHash('sha256').update(key(full)).digest('hex')
          found.set(id, { source, rel: next, entry: { folder: source.folder, id, name: file.name, kind, size: stat.size, modified: stat.mtimeMs, source: source.label, directory: path.dirname(full), library: source.library } })
        }
      }
      try { await visit(PROJECTION_DIRS[kind], 0) } catch (e) { signal.throwIfAborted();if ((e as NodeJS.ErrnoException).code !== 'ENOENT') warnings.push(source.label + '：' + String(e)) }
    }
  }
  let read=0
  for(const [id,item]of found){signal.throwIfAborted();await waitIfTaskPaused(signal);const cached=metadataCache.get(id);let metadata:Partial<ProjectionEntry>={}
    if(cached?.size===item.entry.size&&cached.modified===item.entry.modified)metadata=cached.metadata
    else{try{metadata=await runProjectionWorker({file:await current(item),sourceFormat:item.entry.kind,action:'metadata'},signal)}catch(e){signal.throwIfAborted();metadata.error=e instanceof Error?e.message:String(e)}metadataCache.set(id,{size:item.entry.size,modified:item.entry.modified,metadata})}
    Object.assign(item.entry,metadata);getWin()?.webContents.send(IPC_EVENT.progress,{taskId:task.id,taskTitle:'投影 · 扫描全部目录',stage:'world',progress:++read/found.size,text:`读取投影 ${read}/${found.size}`})
  }
  for(const id of metadataCache.keys())if(!found.has(id))metadataCache.delete(id)
  if (generation === scanGeneration) {
    catalog.clear(); for (const [id, entry] of found) catalog.set(id, entry)
  }
  ok=true;return { entries: [...found.values()].map(s => s.entry).sort((a, b) => b.modified - a.modified), warnings, library: collection, instances }
  }finally{getWin()?.webContents.send(IPC_EVENT.taskDone,{taskId:task.id,ok,cancelled:signal.aborted});finishTask(task.id)}
}
async function current(s: Stored): Promise<string> {
  const file = await safePath(s.source.root, s.rel), stat = await fs.promises.lstat(file)
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== s.entry.size || stat.mtimeMs !== s.entry.modified) throw new Error('投影已变化，请刷新列表后重试')
  return file
}
export function registerProjectionsIpc(getWin: () => BrowserWindow | null) {
  registerProjectionConversion(getWin, async id => { const item=selectedItems([id])[0];return {file:await current(item),format:item.entry.kind} })
  ipcMain.handle('projections:list', ()=>scan(getWin))
  ipcMain.on('projections:drag', (event, ids: unknown) => {
    if (event.sender !== getWin()?.webContents) return
    try {
      const items = selectedItems(ids)
      if (items.length > 1000) throw new Error('每次最多拖出 1000 个投影，请分批选择')
      const files = items.map(s => {
        const file = dragPath(s.source.root, s.rel), stat = fs.lstatSync(file)
        if (!stat.isFile() || stat.size !== s.entry.size || stat.mtimeMs !== s.entry.modified) throw new Error('投影已变化，请刷新后重试')
        return file
      })
      startNativeFileDrag(event.sender, files)
    } catch (e) { if (!event.sender.isDestroyed()) event.sender.send('files:dragError', String(e)) }
  })
  ipcMain.handle('projections:open', async (_e, id?: string) => {
    if (id) { shell.showItemInFolder(await current(selectedItems([id])[0])) }
    else { const error = await shell.openPath(await library(activeRoot())); if (error) throw new Error(error) }
  })
  async function run(items: Stored[], action: ProjectionRequest['action'], destination?: string) {
    const task = registerTask('投影文件 · ' + ({ collect: '收集', export: '提取', dispatch: '复制到实例', trash: '移入回收站' }[action]), 'world')
    const signal = task.controller.signal, results: ProjectionResult[] = []
    const total = items.reduce((sum, s) => sum + s.entry.size, 0); let done = 0
    const progress = (bytes: number, name: string) => getWin()?.webContents.send(IPC_EVENT.progress, { taskId: task.id, taskTitle: task.title, stage: 'world', progress: total ? Math.min(1, (done + bytes) / total) : 0, text: `${results.length}/${items.length} · ${name}` })
    try {
      for (const item of items) {
        try {
          await waitIfTaskPaused(signal); signal.throwIfAborted(); progress(0, item.entry.name)
          const file = await current(item)
          let output: string | undefined
          if (action === 'trash') {
            await withFileJob(item.source.root, signal, async () => { if (!item.source.library) await assertInstanceIdle(item.source.root); await current(item); await recycleFile(path.dirname(file), path.basename(file)) })
          } else {
            await runProjectionWorker({file,sourceFormat:item.entry.kind,action:'metadata'},signal)
            if (!destination) throw new Error('未指定投影目标目录')
            const root = destination
            await withFileJob(root, signal, async () => {
              if (action === 'dispatch') await assertInstanceIdle(root)
              const dir = action === 'export' ? root : await recordingDirectory(root, item.entry.kind, true)
              output = await copyRecording(file, dir, signal, bytes => progress(bytes, item.entry.name))
            })
          }
          results.push({ id: item.entry.id, name: item.entry.name, ok: true, path: output })
        } catch (e) { results.push({ id: item.entry.id, name: item.entry.name, ok: false, error: signal.aborted ? '任务已取消，原投影保留' : String(e) }) }
        done += item.entry.size
      }
      const failed = results.filter(r => !r.ok).length
      getWin()?.webContents.send(IPC_EVENT.taskDone, { taskId: task.id, ok: !failed, cancelled: signal.aborted, error: failed ? `${failed} 个投影处理失败，请查看投影页结果` : undefined })
      return results
    } finally { finishTask(task.id) }
  }
  ipcMain.handle('projections:operate', async (_e, request: ProjectionRequest) => {
    if (!request || !['collect', 'export', 'dispatch', 'trash'].includes(request.action) || !Array.isArray(request.ids) || request.ids.length < 1 || request.ids.length > 10000) throw new Error('投影操作参数无效')
    const root = activeRoot(), items = selectedItems(request.ids)
    let dest: string | undefined = request.action === 'collect' ? await library(root) : undefined
    if (request.action === 'dispatch') { if (!request.target) throw new Error('请选择目标实例'); dest = centerTarget(request.target).dir }
    if (request.action === 'export') { const picked = await dialog.showOpenDialog({ title: '选择投影提取文件夹', properties: ['openDirectory', 'createDirectory'] }); if (picked.canceled) return null; dest = picked.filePaths[0] }
    return run(items, request.action, dest)
  })
  ipcMain.handle('projections:import', async () => {
    const root = activeRoot()
    const picked = await dialog.showOpenDialog({ title: '导入投影到集中收藏', properties: ['openFile', 'multiSelections'], filters: [{ name: 'Minecraft 投影', extensions: ['litematic','schem','schematic','nbt'] }] })
    if (picked.canceled) return null
    const destination = await library(root)
    const items: Stored[] = []
    for (const file of picked.filePaths) { const stat = await fs.promises.lstat(file); items.push({ source: { root: path.dirname(file), label: '导入', library: false }, rel: path.basename(file), entry: { id: file, name: path.basename(file), kind: path.extname(file).slice(1).toLowerCase() as ProjectionFormat, size: stat.size, modified: stat.mtimeMs, source: '导入', directory: path.dirname(file), library: false } }) }
    return run(items, 'collect', destination)
  })
}
