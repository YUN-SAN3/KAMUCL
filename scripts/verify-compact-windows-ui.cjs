// Build a test-only executable directory from the shipped, pruned Windows runtime.
// Keep the real ASAR outside resources so Electron executes our isolated harness,
// never the user's launcher profile. No files are removed from the release payload.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const source = path.resolve('release/win-unpacked')
const root = fs.mkdtempSync(path.resolve('out/compact-ui-'))
for (const name of ['dxcompiler.dll', 'dxil.dll']) assert(!fs.existsSync(path.join(source, name)), name + ' must be pruned first')
for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
  if (entry.name === 'resources') continue
  fs.cpSync(path.join(source, entry.name), path.join(root, entry.name), { recursive: true })
}
fs.mkdirSync(path.join(root, 'resources'))
fs.copyFileSync('node_modules/electron/dist/resources/default_app.asar', path.join(root, 'resources/default_app.asar'))
fs.mkdirSync(path.join(root, 'payload'))
for (const name of ['app.asar', 'app.asar.unpacked']) {
  fs.cpSync(path.join(source, 'resources', name), path.join(root, 'payload', name), { recursive: true })
}
console.log('Test runtime:', root)
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
for (const mode of ['hardware', 'software']) {
  const run = spawnSync(path.join(root, 'KAMUCL.exe'), [path.resolve('scripts/verify-packaged-windows-ui.cjs'), path.join(root, 'payload/app.asar')], {
    env: { ...env, KAMUCL_TEST_SOFTWARE: mode === 'software' ? '1' : '0' }, encoding: 'utf8', windowsHide: true, timeout: 60000
  })
  fs.writeFileSync(path.join(root, mode + '.log'), (run.stdout || '') + (run.stderr || ''))
  console.log(run.stdout, run.stderr)
  assert.ifError(run.error); assert.equal(run.status, 0, mode + ' UI check failed')
}
if (process.argv.includes('--presentation')) {
  const run = spawnSync(path.join(root, 'KAMUCL.exe'), [path.resolve('scripts/verify-window-presentation.cjs')], {
    env: { ...env, KAMUCL_TEST_ENTRY: path.join(root, 'payload/app.asar/out/main/index.js') }, encoding: 'utf8', windowsHide: true, timeout: 75000
  })
  fs.writeFileSync(path.join(root, 'presentation.log'), (run.stdout || '') + (run.stderr || ''))
  console.log(run.stdout, run.stderr)
  assert.ifError(run.error); assert.equal(run.status, 0, 'Window presentation check failed')
}
