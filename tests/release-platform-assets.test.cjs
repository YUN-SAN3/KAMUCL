const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), crypto = require('node:crypto')
const scope = require('../scripts/release-platform-assets.cjs')
const version = '1.1.9', commit = 'a'.repeat(40)
const windowsProducts = ['KAMUCL-1.1.9.exe', 'KAMUCL-1.1.9-windows-x64.zip', 'KAMUCL-1.1.9-windows-x64-unpacked.zip']
const macProducts = ['KAMUCL-1.1.9-mac-arm64.dmg', 'KAMUCL-1.1.9-mac-arm64.zip', 'KAMUCL-1.1.9-mac-x64.dmg', 'KAMUCL-1.1.9-mac-x64.zip']

test('default and explicit all retain seven platform products and the legacy nine-package order', () => {
  assert.deepEqual(scope.parseReleaseArgs([]), { platform: 'all', dryRun: false, notesPath: null })
  assert.deepEqual(scope.productAssetNames(version), [...windowsProducts, ...macProducts])
  assert.deepEqual(scope.releaseAssetNames(version), [...windowsProducts, 'KAMUCL-1.1.9-source.zip', ...macProducts, 'KAMUCL-1.1.9-handoff.zip'])
  assert.deepEqual(scope.releaseAssetNames(version, scope.parseReleaseArgs(['--platform', 'all']).platform), scope.releaseAssetNames(version))
})

test('explicit Windows scope is exactly three Windows products plus source and handoff, independent of other local assets', () => {
  assert.deepEqual(scope.productAssetNames(version, 'windows'), windowsProducts)
  assert.deepEqual(scope.releaseAssetNames(version, 'windows'), [...windowsProducts, 'KAMUCL-1.1.9-source.zip', 'KAMUCL-1.1.9-handoff.zip'])
  const selected = scope.releaseAssetNames(version, 'windows'); selected.pop()
  assert.equal(scope.releaseAssetNames(version, 'windows').length, 5, 'caller mutation must not change a later release selection')
})

test('scope parser accepts explicit values and reviewed notes, rejects unknown, duplicate or missing options', () => {
  assert.deepEqual(scope.parseReleaseArgs(['--dry-run', '--platform=windows', '--notes-file', 'reviewed notes.md']), { platform: 'windows', dryRun: true, notesPath: 'reviewed notes.md' })
  for (const args of [['--platform'], ['--platform='], ['--platform', '--dry-run'], ['--platform', 'mac'], ['--platform', 'Windows'], ['--platform', 'windows', '--platform=all'], ['--dry-run', '--dry-run'], ['--dry-run=true'], ['--notes-file'], ['--notes-file= '], ['--notes-file', 'one', '--notes-file=two'], ['--pltaform', 'windows'], ['unexpected']]) assert.throws(() => scope.parseReleaseArgs(args))
  assert.throws(() => scope.productAssetNames('../1.1.9', 'windows')); assert.throws(() => scope.releaseAssetNames(version, 'mac'))
})

test('asset names are unique basenames, and Windows refuses deferred current-version Mac assets without deleting them', () => {
  scope.assertUniqueAssetNames([...scope.releaseAssetNames(version, 'windows'), 'SHA256SUMS.txt'])
  for (const names of [['a.zip', 'a.zip'], ['../a.zip'], ['folder/a.zip'], ['folder\\a.zip'], ['']]) assert.throws(() => scope.assertUniqueAssetNames(names))
  const previous = [{ name: 'KAMUCL-1.1.8-mac-arm64.dmg' }]
  scope.assertRemotePlatformScope(previous, version, 'windows')
  for (const name of macProducts) { const assets = [...previous, { name }], original = structuredClone(assets); assert.throws(() => scope.assertRemotePlatformScope(assets, version, 'windows'), /deferred Mac/); assert.deepEqual(assets, original) }
  scope.assertRemotePlatformScope(macProducts.map(name => ({ name })), version, 'all')
  assert.throws(() => scope.assertRemotePlatformScope(undefined, version, 'windows'))
})

