const test = require('node:test'), assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), vm = require('node:vm')
const { EventEmitter } = require('node:events'), { buildSync } = require('esbuild')
const { packagedWindowDirectories } = require('../scripts/verify-linux-business.cjs')

// These exercise the unchanged product resolver with an isolated platform
// facade. No native helper or real desktop window is started by this contract.
const product = buildSync({ entryPoints: ['src/main/core/gracefulClose.ts'], bundle: true, platform: 'node', format: 'cjs', packages: 'external', write: false }).outputFiles[0].text
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'KAMUCL window-path contract-'))
  const originalRoot = fs.realpathSync(root)
  t.after(() => {
    assert.equal(fs.realpathSync(root), originalRoot)
    assert(fs.lstatSync(root).isDirectory() && !fs.lstatSync(root).isSymbolicLink())
    assert(path.basename(root).startsWith('KAMUCL window-path contract-'))
    fs.rmSync(root, { recursive: true })
  })
  const application = path.join(root, "KAMUCL 中文 § O'Neil")
  const directories = packagedWindowDirectories(application)
  const helper = path.join(application, 'resources', 'app.asar.unpacked', 'out', 'main', 'LinuxGameWindow')
  fs.mkdirSync(path.dirname(helper), { recursive: true }); fs.writeFileSync(helper, 'contract fixture; never execute')
  return { root, directories, helper }
}
function backend(dirname, helper, root) {
  const calls = [], productModule = { exports: {} }, localProcess = Object.create(process)
  Object.defineProperty(localProcess, 'platform', { value: 'linux' })
  const child = new EventEmitter(); Object.assign(child, { pid: 43210, exitCode: null, signalCode: null })
  const requireProduct = name => {
    if (name === 'electron') return { app: { isPackaged: false, getPath: () => root } }
    if (name !== 'node:child_process') return require(name)
    return { ...require(name), execFile(file, args, options, done) {
      calls.push({ file, args, options })
      const worker = new EventEmitter(); worker.kill = () => { throw Error('The contract must not cancel a live fixture') }
      setImmediate(() => {
        if (file !== helper || !fs.existsSync(file)) done(Object.assign(Error('spawn ' + file + ' ENOENT'), { code: 'ENOENT' }), '', '')
        else done(null, '', '')
      })
      return worker
    } }
  }
  vm.runInNewContext(product, { module: productModule, exports: productModule.exports, process: localProcess, __dirname: dirname, require: requireProduct, Buffer, console, setTimeout, clearTimeout })
  return { product: productModule.exports, calls, child }
}

test('Linux packaged-window QA passes the ASAR logical directory and the real product maps to the existing unpacked helper once', { timeout: 10000 }, async t => {
  const f = fixture(t)
  assert.equal(f.directories.logicalDirectory, path.join(path.dirname(path.dirname(path.dirname(f.helper))), '..', 'app.asar', 'out', 'main'))
  assert.equal(f.directories.helperDirectory, path.dirname(f.helper))
  const actual = backend(f.directories.logicalDirectory, f.helper, f.root)
  await actual.product.focusGameWindow(actual.child, 10000)
  await actual.product.requestGameWindowClose(actual.child)
  assert.deepEqual(actual.calls.map(row => row.file), [f.helper, f.helper])
  assert.deepEqual(actual.calls.map(row => Array.from(row.args)), [['focus', '43210', '10000'], ['close', '43210', '6000']])
  assert.deepEqual(actual.calls.map(row => row.options.timeout), [12000, 8000])
  assert.equal(actual.child.exitCode, null); assert.equal(actual.child.listenerCount('exit'), 0)
})

test('Linux packaged-window QA rejects the historic already-unpacked directory with the original helper error', { timeout: 10000 }, async t => {
  const f = fixture(t), actual = backend(f.directories.helperDirectory, f.helper, f.root)
  await assert.rejects(actual.product.focusGameWindow(actual.child, 10000), /Linux 游戏窗口操作失败/)
  assert.equal(actual.calls.length, 1)
  assert(actual.calls[0].file.includes('app.asar.unpacked.unpacked'))
  assert(!fs.existsSync(actual.calls[0].file)); assert(fs.existsSync(f.helper))
  assert.equal(actual.child.exitCode, null); assert.equal(actual.child.listenerCount('exit'), 0)
})
