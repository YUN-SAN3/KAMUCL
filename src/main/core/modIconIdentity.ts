/** CurseForge file fingerprint: MurmurHash2, seed 1, excluding ASCII whitespace. */
export function curseFingerprint(input: Buffer): number {
  let length = 0
  // MurmurHash2 seeds with the filtered length. Count first, then consume the
  // original bytes directly; a large JAR never needs a second file-sized Buffer.
  for (let i = 0; i < input.length; i++) {
    const byte = input[i]
    if (byte !== 9 && byte !== 10 && byte !== 13 && byte !== 32) length++
  }
  const m = 0x5bd1e995
  let h = (1 ^ length) >>> 0, word = 0, shift = 0
  for (let i = 0; i < input.length; i++) {
    const byte = input[i]
    if (byte === 9 || byte === 10 || byte === 13 || byte === 32) continue
    word |= byte << shift
    if (shift === 24) {
      word = Math.imul(word, m); word ^= word >>> 24; word = Math.imul(word, m)
      h = Math.imul(h, m) ^ word
      word = 0; shift = 0
    } else shift += 8
  }
  if (shift) { h ^= word; h = Math.imul(h, m) }
  h ^= h >>> 13; h = Math.imul(h, m); h ^= h >>> 15
  return h >>> 0
}
