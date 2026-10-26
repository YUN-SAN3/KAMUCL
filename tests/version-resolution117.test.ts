import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'esbuild'

test('117 resolution writes atomically preserve original instance bytes on partial write and rename failure', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kamucl-resolution117-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const result = await build({ stdin: { contents: "export {setVersionResolution} from './src/main/core/versions';export {getSettings} from './src/main/core/settings';export {closeHttpClient} from './src/main/core/httpClient';", resolveDir: process.cwd(), loader: 'ts' }, bundle: true, write: false, format: 'cjs', platform: 'node', packages: 'external', logLevel: 'silent' })
  const req = createRequire(import.meta.url), module = { exports: {} as any }
  new Function('require', 'module', 'exports', result.outputFiles[0].text)((name: string) => name === 'electron' ? { app: { getPath: (kind: string) => path.join(root, kind), getVersion: () => 'test', getName: () => 'test' } } : req(name), module, module.exports)
  const api = module.exports, folder = path.join(root, '中文 实例 §'), dir = path.join(folder, 'versions', 'custom')
  fs.mkdirSync(dir, { recursive: true })
  Object.assign(api.getSettings(), { gameDir: folder, activeFolder: folder, folders: [{ path: folder, isDefault: true }] })
  t.after(() => api.closeHttpClient())
  const file = path.join(dir, 'custom.json'), original = Buffer.from('{\r\n "id": "custom", "_mcVersion": "1.21.5", "privateCustomData": [1,2,3], "_resolution": {"mode":"windowed","width":854,"height":480}\r\n}\r\n')
  fs.writeFileSync(file, original)
  const write = fs.writeFileSync, rename = fs.renameSync
  fs.writeFileSync = ((target: any, ...args: any[]) => {
    if (String(target).startsWith(file + '.window-size-')) {
      write(target, '{partial', { flag: 'wx' })
      throw Object.assign(new Error('Injected ENOSPC after partial temporary write'), { code: 'ENOSPC' })
    }
    return Reflect.apply(write, fs, [target, ...args])
  }) as typeof fs.writeFileSync
  try { assert.throws(() => api.setVersionResolution('custom', { mode: 'windowed', width: 900, height: 500 }), /ENOSPC/) }
  finally { fs.writeFileSync = write }
  assert.deepEqual(fs.readFileSync(file), original)
  assert.deepEqual(fs.readdirSync(dir), ['custom.json'])
  fs.renameSync = ((source: any, dest: any) => {
    if (String(dest) === file) throw Object.assign(new Error('Injected sharing violation'), { code: 'EPERM' })
    return rename(source, dest)
  }) as typeof fs.renameSync
  try { assert.throws(() => api.setVersionResolution('custom', { mode: 'windowed', width: 900, height: 500 }), /sharing violation/) }
  finally { fs.renameSync = rename }
  assert.deepEqual(fs.readFileSync(file), original)
  assert.deepEqual(fs.readdirSync(dir), ['custom.json'])
  api.setVersionResolution('custom', { mode: 'windowed', width: 900, height: 500 })
  const changed = JSON.parse(fs.readFileSync(file, 'utf8'))
  assert.deepEqual(changed._resolution, { mode: 'windowed', width: 900, height: 500, fullscreen: false })
  assert.deepEqual(changed.privateCustomData, [1, 2, 3])
  api.setVersionResolution('custom', null)
  assert.equal('_resolution' in JSON.parse(fs.readFileSync(file, 'utf8')), false)
  assert.deepEqual(fs.readdirSync(dir), ['custom.json'])
})
