// Isolated algorithm qualification, not Electron/native APP acceptance. Every
// child exits naturally; this tool never trims, forces GC or alters user data.
// The two failed candidate readers live with their raw evidence, outside product
// source. Replay explicitly with --reader=<archived-reader.ts> (and optionally
// --fixture=<fixture.json>); an unused candidate is never added to the product.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os')
const crypto = require('node:crypto'), assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const ROOT = path.resolve(__dirname, '..')
const percentile = (values, p) => [...values].sort((a, b) => a - b)[Math.ceil(values.length * p) - 1]
const stats = values => ({ raw: values, median: percentile(values, .5), p95: percentile(values, .95), min: Math.min(...values), max: Math.max(...values) })
async function sha(file) { const digest = crypto.createHash('sha256'); for await (const chunk of fs.createReadStream(file)) digest.update(chunk); return digest.digest('hex') }

function fixture(directory) {
  const file = path.join(directory, 'modrinth.index.json'), fd = fs.openSync(file, 'wx')
  let count = 0, bytes = 0, batch = '', first = null, last = null
  const write = text => { const data = Buffer.from(text); fs.writeSync(fd, data); bytes += data.length }
  try {
    write('{"formatVersion":1,"game":"minecraft","versionId":"resource113","name":"合成的大型模组清单","summary":"30 MiB manifest qualification","dependencies":{"minecraft":"1.20.1","fabric-loader":"0.16.0"},"files":[')
    while (bytes + Buffer.byteLength(batch) < 30 * 1024 * 1024) {
      const n = count++, entry = { path: 'mods/resource-' + String(n).padStart(7, '0') + '.jar', hashes: { sha1: crypto.createHash('sha1').update('fixture ' + n).digest('hex'), sha512: crypto.createHash('sha512').update('fixture ' + n).digest('hex') }, env: { client: 'required', server: 'optional' }, downloads: ['https://fixture.invalid/resource-' + n + '.jar'], fileSize: 1000 + n }
      first ??= entry; last = entry; batch += (n ? ',' : '') + JSON.stringify(entry)
      if (count % 1000 === 0) { write(batch); batch = '' }
    }
    write(batch + ']}')
  } finally { fs.closeSync(fd) }
  assert(count < 250000); assert(bytes >= 30 * 1024 * 1024)
  const meta = { schema: 1, file, bytes, fileCount: count, first, last, kind: 'Synthetic but structurally valid Modrinth index; complete hashes/env/downloads/fileSize. No player/private data.', chunkBytes: 1024 * 1024 }
  fs.writeFileSync(path.join(directory, 'fixture.json'), JSON.stringify(meta, null, 2) + '\n', { flag: 'wx' })
  return meta
}

