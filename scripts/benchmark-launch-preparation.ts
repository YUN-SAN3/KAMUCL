// Real streaming SHA1 reads on a private fixture; not a Minecraft loading-time claim.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import assert from 'node:assert/strict'
import { performance } from 'node:perf_hooks'
import { mapLaunchFiles } from '../src/main/core/launchPreparation'
import { invalidLaunchArtifact } from '../src/main/core/launchIntegrity'

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kamucl launch benchmark-'))
  try {
    const files = Array.from({ length: 200 }, (_, i) => {
      const data = crypto.randomBytes((i % 8 + 1) * 128 * 1024)
      const dest = path.join(dir, `${i}.jar`); fs.writeFileSync(dest, data)
      return { dest, size: data.length, sha1: crypto.createHash('sha1').update(data).digest('hex') }
    })
    const samples: { serialMs: number; parallelMs: number }[] = []
    for (let round = 0; round < 6; round++) {
      const sample = { serialMs: 0, parallelMs: 0 }
      // Alternate order to reduce filesystem-cache/order bias.
      for (const parallel of round % 2 ? [true, false] : [false, true]) {
        const start = performance.now()
        const result = parallel ? await mapLaunchFiles(files, invalidLaunchArtifact)
          : await mapLaunchFiles(files, invalidLaunchArtifact, 1)
        assert(result.every(r => r === null))
        sample[parallel ? 'parallelMs' : 'serialMs'] = Math.round(performance.now() - start)
      }
      samples.push(sample)
    }
    const median = (key: keyof typeof samples[number]) => {
      const sorted = samples.map(sample => sample[key]).sort((a, b) => a - b)
      return (sorted[2] + sorted[3]) / 2
    }
    const report = { files: files.length, bytes: files.reduce((n, f) => n + f.size, 0), rounds: samples, serialMedianMs: median('serialMs'), parallelMedianMs: median('parallelMs') }
    fs.writeFileSync('out/launch-preparation-benchmark-1059.json', JSON.stringify(report, null, 2))
    console.log(JSON.stringify(report, null, 2))
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
