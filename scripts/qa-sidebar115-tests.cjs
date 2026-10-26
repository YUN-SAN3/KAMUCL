// Measurement contract tests. These do not qualify native pixels or a product fix.
const test = require('node:test')
const assert = require('node:assert/strict')
const { assertSidebarFrames } = require('./qa-sidebar115.cjs')
function stable() {
  const frame = { timestamp: 100, observedAt: 100, timeOrigin: 25, url: 'file:///owned/index.html', focus: true, hidden: false, finiteAnimations: 0, sidebar: { x: 0, y: 0, width: 260, height: 620 }, scroll: 0, items: [{ nav: 'home', label: '首页', rect: { x: 0, y: 88, width: 220, height: 48 }, transform: 'none', animations: 0 }] }
  const second = structuredClone(frame)
  second.timestamp = second.observedAt = 116
  return { first: frame, second }
}
test('Sidebar measurement accepts original settled consecutive frames without inferring pixel quality', () => {
  assert.doesNotThrow(() => assertSidebarFrames(stable()))
})
test('Sidebar measurement rejects replayed or reversed RAF observations', () => {
  for (const value of [100, 90]) { const frames = stable(); frames.second.timestamp = value; assert.throws(() => assertSidebarFrames(frames)) }
  const frames = stable(); frames.second.observedAt = 90; assert.throws(() => assertSidebarFrames(frames))
})
test('Sidebar measurement rejects stale documents, changed scroll, geometry and labels', () => {
  for (const change of [f => f.timeOrigin++, f => { f.url = 'file:///foreign/index.html' }, f => f.scroll++, f => f.sidebar.width++, f => f.items[0].rect.y++, f => { f.items[0].label = '重复录像' }]) {
    const frames = stable(); change(frames.second); assert.throws(() => assertSidebarFrames(frames))
  }
})
test('Sidebar measurement rejects duplicate actual navigation nodes and an empty surface', () => {
  for (const change of [f => f.items.push(structuredClone(f.items[0])), f => { f.items = [] }, f => { f.sidebar.width = 0 }]) {
    const frames = stable(); change(frames.first); change(frames.second); assert.throws(() => assertSidebarFrames(frames))
  }
})
test('Sidebar measurement rejects actual blur, hidden documents and unfinished finite animations', () => {
  for (const change of [f => { f.focus = false }, f => { f.hidden = true }, f => f.finiteAnimations++, f => f.items[0].animations++]) {
    const frames = stable(); change(frames.second); assert.throws(() => assertSidebarFrames(frames))
  }
})
