import { Worker } from 'node:worker_threads'
import path from 'node:path'
import fs from 'node:fs'
import type { ModInfo } from '../../shared/types'
import { logScope } from './launcherLog'

type ScanResult = Array<ModInfo & { sha1: string; fingerprint?: number }>
interface SharedScan { promise: Promise<ScanResult>; controller: AbortController; consumers: number }
const scans = new Map<string, SharedScan>()
export type ModScanPurpose = 'analysis' | 'catalog' | 'icons'
/** Management includes disabled files; duplicate/runtime analysis keeps the enabled-only default. */
export async function scanManagedModDirectory(dir:string,purpose:ModScanPurpose='analysis'){
  const entries=await fs.promises.readdir(dir,{withFileTypes:true}).catch(error=>{if(error.code==='ENOENT')return [];throw error})
  return scanModDirectory(dir,true,entries.filter(e=>e.isFile()&&/\.jar(?:\.disabled)?$/i.test(e.name)).map(e=>e.name),purpose)
}
export function scanModDirectory(dir: string, hash = false, names?: string[], purpose: ModScanPurpose = 'analysis', signal?: AbortSignal): Promise<ScanResult> {
  signal?.throwIfAborted()
  // A catalog request must not reuse an icon-bearing result, or vice versa.
  const key = JSON.stringify([dir, hash, names, purpose])
  let record = scans.get(key)
  if (!record || record.controller.signal.aborted) {
    const controller = new AbortController(), started = Date.now()
    const owned: SharedScan = { promise: Promise.resolve([]), controller, consumers: 0 }
    owned.promise = new Promise<ScanResult>((resolve, reject) => {
      const worker = new Worker(path.join(__dirname, 'modScanWorker.cjs'), { workerData: { dir, hash, names, purpose } })
      let settled = false
      const finish = (result?: ScanResult, error?: unknown) => {
        if (settled) return
        settled = true
        clearTimeout(timer); controller.signal.removeEventListener('abort', abort)
        // Drain the owned worker before completing the shared operation. A caller
        // can leave immediately, without terminating a scan still needed by others.
        void worker.terminate().then(() => {
          if (error) reject(error)
          else { logScope('resources').info(`解析 ${dir}：${result!.length} 个 JAR，${Date.now() - started} ms（后台线程）`); resolve(result!) }
        }, reject)
      }
      const abort = () => finish(undefined, controller.signal.reason)
      const timer = setTimeout(() => finish(undefined, new Error('扫描超时，请检查是否有损坏或过大的模组文件')), 120_000)
      controller.signal.addEventListener('abort', abort, { once: true })
      worker.once('message', ({ result, error }) => finish(result, error ? new Error(error) : undefined))
      worker.once('error', error => finish(undefined, error))
      worker.once('exit', () => finish(undefined, new Error('模组扫描线程已结束，请重试')))
    }).finally(() => { if (scans.get(key) === owned) scans.delete(key) })
    record = owned; scans.set(key, record)
  }
  const owned = record
  owned.consumers++
  return new Promise<ScanResult>((resolve, reject) => {
    let done = false
    const cleanup = () => { if (done) return; done = true; signal?.removeEventListener('abort', abort); owned.consumers-- }
    const abort = () => { cleanup(); if (!owned.consumers) owned.controller.abort(signal?.reason); reject(signal?.reason ?? new DOMException('已取消', 'AbortError')) }
    signal?.addEventListener('abort', abort, { once: true })
    if (signal?.aborted) abort()
    owned.promise.then(result => { cleanup(); resolve(result) }, error => { cleanup(); reject(error) })
  })
}
