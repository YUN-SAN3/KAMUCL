/** Display the publisher's release timestamp in the player's local timezone, to the minute. */
export function formatReleaseTime(iso: string): string {
  const d = new Date(iso)
  if (!Number.isFinite(d.getTime())) return '发布时间未知'
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}/${pad(d.getMonth()+1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}
