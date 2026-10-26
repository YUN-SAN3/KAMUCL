// Pure release-scope selection. No filesystem, credentials, tag or network access.
const assert = require('node:assert/strict')

function platformValue(platform) {
  if (!['all', 'windows', 'desktop'].includes(platform)) throw Error('Unsupported release platform: ' + platform)
  return platform
}

function parseReleaseArgs(argv) {
  assert(Array.isArray(argv) && argv.every(value => typeof value === 'string'), 'Release arguments must be strings')
  const options = { platform: 'all', dryRun: false, notesPath: null }, seen = new Set()
  for (let index = 0; index < argv.length; index++) {
    const raw = argv[index], equals = raw.indexOf('='), flag = equals < 0 ? raw : raw.slice(0, equals)
    if (!['--platform', '--dry-run', '--notes-file'].includes(flag)) throw Error('Unknown release argument: ' + flag)
    if (seen.has(flag)) throw Error('Duplicate release argument: ' + flag)
    seen.add(flag)
    if (flag === '--dry-run') {
      if (equals >= 0) throw Error('--dry-run does not accept a value')
      options.dryRun = true
      continue
    }
    const value = equals < 0 ? argv[++index] : raw.slice(equals + 1)
    if (!value || !value.trim() || value.startsWith('--')) throw Error(flag + ' requires a value')
    if (flag === '--platform') options.platform = platformValue(value)
    else options.notesPath = value
  }
  return Object.freeze(options)
}

function productAssetNames(version, platform = 'all') {
  assert(typeof version === 'string' && /^\d+\.\d+\.\d+$/.test(version), 'Release version must be a numeric triplet')
  platformValue(platform)
  const prefix = `KAMUCL-${version}`
  const windows = [`${prefix}.exe`, `${prefix}-windows-x64.zip`, `${prefix}-windows-x64-unpacked.zip`]
  const mac = ['arm64', 'x64'].flatMap(arch => ['dmg', 'zip'].map(ext => `${prefix}-mac-${arch}.${ext}`))
  const linux = ['x64', 'arm64'].flatMap(arch => ['AppImage', 'deb', 'tar.gz'].map(ext => `${prefix}-linux-${arch}.${ext}`))
  return platform === 'windows' ? windows : [...windows, ...mac, ...(platform === 'desktop' ? linux : [])]
}

function releaseAssetNames(version, platform = 'all') {
  const products = productAssetNames(version, platform)
  // Preserve the legacy all-platform order: Windows, source, Mac, handoff.
  return [...products.slice(0, 3), `KAMUCL-${version}-source.zip`, ...products.slice(3), `KAMUCL-${version}-handoff.zip`]
}

function assertUniqueAssetNames(names) {
  assert(Array.isArray(names) && names.every(name => typeof name === 'string' && name && !/[\\/\0]/.test(name)), 'Release assets must have ordinary basenames')
  assert.equal(new Set(names).size, names.length, 'Duplicate release asset name')
}

function assertRemotePlatformScope(assets, version, platform) {
  platformValue(platform)
  if (platform !== 'windows') return
  assert(Array.isArray(assets), 'Remote release asset list required for Windows scope verification')
  const deferredMac = new Set(productAssetNames(version, 'all').slice(3))
  if (assets.some(asset => deferredMac.has(asset?.name))) throw Error('Windows-only release contains deferred Mac assets; preserve remote assets and existing release visibility, stop this publication')
}

module.exports = { parseReleaseArgs, productAssetNames, releaseAssetNames, assertUniqueAssetNames, assertRemotePlatformScope }
