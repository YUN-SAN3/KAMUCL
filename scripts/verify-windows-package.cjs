// Verify both distributions, the complete extracted payload, and runtime-only pruning.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os')
const crypto = require('node:crypto'), assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const Zip = require('adm-zip'), asar = require('asar')
const version = require('../package.json').version
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex')
const packageRoot = path.resolve('release/win-unpacked')
const archive = path.join(packageRoot, 'resources/app.asar')
const packageFile = `release/KAMUCL-${version}.exe`
const zipFile = `release/KAMUCL-${version}-windows-x64.zip`
const zip = new Zip(zipFile), name = path.basename(packageFile)
assert.equal(zip.getEntry(name).header.method, 0, 'EXE must use standard ZIP Store')
assert.equal(hash(zip.readFile(name)), hash(fs.readFileSync(packageFile)))
const zipRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'KAMUCL ZIP 中文 '))
// Exercise the Windows-supplied extractor as well as adm-zip reading above.
const extract = spawnSync('tar', ['-xf', path.resolve(zipFile), '-C', zipRoot], { windowsHide: true, encoding: 'utf8' })
assert.ifError(extract.error); assert.equal(extract.status, 0, extract.stderr)
assert.equal(hash(fs.readFileSync(path.join(zipRoot, name))), hash(fs.readFileSync(packageFile)))
function runPortable(exe) {
  const run = spawnSync(process.execPath, ['scripts/verify-portable-startup.cjs', exe], { windowsHide: true, encoding: 'utf8', timeout: 180000 })
  assert.ifError(run.error); assert.equal(run.status, 0, run.stderr)
  return JSON.parse(run.stdout)
}
const portable = runPortable(path.resolve(packageFile)), zipped = runPortable(path.join(zipRoot, name))
const roots = [portable, zipped].map(p => path.dirname(p.results[0].cache))
const files = []
function visit(dir) {
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, item.name)
    if (item.isDirectory()) visit(file)
    else {
      assert(item.isFile())
      const relative = path.relative(packageRoot, file).replaceAll('\\', '/')
      const bytes = fs.readFileSync(file), sha256 = hash(bytes)
      for (const root of roots) assert.equal(hash(fs.readFileSync(path.join(root, relative))), sha256, relative)
      files.push({ path: relative, size: bytes.length, sha256 })
    }
  }
}
visit(packageRoot)
const unpackedFile = `release/KAMUCL-${version}-windows-x64-unpacked.zip`
const unpackedZip = new Zip(unpackedFile)
const unpackedFiles = unpackedZip.getEntries().filter(e => !e.isDirectory)
assert.equal(unpackedFiles.length, files.length, 'Unpacked fallback file count')
for (const entry of unpackedFiles) assert.equal(hash(entry.getData()), files.find(f => f.path === entry.entryName)?.sha256, entry.entryName)
assert.equal(JSON.parse(asar.extractFile(archive, 'package.json').toString()).version, version)
// Only the two reviewed DXC DLLs may disappear; preserve every other runtime resource.
const { OPTIONAL_DXC } = require('./prune-windows-runtime.cjs')
// Verify against the installed, version-matched runtime. A historical local
// release is not a prerequisite for validating a clean checkout.
const runtime = path.resolve('node_modules/electron/dist')
for (const [name, expected] of Object.entries(OPTIONAL_DXC)) {
  assert.equal(hash(fs.readFileSync(path.join(runtime, name))), expected, 'Unexpected compiler: ' + name)
  assert(!files.some(f => f.path === name), 'Optional compiler still shipped: ' + name)
  for (const root of roots) assert(!fs.existsSync(path.join(root, name)), name)
}
for (const file of files) {
  if (file.path.startsWith('resources/') || file.path.endsWith('.exe')) continue
  const original = path.join(runtime, file.path === 'LICENSE.electron.txt' ? 'LICENSE' : file.path)
  assert(fs.existsSync(original), 'Missing source runtime file: ' + file.path)
  assert.equal(hash(fs.readFileSync(original)), file.sha256, 'Runtime changed: ' + file.path)
}
const names = asar.listPackage(archive).map(n => n.replaceAll('\\', '/').replace(/^\//, ''))
for (const name of names.filter(n => /^out\/(main|preload|renderer)\//.test(n))) {
  const native = name.split('/').join(path.sep)
  if (asar.statFile(archive, native).files) continue
  assert.equal(hash(asar.extractFile(archive, native)), hash(fs.readFileSync(native)), 'ASAR differs from final build: ' + name)
}
assert(!names.some(n => /^node_modules\/koffi\/(doc|lib|vendor)(\/|$)/.test(n)))
assert(!names.some(n => /^node_modules\/undici\/docs(\/|$)/.test(n)))
for (const required of ['out/main/modScanWorker.cjs', 'node_modules/koffi/src/koffi/index.cjs',
  'node_modules/koffi/src/koffi/src/static.cjs', 'node_modules/undici/index.js',
  'node_modules/@koromix/koffi-win32-x64/win32_x64/koffi.node',
  'LICENSE', 'THIRD_PARTY_NOTICES.md', 'licenses/LGPL-3.0.txt', 'licenses/koffi.txt']) assert(names.includes(required), required)
const report = { version, portable, zipped, zipRoot, files, asarSHA256: hash(fs.readFileSync(archive)),
  sizes: { exe: fs.statSync(packageFile).size,
    zip: fs.statSync(zipFile).size,
    unpackedZip: fs.statSync(unpackedFile).size }, complete: true }
fs.writeFileSync(`out/windows-package-${version}.json`, JSON.stringify(report, null, 2))
console.log(JSON.stringify(report, null, 2))
