/** CurseForge file fingerprint: MurmurHash2, seed 1, excluding ASCII whitespace. */
export function curseFingerprint(input: Buffer): number {
  const data = Buffer.allocUnsafe(input.length)
  let length = 0
  for (const byte of input) if (byte !== 9 && byte !== 10 && byte !== 13 && byte !== 32) data[length++] = byte
  const m = 0x5bd1e995
  let h = (1 ^ length) >>> 0, at = 0
  while (length - at >= 4) {
    let k = data.readUInt32LE(at)
    k = Math.imul(k, m); k ^= k >>> 24; k = Math.imul(k, m)
    h = Math.imul(h, m) ^ k; at += 4
  }
  const tail = length - at
  if (tail >= 3) h ^= data[at + 2] << 16
  if (tail >= 2) h ^= data[at + 1] << 8
  if (tail >= 1) { h ^= data[at]; h = Math.imul(h, m) }
  h ^= h >>> 13; h = Math.imul(h, m); h ^= h >>> 15
  return h >>> 0
}
