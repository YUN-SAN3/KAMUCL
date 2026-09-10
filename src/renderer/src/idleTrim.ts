/**
 * 渲染层空闲瘦身：窗口静默（最小化/隐藏/遮挡）时暂停可重建缓存并主动触发 GC。
 * 触发双通道：
 * - document.visibilitychange（Electron 在 Windows 上最小化/遮挡即转 hidden，天然覆盖所有场景）
 * - 主进程 minimize/hide 广播（kamucl:mem-trim，与 memTrim.ts 的常量对应；通道串在两处各自局部维护）
 * 主进程 js-flags 已带 --expose-gc，hidden 时调 window.gc?.() 回收已释放引用的堆内存。
 * 大缓存（轮播图预加载、皮肤纹理等）的持有方通过 registerIdleReleasable 注册释放/重建钩子，
 * 本模块不直接持有任何视图引用。
 */

export interface IdleReleasable {
  /** 释放可重建的大缓存引用（不丢功能：回到前台时按需重建） */
  release(): void
  /** 可选：窗口恢复时的即时重建钩子（懒加载场景可省略） */
  restore?(): void
}

const releasables = new Set<IdleReleasable>()

/** 注册可释放缓存；返回注销函数。重复注册同一对象会被去重。 */
export function registerIdleReleasable(releasable: IdleReleasable): () => void {
  releasables.add(releasable)
  return () => releasables.delete(releasable)
}

declare global {
  interface Window {
    /** --expose-gc 开启后存在；缺失时静默跳过 */
    gc?: () => void
  }
}

let started = false

function applyHiddenState(hidden: boolean): void {
  for (const releasable of releasables) {
    try {
      if (hidden) releasable.release()
      else releasable.restore?.()
    } catch {
      /* 单个钩子失败不影响其他瘦身步骤 */
    }
  }
  if (hidden) {
    // 释放引用后主动 GC，让堆立刻回落（无 --expose-gc 时静默跳过）
    try {
      window.gc?.()
    } catch {
      /* GC 失败无碍 */
    }
  }
}

/** 全局只启动一次；在 main.ts 挂载后调用。 */
export function startIdleTrim(): void {
  if (started) return
  started = true
  document.addEventListener('visibilitychange', () => applyHiddenState(document.hidden))
  try {
    window.kamucl.on('kamucl:mem-trim', () => applyHiddenState(true))
  } catch {
    /* 桥接不可用（测试环境）时仅靠 visibilitychange 工作 */
  }
}
