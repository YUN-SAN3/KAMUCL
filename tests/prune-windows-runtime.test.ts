import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import { createRequire } from 'node:module'

const { pruneWindowsRuntime, OPTIONAL_DXC } = createRequire(import.meta.url)('../scripts/prune-windows-runtime.cjs')
const hash = (data: Buffer) => crypto.createHash('sha256').update(data).digest('hex')
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kamucl-runtime-prune-'))
  const appOutDir = path.join(root, 'output')
  fs.mkdirSync(appOutDir)
  return { root, context: { electronPlatformName: 'win32', arch: 1, appOutDir, packager: { config: { electronVersion: '44.3.0' }, info: { appDir: root } } } }
}

test('runtime pruning ignores Mac and rejects unsupported Electron/architecture and source directory', () => {
  const { root, context } = fixture()
  try {
    assert.deepEqual(pruneWindowsRuntime({ ...context, electronPlatformName: 'darwin' }), [])
    assert.throws(() => pruneWindowsRuntime({ ...context, arch: 3 }), /Review compact Windows runtime/)
    assert.throws(() => pruneWindowsRuntime({ ...context, packager: { ...context.packager, config: { electronVersion: '45.0.0' } } }), /Review compact Windows runtime/)
    assert.throws(() => pruneWindowsRuntime({ ...context, appOutDir: root }), /Refusing to prune source/)
    fs.writeFileSync(path.join(context.appOutDir, 'dxcompiler.dll'), 'unreviewed compiler')
    assert.throws(() => pruneWindowsRuntime(context), /Review changed optional compiler/)
    assert(fs.existsSync(path.join(context.appOutDir, 'dxcompiler.dll')))
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})

test('reviewed Windows runtime removes only DXC, with no partial pruning on a changed second DLL', t => {
  const originals = path.resolve('node_modules/electron/dist')
  if (!Object.entries(OPTIONAL_DXC).every(([name, expected]) => fs.existsSync(path.join(originals, name)) && hash(fs.readFileSync(path.join(originals, name))) === expected)) {
    t.skip('Requires the reviewed Electron 44.3.0 Windows x64 distribution')
    return
  }
  const { root, context } = fixture()
  try {
    const output = context.appOutDir
    fs.copyFileSync(path.join(originals, 'dxcompiler.dll'), path.join(output, 'dxcompiler.dll'))
    fs.writeFileSync(path.join(output, 'dxil.dll'), 'changed')
    fs.writeFileSync(path.join(output, 'd3dcompiler_47.dll'), 'keep WebGL compiler')
    assert.throws(() => pruneWindowsRuntime(context), /Review changed optional compiler: dxil.dll/)
    assert(fs.existsSync(path.join(output, 'dxcompiler.dll')), 'Validation must finish before any removal')
    fs.copyFileSync(path.join(originals, 'dxil.dll'), path.join(output, 'dxil.dll'))
    const removed = pruneWindowsRuntime(context)
    assert.deepEqual(removed.map((f: { name: string }) => f.name), Object.keys(OPTIONAL_DXC))
    assert.equal(removed.reduce((sum: number, f: { bytes: number }) => sum + f.bytes, 0), 27254656)
    assert.deepEqual(fs.readdirSync(output), ['d3dcompiler_47.dll'])
    assert.equal(fs.readFileSync(path.join(output, 'd3dcompiler_47.dll'), 'utf8'), 'keep WebGL compiler')
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})
