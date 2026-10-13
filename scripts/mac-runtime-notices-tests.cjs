const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path')
const { preserveRuntimeNotices, verifyRuntimeNotices } = require('./mac-runtime-notices.cjs')
const setup = () => { const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kamucl-notices122-')); const runtime = path.join(root, 'runtime'), resources = path.join(root, 'resources'); fs.mkdirSync(runtime); fs.writeFileSync(path.join(runtime, 'LICENSE'), 'MIT License\nRuntime fixture\n'); fs.writeFileSync(path.join(runtime, 'LICENSES.chromium.html'), '<html>Chromium third-party fixture</html>'); return { root, runtime, resources } }
test('Signed-resource notice copies preserve all original bytes and detect subsequent corruption', () => {
  const { runtime, resources } = setup(), rows = preserveRuntimeNotices(runtime, resources)
  assert.equal(verifyRuntimeNotices(resources, rows), true)
  assert(fs.readFileSync(path.join(runtime, 'LICENSE')).equals(fs.readFileSync(path.join(resources, 'LICENSE.electron.txt'))))
  fs.writeFileSync(path.join(resources, 'LICENSES.chromium.html'), 'tampered')
  assert.throws(() => verifyRuntimeNotices(resources, rows))
})
test('Missing or empty actual runtime notices prevent creating a qualified Mac package', () => {
  for (const name of ['LICENSE', 'LICENSES.chromium.html']) {
    const { runtime, resources } = setup(); fs.writeFileSync(path.join(runtime, name), '')
    assert.throws(() => preserveRuntimeNotices(runtime, resources))
  }
  const { runtime, resources } = setup(); fs.unlinkSync(path.join(runtime, 'LICENSE'))
  assert.throws(() => preserveRuntimeNotices(runtime, resources))
})
test('Both named resources must be present; a metadata-only or reduced list cannot pass', () => {
  const { runtime, resources } = setup(), rows = preserveRuntimeNotices(runtime, resources)
  assert.throws(() => verifyRuntimeNotices(resources, rows.slice(0, 1)))
  fs.unlinkSync(path.join(resources, 'LICENSE.electron.txt'))
  assert.throws(() => verifyRuntimeNotices(resources, rows))
})
