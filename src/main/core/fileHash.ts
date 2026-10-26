import fs from 'node:fs'
import crypto from 'node:crypto'

/** Bounded buffers even for multi-gigabyte resources; no whole-file copy. */
export async function fileHash(file: string, algorithm = 'sha1', signal?: AbortSignal): Promise<string> {
  signal?.throwIfAborted()
  const hash = crypto.createHash(algorithm)
  for await (const chunk of fs.createReadStream(file, { highWaterMark: 256 * 1024, signal })) hash.update(chunk)
  signal?.throwIfAborted()
  return hash.digest('hex')
}
