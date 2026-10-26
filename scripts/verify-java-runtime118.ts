import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import assert from 'node:assert/strict'
import { probeJavaAsync, resolveJavaExecutable } from '../src/main/core/java'
import { validateJavaRuntime } from '../src/main/core/javaRuntimeHealth'
import { buildJavaRequirement, javaCompatibilityError, prepareCompatibleJava } from '../src/main/core/javaCompatibility'
import { createOfficialJavaReader } from '../src/main/core/javaMetadata'
import type { JavaInfo } from '../src/shared/types'

async function main() {
  const output = path.resolve('out/java118-validation')
  await fs.mkdir(output, { recursive: true })
  const sources: Record<string, string> = {}
  for (const name of ['java.ts', 'javaCompatibility.ts', 'javaMetadata.ts', 'javaPreparation.ts', 'javaRuntimeHealth.ts']) {
    sources[name] = crypto.createHash('sha256').update(await fs.readFile(path.join('src/main/core', name))).digest('hex')
  }
  const paths = [
    process.env.KAMUCL_TEST_JAVA8 ?? path.resolve('out/java118-runtime/unpacked/zulu8.96.0.205-ca-jre8.0.504-win_x64/bin/java.exe'),
    process.env.KAMUCL_TEST_JAVA17 ?? 'C:/Program Files/Java/jdk-17/bin/java.exe',
    process.env.KAMUCL_TEST_JAVA21 ?? 'C:/Program Files/Java/jdk-21.0.12/bin/java.exe',
    process.env.KAMUCL_TEST_JAVA25 ?? 'C:/Program Files/Java/jdk-25.0.2/bin/java.exe'
  ]
  const runtimes: JavaInfo[] = []
  for (const candidate of paths) {
    const exe = await resolveJavaExecutable(candidate)
    const info = await probeJavaAsync(exe)
    assert(info && info.is64Bit && info.architecture === 'x64')
    await validateJavaRuntime(exe, info.major)
    runtimes.push(info)
  }
  assert.deepEqual(runtimes.map(j => j.major), [8, 17, 21, 25])
  const decisions: Array<{ game: string; selected: number; requestedDownload: number | null; path: string }> = []
  for (const [mc, major] of [['1.12.2', 8], ['1.20.1', 17], ['1.21.11', 21], ['26.1', 25]] as const) {
    const profile = { id: 'isolated-fixture', _mcVersion: mc, _loader: 'forge' as const }
    const req = buildJavaRequirement(profile)
    let requestedDownload: number | null = null
    const local = mc === '1.12.2' || mc === '1.20.1' ? runtimes.filter(j => j.major >= 21) : runtimes
    const selected = await prepareCompatibleJava(req, local, async j => { await validateJavaRuntime(j.path, j.major); return j }, async need => {
      // Use the separately SHA256-verified fixture runtime to test the native
      // post-install path without downloading the same archive for every probe.
      requestedDownload = need
      const supplied = runtimes.find(j => j.major === need)
      assert(supplied)
      await validateJavaRuntime(supplied.path, supplied.major)
      return supplied
    }, 'x64')
    assert.equal(selected.major, major)
    decisions.push({ game: mc, selected: selected.major, requestedDownload, path: selected.path })
  }
  const modern = buildJavaRequirement({ id: 'fixture', _mcVersion: '1.20.1', _loader: 'forge', libraries: [{ name: 'org.ow2.asm:asm:9.8' }] })
  assert.equal(javaCompatibilityError(runtimes[3], modern, 'x64'), undefined)
  const official = createOfficialJavaReader(() => path.join(output, 'metadata'), async (url, signal) => {
    const response = await fetch(url, { signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000) })
    if (!response.ok) throw new Error(`official metadata HTTP ${response.status}`)
    return response.text()
  })
  const metadata = []
  for (const [mc, major] of [['21w18a', 8], ['21w19a', 16], ['24w13a', 17], ['24w14a', 21], ['26.3', 25]] as const) {
    const json = await official(mc)
    const req = buildJavaRequirement({ id: 'custom-inherited', inheritsFrom: mc }, undefined, json)
    assert.equal(req.recommendedMajor, major)
    metadata.push({ game: mc, major: req.recommendedMajor, source: req.source })
  }
  const receipt = { at: new Date().toISOString(), platform: process.platform, architecture: process.arch, sources, runtimes, decisions, metadata, manualForge25Allowed: true }
  await fs.writeFile(path.join(output, 'receipt.json'), JSON.stringify(receipt, null, 2))
  process.stdout.write(JSON.stringify({ receipt: path.join(output, 'receipt.json'), runtimes: runtimes.map(j => j.major), decisions, metadata }, null, 2) + '\n')
}
void main().catch(error => { console.error(error); process.exitCode = 1 })
