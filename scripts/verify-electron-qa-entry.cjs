// This intentionally executes as a dedicated short Electron main; no product
// application or user profile is loaded. No window/GPU/sandbox option is changed.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os')
const assert = require('node:assert/strict'), crypto = require('node:crypto')
const { app } = require('electron'), { isQaMain, loadedAsEntry } = require('./qa-entry.cjs')
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'KAMUCL QA entry '))
const proof = path.resolve('out/qa-entry-proof-' + process.platform + '-' + process.arch + '-' + Date.now())
fs.mkdirSync(proof, { recursive: true }); fs.mkdirSync(path.join(root, 'config')); fs.mkdirSync(path.join(root, 'profile'))
app.setPath('appData', path.join(root, 'config')); app.setPath('userData', path.join(root, 'profile'))
const report = { schemaVersion: 1, complete: false, nativeDesktop: false, contractOnly: true,
  actual: { pid: process.pid, executable: process.execPath, executableSHA256: crypto.createHash('sha256').update(fs.readFileSync(process.execPath)).digest('hex'),
    argv: process.argv, moduleFile: module.filename, requireMainFile: require.main?.filename ?? null,
    requireMainEqualsModule: require.main === module, helperLoadedAsEntry: loadedAsEntry,
    matchedRequestedEntry: isQaMain(module, require.main), platform: process.platform, arch: process.arch, runtime: process.versions.electron,
    runAsNode: !!process.env.ELECTRON_RUN_AS_NODE, type: process.type, appData: app.getPath('appData'), userData: app.getPath('userData') }, startedAt: new Date().toISOString() }
const save = () => fs.writeFileSync(path.join(proof, 'verification.json'), JSON.stringify(report, null, 2))
save()
const timer = setTimeout(() => {
  report.error = { code: 'QA_ENTRY_READY_DEADLINE', message: 'Owned Electron entry fixture did not become ready in 15 seconds' }; save(); app.exit(1)
}, 15000)
app.whenReady().then(() => {
  assert.equal(report.actual.matchedRequestedEntry, true)
  assert.equal(report.actual.helperLoadedAsEntry, false)
  assert.equal(report.actual.type, 'browser'); assert.equal(report.actual.runAsNode, false)
  assert.equal(report.actual.runtime, require('../package.json').devDependencies.electron)
  assert.equal(process.arch, process.argv[2]); assert.equal(app.getPath('userData'), path.join(root, 'profile'))
  report.ready = true; report.complete = true; report.finishedAt = new Date().toISOString(); save()
  console.log('QA_ENTRY_PROOF ' + path.join(proof, 'verification.json'))
  // The invoking test may remove this private profile after this process exits;
  // removing an active Chromium profile would itself create a fixture failure.
  clearTimeout(timer); app.exit(0)
}).catch(error => {
  report.error = { name: error.name, message: error.message, stack: error.stack }; report.complete = false; save()
  clearTimeout(timer); console.error(error); app.exit(1)
})
