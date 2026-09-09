/** 任务完成事件到达后才显示 100%，避免 99.5% 被四舍五入成完成。 */
export function taskProgressPercent(task: { status: string; progress: number }): number {
  if (task.status === 'done') return 100
  const value = Number.isFinite(task.progress) ? task.progress : 0
  return Math.max(0, Math.min(99, Math.floor(value * 100)))
}
