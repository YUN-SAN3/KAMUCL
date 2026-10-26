const test = require('node:test'), assert = require('node:assert/strict')
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), crypto = require('node:crypto')
const { execFileSync } = require('node:child_process')
const { isQaMain, loadedAsEntry } = require('../scripts/qa-entry.cjs')

test('Electron QA entry matches only the canonical requested main despite default-app require.main', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-entry-contract-'))
  const file = path.join(root, 'main.cjs'), imported = path.join(root, 'imported.cjs')
  fs.writeFileSync(file, ''); fs.writeFileSync(imported, '')
  try {
    const runtime = { type: 'browser', versions: { electron: '44.3.0' }, env: {}, argv: ['electron', file] }
    assert.equal(isQaMain({ filename: path.join(root, '..', path.basename(root), 'main.cjs') }, { filename: 'electron' }, runtime), true)
    assert.equal(isQaMain({ filename: imported }, { filename: 'electron' }, runtime), false)
    assert.equal(isQaMain({ filename: file }, { filename: 'electron' }, { ...runtime, argv: ['electron', path.join(root, 'missing.cjs')] }), false)
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})

test('Electron QA entry rejects RUN_AS_NODE browser identity and imported Node modules', () => {
  const current = { filename: __filename }
  assert.equal(isQaMain(current, current, { type: 'browser', versions: { electron: '44.3.0' }, env: { ELECTRON_RUN_AS_NODE: '1' }, argv: ['electron', __filename] }), false)
  assert.equal(isQaMain(current, current, { versions: {}, env: {}, argv: ['node', __filename] }), true)
  assert.equal(isQaMain(current, {}, { versions: {}, env: {}, argv: ['node', __filename] }), false)
  assert.equal(loadedAsEntry, false)
})

test('QA entry retains actual ordinary Node direct behavior without starting an imported helper', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-node-entry-'))
  const main = path.join(root, 'main.cjs'), helper = path.resolve('scripts/qa-entry.cjs')
  fs.writeFileSync(main, `const q=require(${JSON.stringify(helper)});console.log(JSON.stringify({direct:q.isQaMain(module,require.main),helper:q.loadedAsEntry}));`)
  try {
    const result = JSON.parse(execFileSync(process.execPath, [main], { encoding: 'utf8', timeout: 10000 }).trim())
    assert.deepEqual(result, { direct: true, helper: false })
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})

test('actual pinned Electron custom-main loads the QA entry and leaves its private imported helper inactive', {
  timeout: 30000,
  skip: process.platform === 'linux' && !process.env.DISPLAY ? 'No display on native package test host; mandatory integration Xvfb loader contract runs separately, not desktop acceptance' : false
}, () => {
  const executable = require('electron'), env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
  const output = execFileSync(executable, [path.resolve('scripts/verify-electron-qa-entry.cjs'), process.arch], { encoding: 'utf8', env, timeout: 25000, maxBuffer: 1024 * 1024 })
  const match = /^QA_ENTRY_PROOF (.+)$/m.exec(output); assert(match, 'Actual Electron must execute and emit the short-main receipt')
  const file = match[1].trim(), report = JSON.parse(fs.readFileSync(file)), actual = report.actual
  assert.equal(report.complete, true); assert.equal(report.ready, true); assert.equal(report.contractOnly, true); assert.equal(report.nativeDesktop, false)
  assert.equal(actual.matchedRequestedEntry, true); assert.equal(actual.helperLoadedAsEntry, false)
  assert.equal(actual.type, 'browser'); assert.equal(actual.runAsNode, false); assert.equal(actual.arch, process.arch)
  assert.equal(actual.runtime, require('../package.json').devDependencies.electron)
  assert.equal(fs.realpathSync(actual.argv[1]), fs.realpathSync(actual.moduleFile))
  assert.equal(actual.executableSHA256, crypto.createHash('sha256').update(fs.readFileSync(executable)).digest('hex'))
  const privateRoot = path.dirname(actual.userData)
  assert.equal(actual.appData, path.join(privateRoot, 'config')); assert.equal(actual.userData, path.join(privateRoot, 'profile'))
  assert(path.resolve(privateRoot).startsWith(path.resolve(os.tmpdir()) + path.sep)); assert(path.basename(privateRoot).startsWith('KAMUCL QA entry '))
  // execFileSync has observed the owned native process's normal exit already.
  fs.rmSync(privateRoot, { recursive: true, force: true })
})
