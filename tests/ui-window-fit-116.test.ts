import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import type { BrowserWindow, screen } from 'electron'
import { fitUiWindowBounds, fittedUiScale, uiWindowMinimum, UiZoomState } from '../src/shared/uiSizing'
import { adaptiveWindowOptions, applyUiWindowAutoFit, attachUiWindowSizing } from '../src/main/uiWindowSizing'
import { searchSettings } from '../src/shared/settingsCatalog'

const area = { x: 0, y: 0, width: 1366, height: 728 }
function fixture(initialZoom = 1) {
  const win = new EventEmitter(), contents = new EventEmitter(), displays = new EventEmitter()
  let bounds = { x: 3, y: 3, width: 1360, height: 860 }, factor = initialZoom, minimum: number[] = [960, 620]
  let maximized = false, minimized = false, destroyed = false, workArea = { ...area }
  const writes: string[] = []
  Object.assign(contents, { getZoomFactor: () => factor, setZoomFactor: (value: number) => { writes.push('zoom'); factor = value }, isDestroyed: () => destroyed })
  Object.assign(win, { webContents: contents, isDestroyed: () => destroyed, isMinimized: () => minimized,
    isMaximized: () => maximized, isFullScreen: () => false, getBounds: () => ({ ...bounds }),
    getContentSize: () => [bounds.width, bounds.height],
    setBounds: (value: typeof bounds) => { writes.push('bounds'); bounds = { ...value }; win.emit('resize') },
    setMinimumSize: (...value: number[]) => { minimum = value; writes.push('minimum') } })
  Object.assign(displays, { getDisplayMatching: () => ({ workArea }), getPrimaryDisplay: () => ({ workArea }) })
  return { win: win as unknown as BrowserWindow, displays: displays as unknown as Pick<typeof screen, 'getDisplayMatching' | 'getPrimaryDisplay' | 'on' | 'removeListener'>,
    contents, native: win, displayEvents: displays, writes, zoom: () => factor, bounds: () => bounds, minimum: () => minimum,
    resize: (width: number, height: number) => { bounds = { ...bounds, width, height }; win.emit('resize') },
    externalZoom: (value: number) => { factor = value }, setMinimized: (value: boolean) => { minimized = value },
    maximize: (value: boolean) => { maximized = value; win.emit(value ? 'maximize' : 'unmaximize') },
    display: (value: typeof area) => { workArea = value; displays.emit('display-metrics-changed') },
    close: () => { destroyed = true; win.emit('closed') } }
}
const settled = () => new Promise(resolve => setTimeout(resolve, 85))

test('small-screen initial window leaves taskbar/native margins and fits once in DIP', () => {
  const f = fixture()
  const options = adaptiveWindowOptions({ width: 1360, height: 860, minWidth: 960, minHeight: 620 }, f.displays)
  assert.equal(options.width, 1256); assert.equal(options.height, 669)
  assert(options.x! >= 0 && options.y! >= 0 && options.x! + options.width! <= area.width && options.y! + options.height! <= area.height)
  assert(Math.abs(fittedUiScale({ width: options.width!, height: options.height! }) - 669 / 740) < 1e-9)
  const highDpi = { x: -960, y: 40, width: 960, height: 540 }
  assert.deepEqual(uiWindowMinimum(highDpi), [883, 496])
  const b = fitUiWindowBounds({ x: -1400, y: -200, width: 1360, height: 860 }, highDpi)
  assert(b.x >= -960 && b.y >= 40 && b.x + b.width <= 0 && b.y + b.height <= 580)
})

test('absolute scaling keeps independent manual zoom across repeated resizes, toggles and large monitors', () => {
  const zoom = new UiZoomState(1.25)
  zoom.configure(true, 1.25)
  const factor = zoom.fit({ width: 1256, height: 669 })
  for (let i = 0; i < 100; i++) { zoom.configure(true, factor); assert.equal(zoom.fit({ width: 1256, height: 669 }), factor) }
  assert.equal(zoom.fit({ width: 2500, height: 1600 }), 1.25, 'never enlarge beyond manual preference')
  zoom.fit({ width: 1256, height: 669 }); zoom.userZoom('out')
  zoom.configure(false, factor)
  assert(Math.abs(zoom.zoom - 1.25 / 1.1) < 1e-9)
  for (let i = 0; i < 50; i++) { const current = zoom.zoom; zoom.configure(true, current); zoom.fit({ width: 1256, height: 669 }); zoom.configure(false, zoom.zoom); assert(Math.abs(zoom.zoom - 1.25 / 1.1) < 1e-9) }
})

