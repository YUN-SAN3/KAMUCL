// SPDX-License-Identifier: LGPL-3.0-only
// VoxLink 721c7fae ModSync contract; KAMUCL instance and transactional download adaptation.
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import type { IpcMain } from 'electron'
import type { InstanceTarget } from '../../../shared/instanceCenter'
import type { ModSyncManifest, ModSyncPlan, ModSyncScope } from '../../../shared/voxlinkMods'
import type { VoxlinkApp } from './engine'
import { ApiClient, APIError, validateRoomCode } from './api'
import type { ModSyncGate, ModSyncGateResult } from '../../../shared/voxlinkMods'
import { buildModManifests, diffMods, modrinthRequest, scanModHashes } from './modsync'
import { samePath } from '../folderPaths'
import { downloadFile } from '../download'

async function targetContext(target: InstanceTarget) {
  const { centerTarget } = await import('../instanceCenter')
  const { resolveInstanceMetadata } = await import('../instanceMetadata')
  const { readVersionJson } = await import('../versions')
  const { withGameFolder } = await import('../paths')
  const c = centerTarget(target)
  const meta = withGameFolder(c.folder, () => resolveInstanceMetadata(c.json, id => { try { return readVersionJson(id) } catch { return undefined } }))
  if (meta.broken || meta.mcVersion === '未知') throw new Error('无法识别所选实例的游戏版本，请修复实例')
  return { target: c.target, dir: path.join(c.dir, 'mods'), loader: meta.loader || 'vanilla', mcVersion: meta.mcVersion }
}
type Context = Awaited<ReturnType<typeof targetContext>>
export class ModSyncService {
  private host?: { controller: AbortController; code: string; token: string; build: Promise<Record<ModSyncScope, ModSyncManifest>> }
  private operations = new Map<string, AbortController>()
  private plans = new Map<string, { plan: ModSyncPlan; context: Context; expires: number }>()
  private bypassed=new Set<string>()
  private skipped(code:string,gate:Exclude<ModSyncGate,'MANIFEST'>):ModSyncGateResult {
    const message={UNSUPPORTED:'房主不支持模组清单，尚未检查一致性',EMPTY:'房主清单为空',NOT_READY:'房主清单未就绪或获取失败，尚未检查一致性',BYPASSED:'你已跳过模组检查'}[gate]
    this.app().netLog('info',`ModSync gate skip: ${gate} · ${code}`);this.app().emit?.('mods:gate',{code,gate,message});return{gate,message}
  }
  constructor(private app: () => VoxlinkApp) {}
  async context(target: InstanceTarget) { return targetContext(target) }
  stop() { this.host?.controller.abort(); this.host = undefined; for (const c of this.operations.values()) c.abort(); this.operations.clear(); this.plans.clear() }
  startHost(context: Context, code: string, token: string) {
    this.host?.controller.abort()
    const controller = new AbortController(), signal = controller.signal
    const build = scanModHashes(context.dir, signal).then(local => buildModManifests(local, context.loader, context.mcVersion, (route, body) => modrinthRequest(route, signal, body), signal))
    const host = this.host = { controller, code, token, build }
    void build.then(async manifests => {
      if (this.host !== host || signal.aborted) return
      for (const scope of ['required', 'all'] as const) {
        signal.throwIfAborted()
        try { await this.app().api.do(this.app().baseURL(), 'POST', '/room/mods/answer', {}, { code, token, scope, manifest: manifests[scope] }, signal) }
        catch (error) { signal.throwIfAborted(); this.app().netLog('warn', `${scope} 清单推送暂不可用，将按请求重试：${(error as Error).message}`) }
      }
      this.app().netLog('info', `模组清单已准备：必装 ${manifests.required.mods.length} / 全部 ${manifests.all.mods.length}`)
    }).catch(error => { if (!signal.aborted) this.app().netLog('warn', `模组清单准备失败：${error.message}`) })
  }
  async answer(data: Record<string, unknown>) {
    const host = this.host
    if (!host || typeof data.requestId !== 'string' || data.requestId.length > 128) return
    const scope = data.scope === 'all' ? 'all' : 'required'
    try {
      const manifests = await host.build
      if (this.host !== host || host.controller.signal.aborted) return
      await this.app().api.do(this.app().baseURL(), 'POST', '/room/mods/answer', {}, { code: host.code, token: host.token, requestId: data.requestId, scope, manifest: manifests[scope] }, host.controller.signal)
    } catch (error) { if (!host.controller.signal.aborted) this.app().netLog('warn', `模组清单应答失败：${(error as Error).message}`) }
  }
  private begin(operation: string) {
    if (!/^[\w-]{1,100}$/.test(operation)) throw new Error('请求标识无效')
    this.operations.get(operation)?.abort()
    const controller = new AbortController(); this.operations.set(operation, controller)
    return controller
  }
  register(ipc: IpcMain) {
    ipc.handle('voxlink:mods:bypass',(_event,code:string)=>{if(!validateRoomCode(code))throw Error('房间码无效');this.bypassed.add(code);return this.skipped(code,'BYPASSED')})
    ipc.handle('voxlink:mods:cancel', (_event, operation: string) => { this.operations.get(operation)?.abort(); this.operations.delete(operation) })
    ipc.handle('voxlink:mods:check', async (_event, payload: { operation: string; code: string; scope: ModSyncScope; target: InstanceTarget }) => {
      const code = String(payload.code).trim().toUpperCase()
      if (!validateRoomCode(code)) throw new Error('请输入有效的六位房间码')
      if(this.bypassed.has(code))return this.skipped(code,'BYPASSED')
      const controller = this.begin(payload.operation), signal = AbortSignal.any([controller.signal, AbortSignal.timeout(12000)])
      try {
        const context = await targetContext(payload.target)
        const scope = payload.scope === 'all' ? 'all' : 'required'
        const api = new ApiClient({ timeoutMs: 5000 })
        let raw: any
        for(let attempt=0;attempt<10&&!signal.aborted;attempt++){
          if(this.bypassed.has(code))return this.skipped(code,'BYPASSED')
          try{raw=await api.do(this.app().baseURL(),'POST','/room/mods/request',{}, {code,scope},signal)
            if(raw?.supported!==true)return this.skipped(code,'UNSUPPORTED')
            if(raw.ready===true)break
            await delay(2000,undefined,{signal})
          }catch(error){controller.signal.throwIfAborted();if(signal.aborted)return this.skipped(code,'NOT_READY');if(error instanceof APIError&&['ROOM_NOT_FOUND','ROOM_EXPIRED','INVALID_TOKEN','ROOM_CLOSED','ROOM_EVICTED','UNKNOWN_ENDPOINT','INVALID_ENDPOINT'].includes(error.code))return this.skipped(code,'NOT_READY');await delay(1500,undefined,{signal})}
        }
        if(raw?.ready!==true || raw.protocolVersion !== 'modSync.v1' || !Array.isArray(raw.mods) || raw.mods.length > 256 || Buffer.byteLength(JSON.stringify(raw)) > 132 * 1024)return this.skipped(code,'NOT_READY')
        const manifest: ModSyncManifest = { protocolVersion: raw.protocolVersion, loader: String(raw.loader || ''), mcVersion: String(raw.mcVersion || ''), mods: raw.mods.filter((m: any) => m && typeof m.sha1 === 'string' && typeof m.fileName === 'string'), unknownMods: Array.isArray(raw.unknownMods) ? raw.unknownMods.filter((x: unknown) => typeof x === 'string').slice(0, 64) : [] }
        if (!manifest.mods.length && !manifest.unknownMods.length)return this.skipped(code,'EMPTY')
        const local = await scanModHashes(context.dir, signal, true)
        signal.throwIfAborted()
        const plan: ModSyncPlan = { gate:'MANIFEST', id: randomUUID(), code, scope, target: context.target, loader: manifest.loader, mcVersion: manifest.mcVersion, rows: diffMods(manifest, local, context.loader, context.mcVersion), unknownMods: manifest.unknownMods }
        for (const [id, value] of this.plans) if (value.expires < Date.now()) this.plans.delete(id)
        if (this.plans.size >= 16) this.plans.delete(this.plans.keys().next().value!)
        this.plans.set(plan.id, { plan, context, expires: Date.now() + 600000 })
        return plan
      } catch (error) { if (signal.aborted && !controller.signal.aborted) return this.skipped(code,'NOT_READY'); throw error }
      finally { if (this.operations.get(payload.operation) === controller) this.operations.delete(payload.operation) }
    })
    ipc.handle('voxlink:mods:download', async (event, payload: { operation: string; plan: string; selected: string[] }) => {
      const owned = this.plans.get(payload.plan)
      if (!owned || owned.expires < Date.now()) throw new Error('模组清单已过期，请重新检查')
      const controller = this.begin(payload.operation), signal = controller.signal
      const staging = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'kamucl-voxlink-mods-'))
      let installed = 0
      try {
        const context = await targetContext(owned.plan.target)
        if (context.dir !== owned.context.dir || context.loader !== owned.context.loader || context.mcVersion !== owned.context.mcVersion) throw new Error('实例配置已改变，请重新检查')
        const selected = new Set(payload.selected)
        const rows = owned.plan.rows.filter(row => row.status === 'missing' && selected.has(row.entry.sha1))
        if (!rows.length) throw new Error('没有可下载的模组，请重新检查清单')
        let progressAt = 0
        const progress = (file: string, bytes: number, total: number) => {
          if (!event?.sender || event.sender.isDestroyed()) return
          if (Date.now() - progressAt < 250 && bytes < total) return
          progressAt = Date.now()
          event.sender.send('voxlink:mods:progress', { operation: payload.operation, installed, total: rows.length, file, bytes, fileSize: total })
        }
        for (const row of rows) {
          signal.throwIfAborted()
          const entry = row.entry, temp = path.join(staging, entry.sha1 + '.jar')
          await downloadFile(entry.url, temp, (bytes, total) => progress(entry.title, bytes, total), entry.sha1, 'official', signal, [], { sha512: entry.sha512, size: entry.size })
          signal.throwIfAborted()
          await fs.promises.mkdir(context.dir, { recursive: true })
          if (!samePath(await fs.promises.realpath(context.dir), context.dir)) throw new Error('模组目录发生变化，已停止同步')
          const current = await scanModHashes(context.dir, signal, true)
          const check = diffMods({ protocolVersion: 'modSync.v1', loader: context.loader, mcVersion: context.mcVersion, mods: [entry], unknownMods: [] }, current, context.loader, context.mcVersion)[0]
          if (check.status === 'installed') continue
          if (check.status !== 'missing') throw new Error(`${entry.title}：${check.reason}`)
          // COPYFILE_EXCL is deliberate: even a concurrent manual install is never overwritten.
          await fs.promises.copyFile(temp, path.join(context.dir, entry.fileName), fs.constants.COPYFILE_EXCL)
          installed++; progress(entry.title, entry.size, entry.size)
        }
        return { installed, message: '同步完成。请关闭当前游戏，再启动所选实例使模组生效。' }
      } finally {
        if (installed) this.app().emit?.('mods:download-result', { installed, message: `已下载 ${installed} 个模组，请关闭当前游戏并重新启动所选实例，使模组生效。` })
        if (this.operations.get(payload.operation) === controller) this.operations.delete(payload.operation)
        await fs.promises.rm(staging, { recursive: true, force: true })
      }
    })
  }
}