// Execute the actual release entry in an isolated runtime: no real files are
// changed and no credential, Git operation or network request can escape it.
function isolatedRelease(args, { remoteMac = false, corruptDigest = false, staleMaster = false, observed = [] } = {}) {
  const source = fs.readFileSync(path.join(__dirname, '../scripts/release-github.cjs'), 'utf8')
  const calls = observed, writes = [], messages = [], root = path.resolve(__dirname, '..'), releaseDir = path.join(root, 'release')
  const history = ['KAMUCL-1.1.9-validation-history-index.json', 'KAMUCL-1.1.9-validation-history-part001.zip']
  const data = new Map([...scope.releaseAssetNames(version), ...history].map(name => [path.join(releaseDir, name), Buffer.from('synthetic asset ' + name)]))
  const notes = path.join(root, 'reviewed.md'); data.set(notes, Buffer.from('Windows-only reviewed notes; Mac deferred and not qualified'))
  let release, assets = remoteMac ? [{ id: 100, name: macProducts[0], size: 7, digest: 'sha256:' + 'b'.repeat(64) }] : [], published = false, exitCode = 0
  const fakeFS = { readFileSync(file, encoding) { calls.push(['read', file]); if (!data.has(file)) throw Error('Unexpected fixture read: ' + file); return encoding ? data.get(file).toString() : data.get(file) }, existsSync: file => data.has(file), statSync: file => ({ size: data.get(file).length }), writeFileSync(file, value) { calls.push(['write', file]); writes.push({ file, text: String(value) }); data.set(file, Buffer.from(value)) } }
  const response = (status, value) => ({ status, ok: status >= 200 && status < 300, json: async () => structuredClone(value), text: async () => JSON.stringify(value) })
  const fetch = async (url, options) => {
    calls.push(['api', options.method, url]); const endpoint = new URL(url), pathname = endpoint.pathname
    if (pathname.endsWith('/branches/master')) return response(200, { commit: { sha: staleMaster ? 'b'.repeat(40) : commit } })
    if (pathname.includes('/git/ref/tags/')) return published ? response(200, { object: { type: 'commit', sha: commit } }) : response(404, {})
    if (pathname.includes('/releases/tags/')) return published ? response(200, { ...release, assets }) : response(404, {})
    if (pathname.endsWith('/releases') && options.method === 'GET') return response(200, [])
    if (pathname.endsWith('/releases') && options.method === 'POST') { release = { id: 2, ...JSON.parse(options.body) }; return response(201, release) }
    if (pathname.endsWith('/releases/2/assets') && options.method === 'GET') return response(200, assets)
    if (endpoint.hostname === 'uploads.github.com') { const name = endpoint.searchParams.get('name'), digest = crypto.createHash('sha256').update(options.body).digest('hex'); assets.push({ id: assets.length + 1, name, size: options.body.length, digest: 'sha256:' + (corruptDigest ? '0'.repeat(64) : digest) }); return response(201, assets.at(-1)) }
    if (pathname.endsWith('/releases/2') && options.method === 'PATCH') { release = { ...release, ...JSON.parse(options.body) }; published = !release.draft; return response(200, release) }
    throw Error('Unexpected isolated API call: ' + options.method + ' ' + pathname)
  }
  const requireFixture = name => {
    if (name === 'node:fs') return fakeFS
    if (name === './release-platform-assets.cjs') return scope
    if (name === './release-history-assets.cjs') return directory => { assert.equal(directory, releaseDir); return history.map(name => path.join(directory, name)) }
    if (name === './check-licenses.cjs') return { checkLicenses() { calls.push(['license']) } }
    if (name === path.join(root, 'package.json')) return { version }
    if (name === 'node:child_process') return { execFileSync(command, values) { calls.push(['git', command, values]); assert.deepEqual([...values], ['rev-parse', 'HEAD']); return commit + '\n' } }
    if (['node:path', 'node:crypto'].includes(name)) return require(name)
    throw Error('Unexpected isolated require: ' + name)
  }
  const result = vm.runInNewContext(source, { require: requireFixture, __dirname: path.join(root, 'scripts'), process: { argv: ['node', 'release-github.cjs', ...args], env: { GITHUB_TOKEN: 'synthetic-test-only' }, exit(code) { exitCode = code; throw Error('isolated exit ' + code) } }, console: { log: value => messages.push(String(value)), error: value => messages.push(String(value)), warn: value => messages.push(String(value)) }, fetch, URL, Buffer, setTimeout })
  return Promise.resolve(result).catch(error => { if (exitCode !== 1 || error.message !== 'isolated exit 1') throw error }).then(() => ({ calls, writes, messages, assets, published, exitCode }))
}

