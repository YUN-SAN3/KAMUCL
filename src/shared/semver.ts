/**
 * 语义化版本比较（禁止字符串比较：v1.10.0 > v1.9.9）。
 * 仅支持 x.y.z 数字段；前导 v/V 与后缀（-beta 等）先剥离。
 */
export function parseSemver(v: string): [number, number, number] | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)/.exec(String(v ?? '').trim())
  if (!m) return null
  return [Number(m[1]), Number(m[2]), Number(m[3])]
}

/** a > b → 1；a = b → 0；a < b → -1；无法解析的按相等处理（不误导更新提示） */
export function compareSemver(a: string, b: string): number {
  const pa = parseSemver(a)
  const pb = parseSemver(b)
  if (!pa || !pb) return 0
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] > pb[i] ? 1 : -1
  }
  return 0
}

/** target 是否比 current 新（严格大于） */
export function isNewerVersion(target: string, current: string): boolean {
  return compareSemver(target, current) > 0
}
