import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { adaptOptionsForVersion } from '../src/main/core/keybindings'
import { VANILLA_OPTIONS } from '../src/shared/keybindings'

const read = (file: string) => fs.readFileSync(file, 'utf8')

test('option field names match real options.txt (evidence-based): enableVsync/maxFps/toggleCrouch/toggleSprint/graphicsPreset', () => {
  const ids = new Set(VANILLA_OPTIONS.map((d) => d.id))
  // 实证字段名（26.2 真实 options.txt 核对）
  for (const correct of ['enableVsync', 'maxFps', 'toggleCrouch', 'toggleSprint', 'graphicsPreset', 'fov', 'gamma', 'renderDistance', 'mouseSensitivity', 'autoJump', 'resourcePacks']) {
    assert(ids.has(correct), `must use real field name: ${correct}`)
  }
  // 旧错误字段名不得存在
  for (const wrong of ['vsync', 'maxFramerate', 'sneakToggled', 'sprintToggled', 'graphics']) {
    assert(!ids.has(wrong), `wrong field name must be gone: ${wrong}`)
  }
})

test('FOV is 0-1 float in options.txt for ALL versions (1.12.2 and 26.2 alike), no version fork', () => {
  // 实证：1.12.2 与 26.2 的 options.txt 都是 0-1 浮点
  for (const mc of ['1.12.2', '1.16.1', '1.20.1', '1.21.1', '26.2']) {
    assert.equal(adaptOptionsForVersion({ fov: '70' }, mc).fov, '0.5', `fov 70° must be 0.5 float for ${mc}`)
    assert.equal(adaptOptionsForVersion({ fov: '90' }, mc).fov, '0.75', `fov 90° must be 0.75 for ${mc}`)
    assert.equal(adaptOptionsForVersion({ fov: '30' }, mc).fov, '0', `fov 30° → 0 for ${mc}`)
    assert.equal(adaptOptionsForVersion({ fov: '110' }, mc).fov, '1', `fov 110° → 1 for ${mc}`)
  }
})

test('graphics preset: graphics:0/1/2 before 1.21.11, graphicsPreset quoted string from 1.21.11', () => {
  assert.equal(adaptOptionsForVersion({ graphicsPreset: 'fancy' }, '1.20.1').graphics, '1')
  assert.equal(adaptOptionsForVersion({ graphicsPreset: 'fancy' }, '1.20.1').graphicsPreset, undefined)
  assert.equal(adaptOptionsForVersion({ graphicsPreset: 'fast' }, '1.12.2').graphics, '0')
  assert.equal(adaptOptionsForVersion({ graphicsPreset: 'fabulous' }, '26.2').graphicsPreset, '"fabulous"')
  assert.equal(adaptOptionsForVersion({ graphicsPreset: 'fancy' }, '1.21.11').graphicsPreset, '"fancy"')
})

test('toggleCrouch/toggleSprint skipped before 1.15 (field did not exist)', () => {
  const legacy = adaptOptionsForVersion({ toggleCrouch: 'true', toggleSprint: 'true', fov: '70' }, '1.12.2')
  assert.equal(legacy.toggleCrouch, undefined)
  assert.equal(legacy.toggleSprint, undefined)
  const modern = adaptOptionsForVersion({ toggleCrouch: 'true' }, '1.20.1')
  assert.equal(modern.toggleCrouch, 'true')
})

test('slider does not bounce back while dragging: value binds preview during drag', () => {
  const view = read('src/renderer/src/views/KeysView.vue')
  assert.match(view, /:value="sliderPreview\[item\.id\] \?\? optionValue\(item\)"/)
  assert.match(view, /@input="onSliderInput/)
  assert.match(view, /@change="onSliderChange/)
})

test('autoJump added with MC default true; resourcePacks drag-drop remains', () => {
  const autoJump = VANILLA_OPTIONS.find((d) => d.id === 'autoJump')
  assert(autoJump, 'autoJump exists')
  assert.equal(autoJump.defaultValue, true, 'MC default autoJump is true')
  const view = read('src/renderer/src/views/KeysView.vue')
  assert.match(view, /cfg-pack-zone/)
  assert.match(view, /onPackDrop/)
})
