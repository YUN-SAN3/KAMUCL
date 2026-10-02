import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { configureRuntimeGraphics } from '../src/main/runtimeGraphics'

test('compact runtime keeps existing switches and does not disable WebGL/GPU; full Windows and Mac are unchanged', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kamucl-graphics-'))
  try {
    const flags = new Map<string, string>([['disable-features', 'ExistingFeature']])
    const commandLine = { getSwitchValue: (n: string) => flags.get(n) || '', appendSwitch: (n: string, v = '') => { flags.set(n, v) } }
    assert.equal(configureRuntimeGraphics(commandLine, 'darwin', root), false)
    assert.equal(flags.size, 1)
    assert.equal(configureRuntimeGraphics(commandLine, 'win32', root), true)
    assert.equal(flags.get('disable-features'), 'ExistingFeature,WebGPUService')
    assert(flags.has('disable-skia-graphite'))
    assert(!flags.has('disable-gpu')); assert(!flags.has('use-angle'))
    configureRuntimeGraphics(commandLine, 'win32', root)
    assert.equal(flags.get('disable-features'), 'ExistingFeature,WebGPUService')
    fs.writeFileSync(path.join(root, 'dxcompiler.dll'), 'present')
    const before = [...flags]
    assert.equal(configureRuntimeGraphics(commandLine, 'win32', root), false)
    assert.deepEqual([...flags], before)
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})