test('disabled feature leaves existing native geometry and arbitrary user zoom completely unchanged', async () => {
  const f = fixture(2.5)
  attachUiWindowSizing(f.win, false, f.displays)
  f.resize(1000, 650); f.display({ x: 0, y: 0, width: 1024, height: 700 }); f.contents.emit('did-finish-load')
  await settled()
  assert.equal(f.zoom(), 2.5); assert.deepEqual(f.writes, [])
  f.close()
})

test('live resize, external manual zoom and disabling do not accumulate fitted scale', async () => {
  const f = fixture(1.25)
  attachUiWindowSizing(f.win, true, f.displays)
  const first = f.zoom()
  for (let i = 0; i < 10; i++) f.native.emit('resize')
  await settled(); assert.equal(f.zoom(), first)
  f.contents.emit('zoom-changed', {}, 'in')
  assert(Math.abs(f.zoom() - first * 1.1) < 1e-9)
  f.resize(1100, 640); await settled()
  assert(Math.abs(f.zoom() - 1.25 * 1.1 * 640 / 740) < 1e-9)
  f.externalZoom(f.zoom() / 1.1)
  applyUiWindowAutoFit(f.win, false)
  assert(Math.abs(f.zoom() - 1.25) < 1e-9)
  assert.deepEqual(f.minimum(), [960, 620])
  f.close()
})

test('maximized window remains maximized, smaller disconnected displays constrain only normal windows', async () => {
  const f = fixture()
  attachUiWindowSizing(f.win, true, f.displays)
  f.maximize(true); f.resize(1366, 728); await settled()
  f.writes.length = 0
  f.display({ x: -960, y: 0, width: 960, height: 540 })
  assert(!f.writes.includes('bounds'), 'never reverse OS maximize')
  f.maximize(false); await settled()
  const b = f.bounds()
  assert(b.x >= -960 && b.x + b.width <= 0 && b.y + b.height <= 540)
  assert.deepEqual(f.minimum(), [883, 496])
  f.close()
})

test('disabling while minimized restores zoom; closing releases display listeners and pending work', async () => {
  const f = fixture(1.25)
  attachUiWindowSizing(f.win, true, f.displays)
  f.setMinimized(true); applyUiWindowAutoFit(f.win, false)
  assert.equal(f.zoom(), 1.25)
  assert.equal(f.displayEvents.listenerCount('display-metrics-changed'), 1)
  f.native.emit('resize'); f.close()
  const calls = f.writes.length
  await settled()
  assert.equal(f.writes.length, calls)
  for (const event of ['display-metrics-changed', 'display-added', 'display-removed']) assert.equal(f.displayEvents.listenerCount(event), 0)
})

test('settings search distinguishes launcher adaptation from game resolution', () => {
  assert(searchSettings('自适应').some(item => item.id === 'ui-window-fit'))
  assert(searchSettings('1366').some(item => item.id === 'ui-window-fit'))
})

test('existing 250% zoom survives adaptation, gradual keyboard changes and reset without preference loss', () => {
  const f = fixture(2.5)
  attachUiWindowSizing(f.win, true, f.displays)
  applyUiWindowAutoFit(f.win, false); assert.equal(f.zoom(), 2.5)
  applyUiWindowAutoFit(f.win, true)
  let prevented = 0
  const event = { preventDefault: () => { prevented++ } }
  f.contents.emit('before-input-event', event, { type: 'keyDown', control: true, meta: false, alt: false, key: '-' })
  applyUiWindowAutoFit(f.win, false)
  assert(Math.abs(f.zoom() - 2.5 / 1.1) < 1e-9, 'one minus does not abruptly clamp to 200%')
  applyUiWindowAutoFit(f.win, true)
  f.contents.emit('before-input-event', event, { type: 'keyDown', control: true, meta: false, alt: false, key: '0' })
  assert(Math.abs(f.zoom() - fittedUiScale(f.bounds())) < 1e-9)
  applyUiWindowAutoFit(f.win, false); assert.equal(f.zoom(), 1); assert.equal(prevented, 2)
  f.close()
})
