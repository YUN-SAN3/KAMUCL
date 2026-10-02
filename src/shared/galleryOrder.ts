/** Only reorder known stable keys; selection, durations and managed files are independent. */
export function reorderGallery(keys: readonly string[], from: string, to: string): string[] {
  const next = [...keys], source = next.indexOf(from), target = next.indexOf(to)
  if (source < 0 || target < 0 || source === target) return next
  next.splice(source, 1)
  next.splice(target, 0, from)
  return next
}
