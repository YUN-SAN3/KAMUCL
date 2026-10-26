const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), assert = require('node:assert/strict'), crypto = require('node:crypto'), { execFileSync } = require('node:child_process')
assert.equal(process.platform, 'linux')
const arch = process.argv[2] || process.arch; assert.equal(arch, process.arch)
const root = path.resolve(__dirname, '..'), version = require('../package.json').version, prefix = 'KAMUCL-' + version + '-linux-' + arch
const proof = path.join(root, 'release/linux-proof-' + arch + '-packages'); fs.mkdirSync(proof, { recursive: true })
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'KAMUCL clean 中文 ')), run = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8', maxBuffer: 1024 * 1024 * 16 })
const report = { version, arch, sourceCommit: run('git', ['rev-parse', 'HEAD']).trim(), nativeArchitecture: process.arch, packages: [], complete: false, nativeDesktop: false }
const { observeLinuxRuntime } = require('./verify-linux-runtime.cjs')
function verifyIdentity(directory, kind) {
  const identity = JSON.parse(fs.readFileSync(path.join(directory, 'resources/kamucl-linux.json'), 'utf8'))
  assert.equal(identity.schemaVersion, 1, 'Unknown Linux package identity schema')
  assert.equal(identity.product, 'KAMUCL'); assert.equal(identity.platform, 'linux'); assert.equal(identity.version, version); assert.equal(identity.arch, arch); assert.equal(identity.installationKind, kind)
  assert.equal(identity.sourceCommit, report.sourceCommit, 'Embedded package source differs from the checkout')
  const observed = observeLinuxRuntime(path.join(directory, 'kamucl'), arch)
  assert.equal(identity.runtimeVersion, observed.electron, 'Embedded runtime differs from the extracted executable')
  report.identities ||= []; report.identities.push({ kind, identity, observedExecutable: observed })
  report.runtimeVersion = observed.electron
}
function compareTrees(first, second, skipMetadata = false) {
  let count = 0
  const walk = dir => { for (const name of fs.readdirSync(dir)) { const file = path.join(dir, name), rel = path.relative(first, file), other = path.join(second, rel), stat = fs.lstatSync(file); if (stat.isDirectory()) walk(file); else {
    assert(!stat.isSymbolicLink(), 'Release archives intentionally dereference links')
    if (skipMetadata && rel === path.join('resources', 'kamucl-linux.json')) continue
    assert.equal(crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'), crypto.createHash('sha256').update(fs.readFileSync(other)).digest('hex'), 'Changed file: ' + rel)
    assert.equal(stat.mode & 0o111, fs.statSync(other).mode & 0o111, 'Lost executable permission: ' + rel); count++
  } } }; walk(first); return count
}
(async () => {
  const portable = path.join(temporary, 'portable'); fs.mkdirSync(portable)
  run('/usr/bin/tar', ['-xzf', path.join(root, 'release', prefix + '.tar.gz'), '-C', portable])
  const nativeDir = path.join(root, 'release/linux' + (arch === 'arm64' ? '-arm64' : '') + '-unpacked')
  const count = compareTrees(nativeDir, path.join(portable, 'KAMUCL'))
  verifyIdentity(path.join(portable, 'KAMUCL'), 'portable-directory')
  const code = await require('esbuild').build({ entryPoints: [path.join(root, 'src/main/core/linuxUpdateIdentity.ts')], bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external' })
  const mod = { exports: {} }; new Function('require', 'module', 'exports', code.outputFiles[0].text)(require, mod, mod.exports)
  await mod.exports.validateLinuxArchive(path.join(root, 'release', prefix + '.tar.gz'))
  const deb = path.join(root, 'release', prefix + '.deb')
  const debInfo = run('/usr/bin/dpkg-deb', ['-f', deb, 'Package', 'Version', 'Architecture'])
  assert(debInfo.includes('Package: kamucl') && debInfo.includes('Version: ' + version) && debInfo.includes('Architecture: ' + (arch === 'arm64' ? 'arm64' : 'amd64')))
  const debRoot = path.join(temporary, 'deb'); run('/usr/bin/dpkg-deb', ['-x', deb, debRoot])
  const find = (dir, name) => { for (const entry of fs.readdirSync(dir, { withFileTypes: true })) { const f = path.join(dir, entry.name); if (entry.isFile() && entry.name === name) return f; if (entry.isDirectory()) { const found = find(f, name); if (found) return found } } }
  const debMetadataFile = find(debRoot, 'kamucl-linux.json'); assert(debMetadataFile)
  const metadata = JSON.parse(fs.readFileSync(debMetadataFile, 'utf8')); mod.exports.assertLinuxManifest(JSON.stringify(metadata), version, 'deb', arch)
  const debCount = compareTrees(nativeDir, path.dirname(path.dirname(debMetadataFile)), true)
  verifyIdentity(path.dirname(path.dirname(debMetadataFile)), 'deb')
  const image = path.join(root, 'release', prefix + '.AppImage'); const bytes = fs.readFileSync(image).subarray(0, 64)
  mod.exports.assertLinuxElf(bytes, arch); assert.equal(bytes.toString('binary', 8, 11), 'AI\x02')
  const imageRoot = path.join(temporary, 'image'); fs.mkdirSync(imageRoot)
  execFileSync(image, ['--appimage-extract'], { cwd: imageRoot, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
  const extractedImage = path.join(imageRoot, 'squashfs-root')
  const appRun = fs.readFileSync(path.join(extractedImage, 'AppRun'), 'utf8')
  assert.equal(appRun, fs.readFileSync(path.join(__dirname, 'linux-AppRun.sh'), 'utf8'), 'AppImage must keep the sandbox-preserving launcher')
  const desktops = fs.readdirSync(extractedImage).filter(name => name.endsWith('.desktop')); assert(desktops.length > 0)
  for (const desktop of desktops) assert(!fs.readFileSync(path.join(extractedImage, desktop), 'utf8').includes('--no-sandbox'), 'Desktop entry must preserve sandboxing')
  mod.exports.assertLinuxManifest(fs.readFileSync(path.join(extractedImage, 'resources/kamucl-linux.json'), 'utf8'), version, 'appimage', arch)
  const imageCount = compareTrees(nativeDir, extractedImage, true)
  verifyIdentity(extractedImage, 'appimage')
  for (const extension of ['tar.gz', 'deb', 'AppImage']) {
    const file = path.join(root, 'release', prefix + '.' + extension)
    report.packages.push({ name: path.basename(file), bytes: fs.statSync(file).size, sha256: crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') })
  }
  report.cleanExtractedFiles = { portable: count, deb: debCount, appimage: imageCount }; report.complete = true; fs.writeFileSync(path.join(proof, 'summary.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report))
})().catch(error => { report.error = String(error); fs.writeFileSync(path.join(proof, 'summary.json'), JSON.stringify(report, null, 2)); console.error(error); process.exitCode = 1 })
