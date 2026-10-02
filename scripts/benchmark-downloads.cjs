// Cold-cache asset benchmark using the real downloader, without changing user
// settings or touching a game directory. Run old/new builds sequentially.
// node scripts/benchmark-downloads.cjs --label before --ref <commit> --version 26.3
// node scripts/benchmark-downloads.cjs --label after --version 26.3
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto')
const { execFileSync } = require('node:child_process'), { createRequire } = require('node:module')
const dc = require('node:diagnostics_channel'), { build } = require('esbuild')
const arg = (name, fallback) => { const at = process.argv.indexOf('--' + name); return at < 0 ? fallback : process.argv[at + 1] }
const label = arg('label', 'current'), version = arg('version', '26.3'), ref = arg('ref', '')
const threads = Number(arg('threads', '16')), seconds = Number(arg('timeout', '900'))
if (!/^[\w.-]+$/.test(label) || !/^[\w.-]+$/.test(version) || !Number.isInteger(threads) || threads < 1 || threads > 64 || !(seconds > 0 && seconds <= 3600)) throw Error('Invalid benchmark arguments')
const root = process.cwd(), output = path.resolve('out', 'download-benchmarks', label + '-' + Date.now())
fs.mkdirSync(output, { recursive: true })

;(async () => {
  const revision = ref ? execFileSync('git', ['rev-parse', '--verify', ref + '^{commit}'], { encoding: 'utf8' }).trim() : null
  const plugins = revision ? [{ name: 'read-original-source', setup(builder) {
    builder.onLoad({ filter: /\.[cm]?[jt]s$/ }, args => {
      const file = path.relative(root, args.path).replaceAll('\\', '/')
      if (!file.startsWith('src/')) return
      return { contents: execFileSync('git', ['show', revision + ':' + file], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }), loader: 'ts' }
    })
  } }] : []
  const result = await build({ stdin: { contents: `export * from './src/main/core/download'; export {downloadLimiter} from './src/main/core/downloadLimits'; export {httpFetch,closeHttpClient} from './src/main/core/httpClient';`, resolveDir: root, loader: 'ts' }, plugins, write: false, bundle: true, platform: 'node', format: 'cjs', packages: 'external', logLevel: 'silent' })
  const module = { exports: {} }
  new Function('require', 'module', 'exports', result.outputFiles[0].text)(createRequire(path.join(root, 'package.json')), module, module.exports)
  const core = module.exports
  let latest = {}, error = null, started = 0, lastLog = 0, requests = 0, redirects = 0, rateLimits = 0
  const timeline = []
  const created = () => { requests++ }, headers = ({ response }) => { if ([301, 302, 303, 307, 308].includes(response.statusCode)) redirects++; if (response.statusCode === 429) rateLimits++ }
  try {
    const json = async url => { const response = await core.httpFetch(url, { signal: AbortSignal.timeout(30_000) }); if (!response.ok) throw Error('Metadata HTTP ' + response.status); return response.json() }
    const manifest = await json('https://piston-meta.mojang.com/mc/game/version_manifest_v2.json')
    const entry = manifest.versions.find(v => v.id === version); if (!entry) throw Error('Unknown version ' + version)
    const metadata = await json(entry.url), index = await json(metadata.assetIndex.url)
    const objects = [...new Map(Object.values(index.objects).map(o => [o.hash, o])).values()]
    const tasks = objects.map(o => ({ url: `https://resources.download.minecraft.net/${o.hash.slice(0, 2)}/${o.hash}`, dest: path.join(output, 'assets', o.hash), size: o.size, sha1: o.hash }))
    dc.channel('undici:request:create').subscribe(created); dc.channel('undici:request:headers').subscribe(headers)
    core.downloadLimiter.configure({ downloadThreads: threads, downloadSpeedKBps: 0 })
    started = performance.now()
    try { await core.downloadAll(tasks, (_done, _total, _speed, detail) => {
      latest = detail
      if (performance.now() - lastLog < 10_000) return
      lastLog = performance.now()
      const sample = { seconds: (lastLog - started) / 1000, files: detail.completedFiles, bytes: detail.bytesDone, speedBps: detail.speedBps }
      timeline.push(sample); console.log(JSON.stringify(sample))
    }, threads, 'bmclapi', AbortSignal.timeout(seconds * 1000)) } catch (e) { error = e.message }
    const elapsedSeconds = (performance.now() - started) / 1000
    // Completion is accepted only after every output is independently verified.
    let verifiedFiles = 0
    if (!error) for (const task of tasks) {
      const data = fs.readFileSync(task.dest)
      if (data.length !== task.size || crypto.createHash('sha1').update(data).digest('hex') !== task.sha1) throw Error('Verification failed: ' + path.basename(task.dest))
      verifiedFiles++
    }
    const report = { label, revision, version, threads, cache: 'empty independent directory', mirror: 'bmclapi with supplied official fallback', metadataExcluded: true, elapsedSeconds, complete: !error, error, files: tasks.length, verifiedFiles, totalBytes: objects.reduce((sum, o) => sum + o.size, 0), summary: latest, requests, redirects, rateLimits, timeline }
    fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify(report, null, 2))
    console.log(JSON.stringify({ output, complete: !error, elapsedSeconds, verifiedFiles, requests, redirects, rateLimits }))
    if (error) process.exitCode = 1
  } finally {
    dc.channel('undici:request:create').unsubscribe(created); dc.channel('undici:request:headers').unsubscribe(headers)
    await core.closeHttpClient()
  }
})().catch(error => { console.error(error); process.exitCode = 1 })