test('invalid actual release invocation cannot reach licenses, checksum writes, credential/Git or API actions', () => {
  for (const args of [['--platform', 'mac'], ['--platform'], ['--platform', 'windows', '--platform', 'all'], ['--unknown']]) {
    const observed = []
    assert.throws(() => isolatedRelease(args, { observed }), /Unsupported release platform|requires a value|Duplicate release argument|Unknown release argument/)
    assert.deepEqual(observed, [])
  }
})

test('actual default dry run retains all legacy packages without implicitly changing platform scope', async () => {
  const result = await isolatedRelease(['--dry-run', '--notes-file', 'reviewed.md'])
  assert.equal(result.exitCode, 0); assert.equal(result.published, false)
  assert.deepEqual(result.writes[0].text.trim().split('\n').map(line => line.slice(66)), [...scope.releaseAssetNames(version), 'KAMUCL-1.1.9-validation-history-index.json', 'KAMUCL-1.1.9-validation-history-part001.zip'])
})

test('actual Windows dry run checksum list includes source, handoff and history but excludes existing Mac files', async () => {
  const result = await isolatedRelease(['--platform', 'windows', '--dry-run', '--notes-file', 'reviewed.md'])
  assert.equal(result.exitCode, 0); assert.equal(result.published, false); assert.equal(result.writes.length, 1)
  const listed = result.writes[0].text.trim().split('\n').map(line => line.slice(66))
  assert.deepEqual(listed, [...windowsProducts, 'KAMUCL-1.1.9-source.zip', 'KAMUCL-1.1.9-handoff.zip', 'KAMUCL-1.1.9-validation-history-index.json', 'KAMUCL-1.1.9-validation-history-part001.zip'])
  assert(result.calls.every(call => !['git', 'api'].includes(call[0])))
})

test('actual Windows release uploads only the scoped assets and publishes after all digest and tag/commit checks', async () => {
  const result = await isolatedRelease(['--platform=windows', '--notes-file=reviewed.md'])
  assert.equal(result.exitCode, 0); assert.equal(result.published, true)
  assert.deepEqual(result.assets.map(asset => asset.name), [...scope.releaseAssetNames(version, 'windows'), 'KAMUCL-1.1.9-validation-history-index.json', 'KAMUCL-1.1.9-validation-history-part001.zip', 'SHA256SUMS.txt'])
  assert(result.assets.every(asset => !macProducts.includes(asset.name)))
  assert(result.calls.some(call => call[0] === 'api' && call[1] === 'GET' && call[2].includes('/branches/master')))
  assert(result.calls.some(call => call[0] === 'api' && call[1] === 'GET' && call[2].includes('/git/ref/tags/')))
})

test('actual release preserves mismatched remote Mac draft and refuses publication on remote scope, SHA or master mismatch', async () => {
  const args = ['--platform', 'windows', '--notes-file', 'reviewed.md']
  const mac = await isolatedRelease(args, { remoteMac: true })
  assert.equal(mac.exitCode, 1); assert.equal(mac.published, false); assert.equal(mac.assets.length, 1)
  assert(mac.messages.some(message => /deferred Mac assets/.test(message)))
  assert(mac.calls.every(call => call[0] !== 'api' || !['DELETE', 'PATCH'].includes(call[1]) && !call[2].includes('uploads.github.com')))
  const corrupt = await isolatedRelease(args, { corruptDigest: true })
  assert.equal(corrupt.exitCode, 1); assert.equal(corrupt.published, false); assert(corrupt.calls.every(call => call[0] !== 'api' || call[1] !== 'PATCH'))
  assert(corrupt.messages.some(message => /远端附件大小或 SHA256 不匹配/.test(message)))
  const stale = await isolatedRelease(args, { staleMaster: true })
  assert.equal(stale.exitCode, 1); assert.equal(stale.published, false); assert(stale.calls.every(call => call[0] !== 'api' || call[1] !== 'POST'))
  assert(stale.messages.some(message => /本地 HEAD 尚未同步/.test(message)))
})
