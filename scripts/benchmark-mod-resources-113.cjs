// Isolated source/worker microbenchmarks. Never starts Electron or touches a
// launcher profile. App-wide memory and visual parity require separate evidence.
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const crypto = require('node:crypto')
const v8 = require('node:v8')
const { execFileSync } = require('node:child_process')
const { Worker } = require('node:worker_threads')
const { buildSync, transformSync } = require('esbuild')

const root = path.resolve(__dirname, '..')
const evidence = path.join(root, 'out', 'resource113')
const baselineRef = process.argv[2] || execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
if (!/^[a-f\d]{40}$/i.test(baselineRef)) throw Error('Pass the exact 1.1.12 source commit SHA')
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'kamucl-mod-resource113-'))
const previousSource = name => execFileSync('git', ['show', baselineRef + ':src/main/core/' + name], { cwd: root, encoding: 'utf8' })
const currentSource = name => fs.readFileSync(path.join(root, 'src', 'main', 'core', name), 'utf8')
function evaluate(source) {
  const mod = { exports: {} }
  new Function('require', 'module', 'exports', transformSync(source, { loader: 'ts', format: 'cjs', target: 'node20' }).code)(require, mod, mod.exports)
  return mod.exports
}
function median(values) { const sorted = [...values].sort((a, b) => a - b); return sorted[Math.floor(sorted.length / 2)] }
function measured(action) {
  const cpu = process.cpuUsage(), at = performance.now(), value = action()
  const used = process.cpuUsage(cpu)
  return { wallMs: performance.now() - at, cpuMs: (used.user + used.system) / 1000, value }
}
async function pairs(before, after) {
  const baseline = [], alternating = []
  for (let n = 0; n < 10; n++) baseline.push(await before())
  for (let n = 0; n < 10; n++) {
    const pair = { order: n % 2 ? ['after', 'before'] : ['before', 'after'] }
    for (const name of pair.order) pair[name] = await (name === 'before' ? before() : after())
    alternating.push(pair)
  }
  return { baseline, alternating, medians: Object.fromEntries(['before', 'after'].map(name => [name, {
    wallMs: median(alternating.map(pair => pair[name].wallMs)), cpuMs: median(alternating.map(pair => pair[name].cpuMs))
  }])) }
}
function workerEntry(source) {
  return source.replace('scan().then(result => parentPort!.postMessage({ result }),',
    'const measuredAt=performance.now(),measuredCpu=process.cpuUsage();scan().then(result => parentPort!.postMessage({ result,measurement:{wallMs:performance.now()-measuredAt,cpu:process.cpuUsage(measuredCpu),memory:process.memoryUsage()} }),')
}
function buildWorker(mode) {
  const filename = path.join(work, mode + '-worker.cjs')
  const names = new Set(['modScanWorker.ts', 'modMetadata.ts', 'modIconIdentity.ts'])
  // buildSync does not support plugins: use source copies and rewrite only the
  // three changed modules' local imports into their captured source directory.
  const sourceDir = path.join(work, mode)
  fs.mkdirSync(sourceDir)
  for (const name of names) {
    let source = mode === 'before' ? previousSource(name) : currentSource(name)
    if (name === 'modScanWorker.ts') source = workerEntry(source)
    source = source.replace(/from '(\.{1,2}\/[^']+)'/g, (all, specifier) => specifier.startsWith('./') && names.has(specifier.slice(2) + '.ts') ? all : "from '" + path.resolve(root, 'src', 'main', 'core', specifier).replaceAll('\\', '/') + "'")
    fs.writeFileSync(path.join(sourceDir, name), source)
  }
  buildSync({ entryPoints: [path.join(sourceDir, 'modScanWorker.ts')], outfile: filename, bundle: true, platform: 'node', format: 'cjs', target: 'node20', nodePaths: [path.join(root, 'node_modules')] })
  return filename
}