async function oldEntryGetData(source) {
  // Match the existing disk ZIP getData's scope: chunks are no longer reachable
  // from our code once the aggregate Buffer is returned. Do not keep them alive
  // through JSON.parse merely to inflate the old-path peak.
  const chunks = []; for await (const chunk of source) chunks.push(chunk)
  return Buffer.concat(chunks)
}
async function child(specFile, resultFile) {
  const spec = JSON.parse(fs.readFileSync(specFile, 'utf8'))
  require('tsx/cjs')
  // Import the same candidate module before timing in both child modes, keeping
  // TS transpilation/loading out of the algorithm and avoiding a startup bias.
  const { readJsonStream } = require(spec.reader)
  const samples = [], events = [], startClock = performance.now()
  const observe = stage => { const m = process.memoryUsage(); samples.push({ atUnixMs: Date.now(), monoMs: performance.now(), stage, rssBytes: m.rss, heapUsedBytes: m.heapUsed, externalBytes: m.external, arrayBufferBytes: m.arrayBuffers }) }
  observe('before-read')
  const cpuBefore = process.cpuUsage(), start = performance.now(), timer = setInterval(() => observe('reading'), 10)
  events.push({ event: 'read-start', atUnixMs: Date.now(), monoMs: start })
  let value, elapsedMs, cpu, usage
  try {
    const source = fs.createReadStream(spec.fixture.file, { highWaterMark: spec.fixture.chunkBytes })
    value = spec.mode === 'baseline' ? JSON.parse((await oldEntryGetData(source)).toString('utf8')) : await readJsonStream(source)
    elapsedMs = performance.now() - start; cpu = process.cpuUsage(cpuBefore)
    // Native per-process resident high-water count includes the synchronous
    // parse peak that a timer cannot sample. Capture it before validation.
    usage = process.resourceUsage(); observe('parse-complete')
    events.push({ event: 'parse-complete', atUnixMs: Date.now(), monoMs: performance.now() })
  } finally { clearInterval(timer) }
  assert.equal(value.formatVersion, 1); assert.equal(value.game, 'minecraft'); assert.equal(value.name, '合成的大型模组清单')
  assert.deepEqual(value.dependencies, { minecraft: '1.20.1', 'fabric-loader': '0.16.0' })
  assert.equal(value.files.length, spec.fixture.fileCount); assert.deepEqual(value.files[0], spec.fixture.first); assert.deepEqual(value.files.at(-1), spec.fixture.last)
  const digest = crypto.createHash('sha256')
  for (const entry of value.files) {
    assert.equal(entry.env.client, 'required'); assert.equal(entry.env.server, 'optional')
    digest.update(entry.path + '\0' + entry.hashes.sha1 + '\0' + entry.hashes.sha512 + '\0' + entry.downloads[0] + '\0' + entry.fileSize + '\n')
  }
  const output = { schema: 1, complete: true, spec, pid: process.pid, node: process.versions.node, platform: process.platform, arch: process.arch, startedAtUnixMs: events[0].atUnixMs, finishedAtUnixMs: Date.now(), elapsedMs, cpuUserMicros: cpu.user, cpuSystemMicros: cpu.system, cpuTotalMicros: cpu.user + cpu.system, nativeProcessPeakResidentBytes: usage.maxRSS * 1024, resourceUsageAtParseComplete: usage, sampledPeak: Object.fromEntries(['rssBytes', 'heapUsedBytes', 'externalBytes', 'arrayBufferBytes'].map(key => [key, Math.max(...samples.map(row => row[key]))])), events, samples, output: { fileCount: value.files.length, digest: digest.digest('hex') }, processWallMsThroughValidation: performance.now() - startClock, classification: 'Actual isolated Node reader microbenchmark, 1 MiB file stream chunks, native JSON.parse. Native high-water RSS is resident memory; neither private commit nor Mac physical footprint. Timer peaks can miss synchronous allocations. No forced GC, trims, warmup deletion or discarded outliers.' }
  fs.writeFileSync(resultFile, JSON.stringify(output, null, 2) + '\n', { flag: 'wx' })
  console.log(JSON.stringify({ resultFile, complete: true, mode: spec.mode, elapsedMs, cpuTotalMicros: output.cpuTotalMicros, nativeProcessPeakResidentBytes: output.nativeProcessPeakResidentBytes }))
}

