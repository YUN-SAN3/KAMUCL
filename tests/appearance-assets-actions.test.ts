import assert from 'node:assert/strict'
import test from 'node:test'
import { createAppearanceAssetActions } from '../src/main/core/appearanceAssetActions'
import { DEFAULT_BACKGROUND, DEFAULT_LAUNCH_THUMBNAIL, type Settings } from '../src/shared/types'

function fixture(failSave = false, failImportAt = 0) {
  let current = { background: { ...DEFAULT_BACKGROUND, mode: 'image', image: 'old-a.jpg', images: ['old-a.jpg', 'old-b.png'], switchMode: 'random' }, launchThumbnail: structuredClone(DEFAULT_LAUNCH_THUMBNAIL) } as Settings
  const removed: string[] = [], events: string[] = []
  let imports = 0
  const actions = createAppearanceAssetActions({
    getSettings: () => current,
    saveSettings: patch => { events.push('save'); if (failSave) throw new Error('disk full'); current = { ...current, ...patch }; return current },
    importImage: async source => { if (++imports === failImportAt) throw new Error('decode failed'); events.push('import:' + source); return { path: 'managed-' + source } },
    removeImage: image => { events.push('remove:' + image); removed.push(image) }
  })
  return { actions, removed, events, settings: () => current }
}
test('single background replaces the slideshow, disables switching, and cleans copies only after commit', async () => {
  const f = fixture(), result = await f.actions.singleBackground('new.png')
  assert.deepEqual(result.background.images, ['managed-new.png'])
  assert.equal(result.background.image, 'managed-new.png')
  assert.equal(result.background.switchMode, 'off')
  assert.deepEqual(f.removed, ['old-a.jpg', 'old-b.png'])
  assert(f.events.indexOf('save') < f.events.indexOf('remove:old-a.jpg'))
})
test('failed single background save keeps all previous images and removes only the new copy', async () => {
  const f = fixture(true)
  await assert.rejects(f.actions.singleBackground('new.png'), /disk full/)
  assert.deepEqual(f.settings().background.images, ['old-a.jpg', 'old-b.png'])
  assert.deepEqual(f.removed, ['managed-new.png'])
})
test('a failed multi-import cleans imported copies while preserving the old list', async () => {
  const f = fixture(false, 2)
  await assert.rejects(f.actions.multipleImages(['new.png', 'bad.png'], 'background'), /decode failed/)
  assert.deepEqual(f.settings().background.images, ['old-a.jpg', 'old-b.png'])
  assert.deepEqual(f.removed, ['managed-new.png'])
})
test('adding backgrounds includes an existing single background and keeps its switching settings', async () => {
  const f = fixture(); f.settings().background.images = []
  const result = await f.actions.multipleImages(['new.webp'], 'background')
  assert.deepEqual(result.background.images, ['old-a.jpg', 'managed-new.webp'])
  assert.equal(result.background.switchMode, 'random')
})
test('failed reset does not delete current managed images', () => {
  const f = fixture(true)
  assert.throws(() => f.actions.resetBackground(), /disk full/)
  assert.deepEqual(f.removed, [])
})
