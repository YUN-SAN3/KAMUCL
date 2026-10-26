import type { ServerEntry } from './types'

/** Display privacy only. The real address remains unchanged for ping/copy/join. */
export function privateServerText(text: string, server: Pick<ServerEntry, 'address' | 'host'>, revealed = false): string {
  if (revealed) return text
  const address = server.address.trim()
  const inferredHost = address.startsWith('[')
    ? address.slice(1, address.indexOf(']'))
    : address.split(':').length === 2 ? address.slice(0, address.lastIndexOf(':')) : address
  const candidates = [...new Set([address, server.host, inferredHost].filter((value): value is string => !!value))]
    .sort((a, b) => b.length - a.length)
  if (!candidates.length) return text
  const pattern = candidates.map(value => {
    const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    // Labels such as “服务器IP为127…” are not part of an IPv4 address.
    // Keep numerical address boundaries so 192.0.2.10 cannot hide .100.
    if (/^\d{1,3}(?:\.\d{1,3}){3}(?::\d{1,5})?$/.test(value)) {
      return `(?<![0-9.])${escaped}(?::\\d{1,5})?(?![0-9.:])`
    }
    if (value.startsWith('[')) return `${escaped}(?::\\d{1,5})?(?![0-9:])`
    if (value.split(':').length > 2) return `(?<![0-9a-f:])${escaped}(?![0-9a-f:])`
    // Chinese prose can touch a complete DNS name; an ASCII DNS prefix or
    // suffix belongs to a different host and must remain untouched.
    if (value.includes('.')) return `(?<![a-z0-9._-])${escaped}(?::\\d{1,5})?(?![a-z0-9._:-])`
    return `(?<![\\p{L}\\p{N}._-])${escaped}(?::\\d{1,5})?(?![\\p{L}\\p{N}._:-])`
  }).join('|')
  return text.replace(new RegExp(pattern, 'giu'), '地址已隐藏')
}

export function serverAddressRevealed(server: Pick<ServerEntry, 'id' | 'address'>, visible: { id: string; address: string } | null): boolean {
  return visible?.id === server.id && visible.address === server.address
}