function signProbability(deltas) { const nonzero = deltas.filter(d => d !== 0), n = nonzero.length, k = nonzero.filter(d => d > 0).length; let term = 2 ** -n, p = 0; for (let i = 0; i <= n; i++) { if (i >= k) p += term; term *= (n - i) / (i + 1) } return { nonzeroPairs: n, regressingPairs: k, oneSidedExactProbability: n ? p : 1 } }
async function main() {
  const reader = path.resolve(process.argv.find(arg => arg.startsWith('--reader='))?.slice(9) || '')
  assert(fs.existsSync(reader) && fs.statSync(reader).isFile(), 'Explicit --reader=<archived-reader.ts> is required; no failed candidate belongs to product source')
  const directory = path.join(ROOT, 'out/resource113/json-stream-' + Date.now()); fs.mkdirSync(directory, { recursive: true })
  const reuse = process.argv.find(arg => arg.startsWith('--fixture='))?.slice(10)
  const input = reuse ? JSON.parse(fs.readFileSync(path.resolve(reuse), 'utf8')) : fixture(directory)
  assert.equal(fs.statSync(input.file).size, input.bytes); assert(input.bytes >= 30 * 1024 * 1024); input.sha256 = await sha(input.file)
  const receipt = { schema: 1, startedAt: new Date().toISOString(), directory, fixture: input, reader, readerSHA256: await sha(reader), benchmarkSHA256: await sha(__filename), node: process.versions, host: { platform: process.platform, arch: process.arch, os: os.release(), cpu: os.cpus()[0]?.model, cores: os.cpus().length, totalMemoryBytes: os.totalmem() }, baseline: [], pairs: [], complete: false, limitations: ['Synthetic valid manifest shape, not an external public pack', 'Same host fresh isolated Node processes; not Electron application, signed Mac binary, private commit or physical footprint', 'Native maxRSS includes module startup high-water, captured before output validation', 'Complete JSON text and parsed objects remain necessary; releasing references does not force collection', '10 ms timer samples cannot see every synchronous transient; kernel maxRSS supplies actual resident high-water', 'No cache clear or disk-cold claim; no forced GC, working-set trim, outlier deletion or fixed allowed percentage'] }
  fs.copyFileSync(reader, path.join(directory, 'candidate-reader.ts'), fs.constants.COPYFILE_EXCL)
  fs.copyFileSync(__filename, path.join(directory, 'benchmark-source.cjs'), fs.constants.COPYFILE_EXCL)
  const save = () => fs.writeFileSync(path.join(directory, 'summary.json'), JSON.stringify(receipt, null, 2) + '\n')
  save(); console.log('JSON_STREAM_BENCH ' + directory)
  const metrics = ['elapsedMs', 'cpuTotalMicros', 'nativeProcessPeakResidentBytes']
  const run = (mode, id) => {
    const specFile = path.join(directory, id + '-' + mode + '.spec.json'), resultFile = path.join(directory, id + '-' + mode + '.json')
    fs.writeFileSync(specFile, JSON.stringify({ mode, id, reader, fixture: input }, null, 2) + '\n', { flag: 'wx' })
    const result = spawnSync(process.execPath, [__filename, '--child', specFile, resultFile], { cwd: ROOT, encoding: 'utf8', timeout: 120000, maxBuffer: 4 * 1024 * 1024 })
    fs.writeFileSync(path.join(directory, id + '-' + mode + '.log.json'), JSON.stringify({ at: new Date().toISOString(), status: result.status, signal: result.signal, stdout: result.stdout, stderr: result.stderr, error: result.error?.message }, null, 2) + '\n', { flag: 'wx' })
    assert.equal(result.status, 0, result.stderr || result.error?.message); const row = JSON.parse(fs.readFileSync(resultFile, 'utf8')); assert.equal(row.complete, true)
    assert(metrics.every(key => Number.isFinite(row[key]) && row[key] > 0)); return row
  }
  try {
    for (let n = 0; n < 10; n++) { receipt.baseline.push(run('baseline', 'baseline-' + n)); save(); console.log('baseline ' + (n + 1) + '/10') }
    const frozen = { schema: 1, at: new Date().toISOString(), baselineCount: receipt.baseline.length, metrics: Object.fromEntries(metrics.map(key => { const values = receipt.baseline.map(row => row[key]), differences = values.slice(1).map((value, i) => Math.abs(value - values[i])); return [key, { ...stats(values), adjacentAbsoluteDeltas: differences, frozenAbsoluteNoise: percentile(differences, .95) }] })), method: 'Freeze raw first ten baseline runs before any candidate. Noise is reported, never treated as an allowed regression budget.' }
    fs.writeFileSync(path.join(directory, 'frozen-noise.json'), JSON.stringify(frozen, null, 2) + '\n', { flag: 'wx' }); receipt.frozenSHA256 = await sha(path.join(directory, 'frozen-noise.json')); save()
    for (let n = 0; n < 10; n++) { const order = n % 2 ? ['candidate', 'baseline'] : ['baseline', 'candidate'], pair = { n, order }; for (const mode of order) pair[mode] = run(mode, 'pair-' + n); assert.deepEqual(pair.baseline.output, pair.candidate.output); receipt.pairs.push(pair); save(); console.log('pair ' + (n + 1) + '/10') }
    assert(receipt.baseline.every(row => row.output.digest === receipt.pairs[0].baseline.output.digest))
    receipt.comparison = Object.fromEntries(metrics.map(key => { const baseline = receipt.pairs.map(pair => pair.baseline[key]), candidate = receipt.pairs.map(pair => pair.candidate[key]), deltas = receipt.pairs.map(pair => pair.candidate[key] - pair.baseline[key]), sign = signProbability(deltas), paired = stats(deltas), stableRegression = paired.median > 0 && sign.oneSidedExactProbability <= .05; return [key, { baseline: stats(baseline), candidate: stats(candidate), pairedDeltas: paired, sign, stableRegression, frozenAbsoluteNoise: frozen.metrics[key].frozenAbsoluteNoise, assessment: stableRegression ? 'Consistent paired regression; do not integrate' : paired.median <= 0 ? 'No consistent regression detected in this microbenchmark; application evidence remains required' : 'Mixed positive median, uncertain; no equality or saving claim' }] }))
    receipt.complete = true; receipt.finishedAt = new Date().toISOString(); save(); console.log(JSON.stringify({ directory, complete: true, comparison: receipt.comparison }))
  } catch (error) { receipt.failure = { at: new Date().toISOString(), message: error.message, stack: error.stack }; save(); throw error }
}
if (require.main === module) (process.argv[2] === '--child' ? child(process.argv[3], process.argv[4]) : main()).catch(error => { console.error(error); process.exitCode = 1 })
module.exports = { fixture, oldEntryGetData, stats, signProbability }
