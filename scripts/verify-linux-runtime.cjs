const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')
const asar = require('asar')
const ELECTRON_VERSION = '44.3.0'
// Verified against both official 44.3.0 Linux ZIPs and their SHASUMS256.txt.
// This Electron release does not distribute libEGL.so / libGLESv2.so. Retain
// all its actual graphics libraries, codec, sandbox and data files instead.
// electron-builder 26.15.3 renames electron and LICENSE, removes version and
// default_app.asar, and keeps the two explicitly configured language packs.
const LINUX_ELECTRON_SOURCE_MAP = Object.freeze({ kamucl: 'electron', 'LICENSE.electron.txt': 'LICENSE' })
const LINUX_ELECTRON_FILES = Object.freeze([
  'kamucl', 'chrome-sandbox', 'chrome_crashpad_handler', 'libffmpeg.so',
  'libvk_swiftshader.so', 'libvulkan.so.1', 'vk_swiftshader_icd.json',
  'icudtl.dat', 'resources.pak', 'chrome_100_percent.pak', 'chrome_200_percent.pak',
  'snapshot_blob.bin', 'v8_context_snapshot.bin', 'LICENSE.electron.txt', 'LICENSES.chromium.html',
  'locales/en-US.pak', 'locales/zh-CN.pak'
])
const ELF_FILES = new Set(['kamucl', 'chrome-sandbox', 'chrome_crashpad_handler', 'libffmpeg.so', 'libvk_swiftshader.so', 'libvulkan.so.1'])

function assertLinuxElectronFiles(entries, arch, electronVersion) {
  assert.equal(electronVersion, ELECTRON_VERSION, 'Review the official Linux runtime inventory before changing Electron')
  assert(['x64', 'arm64'].includes(arch), 'Unsupported Linux architecture')
  for (const name of LINUX_ELECTRON_FILES) {
    const entry = entries[name]
    assert(entry && entry.isFile === true && entry.isSymbolicLink === false && entry.size > 0, 'Missing or unsafe runtime: ' + name)
    if (ELF_FILES.has(name)) {
      const header = entry.data
      assert(Buffer.isBuffer(header) && header.length >= 64, 'Truncated runtime ELF: ' + name)
      assert.equal(header.toString('binary', 0, 4), '\x7fELF', 'Invalid runtime ELF: ' + name)
      assert.equal(header[4], 2, 'Runtime must be 64-bit: ' + name)
      assert.equal(header[5], 1, 'Runtime must be little-endian: ' + name)
      assert.equal(header.readUInt16LE(18), arch === 'arm64' ? 183 : 62, 'Wrong Linux architecture: ' + name)
      assert(entry.mode & 0o111, 'Runtime is not executable: ' + name)
    }
  }
  const icd = JSON.parse(entries['vk_swiftshader_icd.json'].data.toString('utf8'))
  assert.equal(icd.file_format_version, '1.0.0', 'Unsupported Vulkan ICD format')
  assert.equal(icd.ICD?.library_path, './libvk_swiftshader.so', 'Vulkan ICD must resolve to the bundled library')
  assert.equal(icd.ICD?.api_version, '1.0.5', 'Review the pinned Electron Vulkan ICD before changing it')
  return { electronVersion, arch, verifiedFiles: LINUX_ELECTRON_FILES.length }
}

function readPrefix(file, bytes) {
  const descriptor = fs.openSync(file, 'r'), buffer = Buffer.alloc(bytes)
  try { return buffer.subarray(0, fs.readSync(descriptor, buffer, 0, bytes, 0)) }
  finally { fs.closeSync(descriptor) }
}

function verifyLinuxElectronRuntime(root, arch, electronVersion = require('../package.json').devDependencies.electron) {
  const entries = {}
  for (const name of LINUX_ELECTRON_FILES) {
    const file = path.join(root, name), stat = fs.lstatSync(file)
    entries[name] = { size: stat.size, mode: stat.mode, isFile: stat.isFile(), isSymbolicLink: stat.isSymbolicLink(),
      data: name === 'vk_swiftshader_icd.json' ? readPrefix(file, 4096) : ELF_FILES.has(name) ? readPrefix(file, 64) : undefined }
  }
  return assertLinuxElectronFiles(entries, arch, electronVersion)
}

function assertObservedLinuxRuntime(raw, arch) {
  assert(['x64', 'arm64'].includes(arch), 'Unsupported Linux architecture')
  const identity = JSON.parse(raw)
  assert.equal(identity.platform, 'linux', 'Packaged executable must report Linux')
  assert.equal(identity.arch, arch, 'Packaged executable reports another architecture')
  assert.equal(identity.electron, ELECTRON_VERSION, 'Packaged executable reports another Electron runtime')
  return identity
}