async function main() {
  fs.mkdirSync(evidence, { recursive: true })
  const report = { version: '1.1.13', baselineRef, recordedAt: new Date().toISOString(), host: { platform: process.platform, arch: process.arch, node: process.version, cpu: os.cpus()[0]?.model }, scope: 'Node source/worker microbenchmarks only; no Electron/App baseline and no forced GC or working-set trimming.', rawRuns: '10 baseline runs plus 10 alternating pairs per timed workload', fingerprints: {}, catalog: {}, queue: {}, planLifetime: {} }
  const previous = evaluate(previousSource('modIconIdentity.ts')).curseFingerprint, current = evaluate(currentSource('modIconIdentity.ts')).curseFingerprint
  const input = Buffer.allocUnsafe(16 * 1024 * 1024)
  for (let i = 0; i < input.length; i++) input[i] = (i * 37 + (i >>> 13) * 11) & 255
  const expected = previous(input)
  for (let n = 0; n < 3; n++) { previous(input); current(input) }
  const allocate = Buffer.allocUnsafe
  function allocated(fn) { let bytes = 0, count = 0; try { Buffer.allocUnsafe = size => { count++; bytes += size; return allocate(size) }; const value = fn(input); if (value !== expected) throw Error('Fingerprint mismatch'); return { explicitBufferAllocations: count, explicitBufferBytes: bytes } } finally { Buffer.allocUnsafe = allocate } }
  const allocations = { before: allocated(previous), after: allocated(current) }
  const measureFingerprint = fn => () => { const sample = measured(() => fn(input)); if (sample.value !== expected) throw Error('Fingerprint mismatch'); return sample }
  report.fingerprints = { inputBytes: input.length, sourceBeforeSHA256: crypto.createHash('sha256').update(previousSource('modIconIdentity.ts')).digest('hex'), sourceAfterSHA256: crypto.createHash('sha256').update(currentSource('modIconIdentity.ts')).digest('hex'), allocations, ...await pairs(measureFingerprint(previous), measureFingerprint(current)) }

  const beforeWorker = buildWorker('before'), afterWorker = buildWorker('after')
  const fixtureDir = path.join(work, 'jars'); fs.mkdirSync(fixtureDir)
  const raw = Buffer.allocUnsafe(256 * 256 * 3); let seed = 0x113785
  for (let i = 0; i < raw.length; i++) { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; raw[i] = seed & 255 }
  const icon = await require('sharp')(raw, { raw: { width: 256, height: 256, channels: 3 } }).png().toBuffer()
  const zip = new (require('adm-zip'))(); zip.addFile('fabric.mod.json', Buffer.from(JSON.stringify({ id: 'fixture', name: 'Resource benchmark', version: '1', icon: 'icon.png' }))); zip.addFile('icon.png', icon)
  const jar = zip.toBuffer(), names = []
  for (let n = 0; n < 150; n++) { const name = 'fixture-' + n + (n % 7 ? '.jar' : '.jar.disabled'); names.push(name); fs.writeFileSync(path.join(fixtureDir, name), jar) }
  let identityDigest
  function runWorker(filename, purpose) {
    const at = performance.now()
    return new Promise((resolve, reject) => {
      const worker = new Worker(filename, { workerData: { dir: fixtureDir, hash: true, names, purpose } })
      worker.once('error', reject)
      worker.once('message', message => {
        void worker.terminate()
        if (message.error) { reject(Error(message.error)); return }
        const wallMs = performance.now() - at, result = message.result, meta = result.map(({ iconDataUrl, ...row }) => row)
        const digest = crypto.createHash('sha256').update(JSON.stringify(meta)).digest('hex')
        identityDigest ??= digest
        if (digest !== identityDigest || result.length !== names.length) { reject(Error('Catalog identity mismatch')); return }
        resolve({ wallMs, cpuMs: (message.measurement.cpu.user + message.measurement.cpu.system) / 1000, workerWallMs: message.measurement.wallMs, workerMemorySnapshot: message.measurement.memory, serializedResultBytes: v8.serialize(result).byteLength, iconDataUrlCharacters: result.reduce((sum, row) => sum + (row.iconDataUrl?.length || 0), 0), metadataSHA256: digest })
      })
    })
  }
  // A warmup on each implementation is deliberately outside the raw runs.
  await runWorker(beforeWorker); await runWorker(afterWorker, 'catalog')
  report.catalog = { fixture: { files: names.length, iconBytes: icon.length, jarBytes: jar.length, jarSHA256: crypto.createHash('sha256').update(jar).digest('hex') }, ...await pairs(() => runWorker(beforeWorker), () => runWorker(afterWorker, 'catalog')), memoryLimitation: 'workerMemorySnapshot.rss is this isolated Node process RSS, not launcher memory; heapUsed/external are pre-postMessage worker snapshots, without forced GC.' }

  const icons = Object.fromEntries(Array.from({ length: 100 }, (_, n) => ['icon-' + n, 'data:image/png;base64,' + icon.toString('base64')]))
  async function queueRun(mode) {
    let tail = Promise.resolve(), returned = 0
    const at = performance.now(), cpu = process.cpuUsage()
    for (let n = 0; n < 500000; n++) {
      const job = (mode === 'before' ? tail.catch(() => undefined) : tail).then(() => icons)
      tail = mode === 'before' ? job : job.then(() => undefined, () => undefined)
      if (await job !== icons) throw Error('Caller result lost'); returned++
    }
    const value = await tail, used = process.cpuUsage(cpu)
    return { wallMs: performance.now() - at, cpuMs: (used.user + used.system) / 1000, returned, tailSerializedBytes: v8.serialize(value).byteLength, tailContainsLastIconMap: value === icons }
  }
  report.queue = { fixture: { jobsPerRun: 500000, icons: 100, iconDataUrlCharacters: Object.values(icons).reduce((sum, value) => sum + value.length, 0) }, ...await pairs(() => queueRun('before'), () => queueRun('after')), scope: 'Serialization-tail ownership probe; these payload bytes are not an App process-memory measurement.' }

  const { ModPlanStore } = evaluate(currentSource('modPlanStore.ts'))
  async function lifetime(mode) {
    const timed = measured(() => {
      let now = 0, timerCount = 0, callback
      const store = mode === 'before' ? new Map() : new ModPlanStore(30 * 60_000, { now: () => now, setTimeout: cb => { callback = cb; timerCount = 1; return { unref() {} } }, clearTimeout: () => { timerCount = 0; callback = undefined } }, 8)
      const payload = Array.from({ length: 1000 }, (_, i) => ({ fileName: 'mod-' + i + '.jar', sha1: '1'.repeat(40) }))
      let maximum = 0
      for (let n = 0; n < 1000; n++) { store.set(String(n), { payload }); maximum = Math.max(maximum, store.size) }
      // 1.1.12 only prunes when another operation arrives. No such request is
      // made here; 1.1.13's real callback runs when its deadline arrives.
      now = 30 * 60_000; if (mode === 'after') callback?.()
      return { maximumSnapshots: maximum, snapshotsAfterIdleDeadline: store.size, timerCount }
    })
    return { wallMs: timed.wallMs, cpuMs: timed.cpuMs, ...timed.value }
  }
  report.planLifetime = { ...await pairs(() => lifetime('before'), () => lifetime('after')), scope: 'Simulated deadline and real production store implementation; old Map deliberately receives no later prune-triggering request. Lifetime correctness, not equivalent CPU work.' }
  const destination = path.join(evidence, 'mod-resource-benchmark.json')
  fs.writeFileSync(destination, JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify({ evidence: destination, fingerprint: report.fingerprints.medians, fingerprintAllocatedBytes: allocations, catalog: report.catalog.medians, catalogPayload: { before: report.catalog.alternating[0].before.serializedResultBytes, after: report.catalog.alternating[0].after.serializedResultBytes }, queue: report.queue.medians, plans: report.planLifetime.medians }, null, 2))
}
main().finally(() => {
  const resolved = path.resolve(work), tempRoot = path.resolve(os.tmpdir()) + path.sep
  if (resolved.startsWith(tempRoot) && path.basename(resolved).startsWith('kamucl-mod-resource113-')) fs.rmSync(resolved, { recursive: true, force: true })
}).catch(error => { console.error(error); process.exitCode = 1 })
