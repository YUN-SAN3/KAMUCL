import { Worker } from 'node:worker_threads'
import path from 'node:path'
import fs from 'node:fs'
import type { ModInfo } from '../../shared/types'
import { logScope } from './launcherLog'

const scans = new Map<string, Promise<Array<ModInfo & { sha1: string }>>>()
/** Management includes disabled files; duplicate/runtime analysis keeps the enabled-only default. */
export async function scanManagedModDirectory(dir:string){
  const entries=await fs.promises.readdir(dir,{withFileTypes:true}).catch(error=>{if(error.code==='ENOENT')return [];throw error})
  return scanModDirectory(dir,true,entries.filter(e=>e.isFile()&&/\.jar(?:\.disabled)?$/i.test(e.name)).map(e=>e.name))
}
export function scanModDirectory(dir: string, hash = false, names?: string[]): Promise<Array<ModInfo & { sha1: string; fingerprint?: number }>> {
  const key = dir + ':' + hash + ':' + JSON.stringify(names)
  if (scans.has(key)) return scans.get(key)!
  const started = Date.now()
  const pending = new Promise<Array<ModInfo & { sha1: string }>>((resolve, reject) => {
    const worker = new Worker(path.join(__dirname, 'modScanWorker.cjs'), { workerData: { dir, hash, names } })
    const timer = setTimeout(() => { void worker.terminate(); reject(new Error('扫描超时，请检查是否有损坏或过大的模组文件')) }, 120_000)
    worker.once('message', ({ result, error }) => {
      clearTimeout(timer)
      void worker.terminate()
      if (error) reject(new Error(error))
      else { logScope('resources').info(`解析 ${dir}：${result.length} 个 JAR，${Date.now() - started} ms（后台线程）`); resolve(result) }
    })
    worker.once('error', e => { clearTimeout(timer); reject(e) })
    worker.once('exit', code => { clearTimeout(timer); if (code !== 0) reject(new Error('模组扫描线程已结束，请重试')) })
  }).finally(() => scans.delete(key))
  scans.set(key, pending)
  return pending
}
