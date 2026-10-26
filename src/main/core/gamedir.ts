/**
 * 游戏目录迁移：校验（权限/磁盘空间/嵌套）+ 全量数据复制 + 配置切换。
 * 安全语义：复制完成前旧目录与旧配置绝不被修改；失败即回滚（天然，因为配置最后才写）。
 */
import fs from 'node:fs'
import path from 'node:path'
import type { ProgressEvent } from '../../shared/types'
import { getSettings } from './settings'
import { setDownloadGameFolder } from './gameFolders'
import { gameDir as currentGameDir } from './paths'

export type ProgressEmit = (e: ProgressEvent) => void

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

// ---------------- 统计 ----------------

interface DirStats {
  files: number
  bytes: number
}

/** 递归统计目录文件数与总字节（跳过下载临时文件） */
function dirStats(dir: string): DirStats {
  let files = 0
  let bytes = 0
  const walk = (d: string): void => {
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(d, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      if (e.name.endsWith('.part') || e.name.startsWith('.extract-')) continue
      const p = path.join(d, e.name)
      if (e.isDirectory()) walk(p)
      else {
        files++
        try {
          bytes += fs.statSync(p).size
        } catch {
          /* 忽略单文件 */
        }
      }
    }
  }
  walk(dir)
  return { files, bytes }
}

const GB = 1024 * 1024 * 1024

// ---------------- 校验 ----------------

export interface DirCheckResult {
  ok: boolean
  error?: string
  freeGB?: number
  needGB?: number
}

/** 校验目标目录：非当前目录/非嵌套、可创建可写、磁盘剩余空间 ≥ 需求量 × 1.2 */
export function checkTarget(newDir: string, needBytes: number): DirCheckResult {
  let resolved: string
  try {
    resolved = path.resolve(newDir)
  } catch {
    return { ok: false, error: '路径无效' }
  }
  const cur = path.resolve(currentGameDir())
  if (resolved === cur) return { ok: false, error: '新目录与当前游戏目录相同，无需更改' }
  if (resolved.startsWith(cur + path.sep)) {
    return { ok: false, error: '新目录不能位于当前游戏目录内部（会导致无限递归复制）' }
  }
  if (cur.startsWith(resolved + path.sep)) {
    return { ok: false, error: '新目录不能是当前游戏目录的父目录（迁移会破坏自身数据）' }
  }
  try {
    fs.mkdirSync(resolved, { recursive: true })
    // 权限测试：创建并删除一个临时文件
    const probe = path.join(resolved, `.kamucl-probe-${Date.now()}`)
    fs.writeFileSync(probe, 'ok')
    fs.rmSync(probe, { force: true })
  } catch (e) {
    return { ok: false, error: `目标目录不可写（权限问题）：${errText(e)}` }
  }
  if (needBytes > 0) {
    try {
      const st = fs.statfsSync(resolved)
      const free = st.bavail * st.bsize
      const need = Math.ceil(needBytes * 1.2)
      if (free < need) {
        return {
          ok: false,
          error: `目标磁盘剩余空间不足：需要约 ${(need / GB).toFixed(1)} GB，可用 ${(free / GB).toFixed(1)} GB`,
          freeGB: free / GB,
          needGB: need / GB
        }
      }
    } catch {
      /* statfs 不可用时跳过空间校验 */
    }
  }
  return { ok: true }
}

// ---------------- 迁移 ----------------

/**
 * 迁移游戏目录。
 * migrate=true：先把旧目录全部数据复制到新目录（含进度），全部成功后切换配置；
 * migrate=false：仅校验后直接切换配置（新目录从零开始）。
 * 任何一步失败都抛错且配置不变（天然回滚）。
 */
export async function migrateGameDir(
  newDir: string,
  migrate: boolean,
  emit: ProgressEmit
): Promise<string> {
  const src = currentGameDir()
  const resolved = path.resolve(newDir)
  const stats = migrate ? dirStats(src) : { files: 0, bytes: 0 }

  emit({ stage: 'migrate', progress: 0, text: '校验目标目录…' })
  const check = checkTarget(resolved, stats.bytes)
  if (!check.ok) throw new Error(check.error)

  if (migrate && stats.files > 0) {
    let done = 0
    const copyWalk = async (from: string, to: string): Promise<void> => {
      const entries = fs.readdirSync(from, { withFileTypes: true })
      fs.mkdirSync(to, { recursive: true })
      for (const e of entries) {
        if (e.name.endsWith('.part') || e.name.startsWith('.extract-')) continue
        const s = path.join(from, e.name)
        const d = path.join(to, e.name)
        if (e.isDirectory()) {
          await copyWalk(s, d)
        } else {
          try {
            fs.copyFileSync(s, d)
          } catch (err) {
            // 文件被占用时重试一次（如日志文件正被写入）
            try {
              await new Promise((r) => setTimeout(r, 300))
              fs.copyFileSync(s, d)
            } catch {
              throw new Error(`复制失败：${e.name}（${errText(err)}）`)
            }
          }
          done++
          if (done % 20 === 0 || done === stats.files) {
            emit({
              stage: 'migrate',
              progress: (done / stats.files) * 0.98,
              text: `迁移游戏文件 ${done}/${stats.files}`
            })
          }
        }
      }
    }
    await copyWalk(src, resolved)
  }

  // 全部完成才切换配置（之前的任何失败都不会破坏现状）
  setDownloadGameFolder(resolved)
  emit({ stage: 'migrate', progress: 1, text: '游戏目录已切换' })
  return resolved
}

/** 当前数据量概览（供前端在确认弹窗里展示） */
export function currentDataSizeGB(): number {
  return dirStats(currentGameDir()).bytes / GB
}

export function currentGameDirPath(): string {
  return currentGameDir()
}
