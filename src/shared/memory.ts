/**
 * 内存自动分配：按物理内存 25% 取 0.5GB 整，夹在 2GB~8GB。
 * 覆盖大多数场景（原版/中小整合包）；大型整合包用户仍可手动调高。
 */
export function autoMemoryMB(totalMemMB: number): number {
  const quarter = Math.floor((totalMemMB * 0.25) / 512) * 512
  return Math.min(8192, Math.max(2048, quarter))
}