function observeLinuxRuntime(executable, arch) {
  const env = { ...process.env, ELECTRON_RUN_AS_NODE: '1' }; delete env.NODE_OPTIONS
  const raw = execFileSync(executable, ['-p', 'JSON.stringify({platform:process.platform,arch:process.arch,electron:process.versions.electron})'], { env, encoding: 'utf8', timeout: 15000, maxBuffer: 128 * 1024 })
  return assertObservedLinuxRuntime(raw, arch)
}

function linuxSourceCommit() {
  // A source archive without its Git provenance must not invent a commit.
  const commit = execFileSync('git', ['-C', path.resolve(__dirname, '..'), 'rev-parse', '--verify', 'HEAD'], { encoding: 'utf8', timeout: 10000 }).trim()
  assert(/^[a-f0-9]{40}$/.test(commit), 'Linux build requires an exact Git source commit')
  if (process.env.GITHUB_ACTIONS === 'true') assert.equal(commit, process.env.GITHUB_SHA, 'Checkout does not match the declared workflow source')
  return commit
}

function verifyLinuxRuntime(directory, arch = process.arch, kind = 'portable-directory') {
  const root = path.resolve(directory)
  verifyLinuxElectronRuntime(root, arch)
  for (const file of ['resources/app.asar', 'resources/app.asar.unpacked/out/main/LinuxGameWindow', 'resources/app.asar.unpacked/out/main/kamucl-bridge.jar']) {
    const stat = fs.lstatSync(path.join(root, file))
    assert(stat.isFile() && !stat.isSymbolicLink() && stat.size > 0, 'Missing or unsafe runtime: ' + file)
  }
  const helper = path.join(root, 'resources/app.asar.unpacked/out/main/LinuxGameWindow'), helperHeader = readPrefix(helper, 64)
  assert(helperHeader.length >= 64, 'Truncated native window helper ELF')
  assert.equal(helperHeader.toString('binary', 0, 4), '\x7fELF', 'Native window helper must be ELF')
  assert.equal(helperHeader[4], 2); assert.equal(helperHeader[5], 1)
  assert.equal(helperHeader.readUInt16LE(18), arch === 'arm64' ? 183 : 62, 'Wrong window helper architecture')
  assert(fs.lstatSync(helper).mode & 0o111, 'Window helper is not executable')
  const observedRuntime = observeLinuxRuntime(path.join(root, 'kamucl'), arch)
  const metadata = { schemaVersion: 1, product: 'KAMUCL', platform: 'linux', arch, version: require('../package.json').version, installationKind: kind, sourceCommit: linuxSourceCommit(), runtimeVersion: observedRuntime.electron }
  fs.writeFileSync(path.join(root, 'resources/kamucl-linux.json'), JSON.stringify(metadata, null, 2))
  const archive = path.join(root, 'resources/app.asar'), names = asar.listPackage(archive).map(n => n.replaceAll('\\', '/').replace(/^\//, ''))
  for (const name of names) {
    if (asar.statFile(archive, name.split('/').join(path.sep)).files) continue
    assert(/^(node_modules\/|out\/(main|preload|renderer)\/|licenses\/|LICENSE$|THIRD_PARTY_NOTICES\.md$|package\.json$|docs\/CORRESPONDING_SOURCE\.md$)/.test(name), 'Unexpected application file: ' + name)
    assert(!/pelican-bicycle|accounts\.json|settings\.json|Downloads|独\.zip/.test(name), 'Private or unrelated data included')
  }
  assert.equal(JSON.parse(asar.extractFile(archive, 'package.json').toString()).version, metadata.version)
  return { directory: root, arch, kind, version: metadata.version, sourceCommit: metadata.sourceCommit, runtimeVersion: metadata.runtimeVersion, observedRuntime, archiveEntries: names.length, complete: true }
}
module.exports = context => { if (context.electronPlatformName === 'linux') verifyLinuxRuntime(context.appOutDir) }
module.exports.verifyLinuxRuntime = verifyLinuxRuntime
module.exports.assertLinuxElectronFiles = assertLinuxElectronFiles
module.exports.verifyLinuxElectronRuntime = verifyLinuxElectronRuntime
module.exports.LINUX_ELECTRON_FILES = LINUX_ELECTRON_FILES
module.exports.LINUX_ELECTRON_SOURCE_MAP = LINUX_ELECTRON_SOURCE_MAP
module.exports.ELECTRON_VERSION = ELECTRON_VERSION
module.exports.assertObservedLinuxRuntime = assertObservedLinuxRuntime
module.exports.observeLinuxRuntime = observeLinuxRuntime
if (require.main === module) console.log(JSON.stringify(verifyLinuxRuntime(process.argv[2], process.argv[3])))
