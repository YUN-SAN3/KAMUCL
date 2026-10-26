// Native sidebar evidence from a disposable, explicitly bound QA instance.
// This observer inserts no CSS, changes no layout and performs no input.
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const { captureOwned } = require('./qa-native-window115.cjs')

function readSidebarFrames() {
  const read = timestamp => ({
    timestamp,
    observedAt: performance.now(),
    timeOrigin: performance.timeOrigin,
    url: location.href,
    focus: document.hasFocus(),
    hidden: document.hidden,
    finiteAnimations: document.getAnimations().filter(a =>
      (a.playState === 'running' || a.pending) &&
      a.effect?.getComputedTiming().iterations !== Infinity).length,
    sidebar: document.querySelector('.sidebar').getBoundingClientRect().toJSON(),
    scroll: document.querySelector('.sidebar .nav').scrollTop,
    items: [...document.querySelectorAll('.sidebar [data-nav]')].map(e => ({
      nav: e.dataset.nav,
      label: e.textContent.trim(),
      rect: e.getBoundingClientRect().toJSON(),
      transform: getComputedStyle(e).transform,
      animations: e.getAnimations({ subtree: true }).filter(a =>
        a.playState === 'running' || a.pending).length,
    })),
  })
  return new Promise(resolve => requestAnimationFrame(a => {
    const first = read(a)
    requestAnimationFrame(b => resolve({ first, second: read(b) }))
  }))
}

function assertSidebarFrames(frames) {
  for (const frame of [frames.first, frames.second]) {
    assert(frame.focus && !frame.hidden)
    assert.equal(frame.finiteAnimations, 0)
    assert(frame.sidebar.width > 0 && frame.sidebar.height > 0)
    assert(frame.items.length > 0)
    assert.equal(new Set(frame.items.map(item => item.nav)).size, frame.items.length)
    assert(frame.items.every(item => item.animations === 0))
  }
  assert(frames.second.timestamp > frames.first.timestamp)
  assert(frames.second.observedAt >= frames.first.observedAt)
  assert.equal(frames.first.timeOrigin, frames.second.timeOrigin)
  assert.equal(frames.first.url, frames.second.url)
  assert.equal(frames.first.scroll, frames.second.scroll)
  assert.deepEqual(frames.first.sidebar, frames.second.sidebar)
  assert.deepEqual(frames.first.items, frames.second.items)
}

async function observeSidebar(h, { binding, directory, label }) {
  assert.equal(process.platform, 'win32')
  assert(/^[a-zA-Z0-9_-]+$/.test(label), 'Capture label cannot contain a path')
  assert(fs.statSync(directory).isDirectory())
  const frames = await h.evaluate(`(${readSidebarFrames.toString()})()`)
  assertSidebarFrames(frames)
  const koffiPath = path.resolve(__dirname, '../node_modules/koffi')
  const args = [binding, frames.second.sidebar, directory, label, koffiPath]
  const native = await h.main(`(${captureOwned.toString()})(${args.map(value => JSON.stringify(value)).join(',')})`)
  const receipt = {
    complete: true,
    label,
    frames,
    native,
    classification: 'Original CSS and history; read-only stable DOM, actual foreground HWND/PID and physical client crop. No injected CSS, additional resize or emulated focus. Pixel appearance requires independent visual review.',
  }
  fs.writeFileSync(path.join(directory, label + '-native-receipt.json'), JSON.stringify(receipt, null, 2), { flag: 'wx' })
  return receipt
}

module.exports = { observeSidebar, readSidebarFrames, assertSidebarFrames }
