import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { importResourceFiles } from '../src/main/core/resourceFiles'
import { selectModTarget } from '../src/main/core/modTargets'
import { trackLaunchState, instanceLaunchBusy, type LaunchTracking } from '../src/shared/launchTracking'
import type { InstalledVersion } from '../src/shared/types'

test('resource drops use selected folder and instance gameDir for each category, preserve originals and collisions', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kamucl-drop-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const a = path.join(root, 'A'), b = path.join(root, 'B'), src = path.join(root, 'source')
  fs.mkdirSync(src)
  const targets = [a, b].map(folder => ({ id: 'same', folder, gameDirectory: path.join(folder, 'versions', 'same') } as InstalledVersion))
  const target = selectModTarget(targets, 'same', b)
  for (const kind of ['mods', 'resourcepacks', 'shaderpacks']) {
    const name = kind === 'mods' ? 'example.jar' : kind + '.zip', file = path.join(src, name)
    fs.writeFileSync(file, kind)
    assert.equal(importResourceFiles([file], target, kind), 1)
    assert.equal(fs.readFileSync(path.join(target.gameDirectory!, kind, name), 'utf8'), kind)
    assert(!fs.existsSync(a)); assert(fs.existsSync(file))
    assert.throws(() => importResourceFiles([file], target, kind), /同名/)
  }
  const shared = { ...target, gameDirectory: b }
  importResourceFiles([path.join(src, 'resourcepacks.zip')], shared, 'resourcepacks')
  assert(fs.existsSync(path.join(b, 'resourcepacks', 'resourcepacks.zip')))
  assert.throws(() => selectModTarget(targets, 'same', root), /未登记/)
  assert.throws(() => importResourceFiles([path.join(src, 'resourcepacks.zip')], target, 'mods'), /不支持/)
  assert.throws(() => importResourceFiles([path.join(src, 'example.jar')], target, 'resourcepacks'), /不支持/)
  assert.throws(() => importResourceFiles([path.join(src, 'example.jar')], target, '../mods'), /无效/)
})

test('same instance can run repeatedly; older process exit does not clear newer preparation or running state', () => {
  const state: LaunchTracking = { launchState: null, launchStates: {}, launchingVersionId: '', launchingFolder: '' }
  const event = (launchId: string, status: 'launching' | 'running' | 'exited') => trackLaunchState(state, { launchId, status, versionId: 'same', folder: 'A', text: '' })
  event('one', 'running'); assert(!instanceLaunchBusy(state.launchStates, 'same', 'A'))
  event('two', 'launching'); assert(instanceLaunchBusy(state.launchStates, 'same', 'A'))
  event('one', 'exited'); assert.equal(state.launchState?.launchId, 'two'); assert(instanceLaunchBusy(state.launchStates, 'same', 'A'))
  event('two', 'running'); assert(!instanceLaunchBusy(state.launchStates, 'same', 'A'))
  event('three', 'running'); event('three', 'exited'); assert.equal(state.launchState?.launchId, 'two')
})
