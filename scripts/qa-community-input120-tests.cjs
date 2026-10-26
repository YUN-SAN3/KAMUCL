const test = require('node:test'), assert = require('node:assert/strict'), vm = require('node:vm')
const { replaceCommunityText, installCommunityInputObserver, readCommunityInputObserver } = require('./qa-community120.cjs')
function fixture(options = {}) {
  const selector = '[data-ui="community:custom-version"] input', binding = { pid: 120, profile: '/private/qa/profile', executable: '/private/qa/KAMUCL.app/Contents/MacOS/KAMUCL', windowId: 12, webContentsId: 13, timeOrigin: 1000, url: 'file:///private/qa/renderer/index.html' }
  let editing = false, text = options.value ?? '24w14potato', serial = 0
  const input = { selectionStart: text.length, selectionEnd: text.length }
  Object.defineProperty(input, 'value', { get: () => text, set(value) { assert(editing, 'The real helper must never assign DOM values'); text = value } })
  const listeners = new Map(), document = { activeElement: input, hidden: false, readyState: 'complete', hasFocus: () => true, querySelector: key => key === selector ? input : null, addEventListener(type, fn, capture) { assert.equal(capture, true); (listeners.get(type) ?? listeners.set(type, new Set()).get(type)).add(fn) }, removeEventListener(type, fn, capture) { assert.equal(capture, true); listeners.get(type)?.delete(fn) } }
  const context = vm.createContext({ document, performance: { timeOrigin: binding.timeOrigin }, location: { href: binding.url }, Date })
  const records = [], calls = [], actions = []
  function emit(type, params = {}) { for (const fn of listeners.get(type) ?? []) fn({ type, target: input, isTrusted: true, timeStamp: ++serial, ...params }) }
  const h = {
    async main() { return { ...binding, ...options.owner } },
    async foreground() { actions.push('foreground'); await options.foreground?.({ context, document, input, actions }) },
    async click(key) { assert.equal(key, selector); actions.push('trusted coordinate'); document.activeElement = input },
    async evaluate(expression) { const value = vm.runInContext(expression, context); return value === undefined ? value : JSON.parse(JSON.stringify(value)) },
    async call(method, params) {
      calls.push({ method, params }); actions.push(method)
      if (method === 'Input.dispatchKeyEvent') {
        emit(params.type === 'keyDown' ? 'keydown' : 'keyup', { key: params.key, code: params.code, metaKey: params.modifiers === 4, ctrlKey: params.modifiers === 2 })
        if (params.type === 'keyDown' && (params.commands?.includes('selectAll') || params.modifiers === 2)) { input.selectionStart = 0; input.selectionEnd = options.partialSelection ? 2 : text.length }
      } else if (method === 'Input.insertText') {
        emit('beforeinput', { inputType: 'insertText', data: params.text })
        editing = true; input.value = text.slice(0, input.selectionStart) + params.text + text.slice(input.selectionEnd); editing = false
        input.selectionStart = input.selectionEnd = text.length
        emit('input', { inputType: 'insertText', data: params.text })
      } else assert.fail('Unexpected input dispatch')
      await options.afterCall?.({ method, params, context, document, input, calls })
    }
  }
  return { h, binding, selector, context, input, document, listeners, records, calls, actions, run: () => replaceCommunityText(h, binding, selector, '1.21.1', { platform: options.platform ?? 'darwin', record: row => records.push(JSON.parse(JSON.stringify(row))) }) }
}
test('Mac community replacement executes selectAll then proves the actual full selection and exact replacement', async () => {
  const f = fixture(), row = await f.run()
  assert.equal(f.input.value, '1.21.1'); assert.equal(row.complete, true)
  assert.deepEqual(f.calls[0].params.commands, ['selectAll']); assert.equal(f.calls[0].params.modifiers, 4); assert.equal(f.calls[1].params.commands, undefined)
  assert.equal(row.result.selection.focused, true); assert.equal(row.result.selection.start, 0); assert.equal(row.result.selection.end, '24w14potato'.length)
  const events = row.receiver.events
  assert.deepEqual(events.map(e => e.type), ['keydown', 'keyup', 'beforeinput', 'input']); assert(events.every(e => e.isTrusted === true && e.state.focused && e.state.timeOrigin === f.binding.timeOrigin && e.state.url === f.binding.url))
  assert.equal(events[0].state.value, '24w14potato'); assert.equal(events.at(-1).state.value, '1.21.1'); assert.equal(events[1].state.start, 0); assert.equal(events[1].state.end, '24w14potato'.length)
  assert.equal(vm.runInContext('!!globalThis.__qaCommunityInput120', f.context), false); assert([...f.listeners.values()].every(set => set.size === 0))
  for (const call of row.commands) assert(call.before.state.focused && call.after.state.focused && call.finishedAt >= call.startedAt)
  assert.equal(f.actions.filter(a => a === 'foreground').length, 8)
})
test('Windows retains the original Ctrl+A editing semantics without a Mac editing command', async () => {
  const f = fixture({ platform: 'win32' }), row = await f.run()
  assert.equal(row.complete, true); assert.equal(f.input.value, '1.21.1')
  assert(f.calls.slice(0, 2).every(c => c.params.modifiers === 2 && c.params.commands === undefined)); assert.equal(row.receiver.events[0].ctrlKey, true)
})
test('an incomplete real selection rejects before inserting and preserves the original nonempty input', async () => {
  const f = fixture({ partialSelection: true })
  await assert.rejects(f.run(), /select the entire previous value/)
  assert.equal(f.input.value, '24w14potato'); assert.equal(f.calls.length, 2); assert.equal(f.records.at(-1).complete, false)
  assert.equal(f.records.at(-1).receiver.events.length, 2); assert([...f.listeners.values()].every(set => set.size === 0))
})
test('a changed document origin or URL cannot receive a later command or insertion', async () => {
  for (const field of ['timeOrigin', 'url']) {
    const f = fixture({ afterCall({ context }) { if (field === 'timeOrigin') context.performance.timeOrigin++; else context.location.href = 'file:///foreign/index.html' } })
    await assert.rejects(f.run(), /bound document changed/); assert.equal(f.calls.length, 1); assert.equal(f.input.value, '24w14potato')
    assert.equal(f.records.at(-1).receiver.events.length, 1)
  }
})
test('lost active input, focus, hidden document or replaced target rejects before inserting', async () => {
  for (const field of ['active', 'focus', 'hidden', 'target']) {
    const f = fixture({ afterCall({ document }) { if (field === 'active') document.activeElement = null; else if (field === 'focus') document.hasFocus = () => false; else if (field === 'hidden') document.hidden = true; else document.querySelector = () => ({}) } })
    await assert.rejects(f.run(), /focus\/identity|strictly equal/); assert.equal(f.calls.length, 1); assert.equal(f.input.value, '24w14potato')
  }
})
test('changed owner PID, profile, executable, window, renderer or URL rejects before any input', async () => {
  const original = fixture().binding
  for (const key of ['pid', 'profile', 'executable', 'windowId', 'webContentsId', 'url']) {
    const f = fixture({ owner: { [key]: typeof original[key] === 'number' ? original[key] + 1 : original[key] + '/foreign' } })
    await assert.rejects(f.run(), /changed owned process\/window/); assert.equal(f.calls.length, 0); assert.equal(f.actions.length, 0); assert.equal(f.input.value, '24w14potato')
  }
})
test('original foreground rejection stops the command and retains its actual failure without fabricating a receiver', async () => {
  let count = 0; const original = Error('Foreign frontmost PID 3945'), f = fixture({ foreground() { if (++count === 3) throw original } })
  await assert.rejects(f.run(), error => error === original); assert.equal(f.calls.length, 0); assert.equal(f.records.at(-1).receiver.events.length, 0); assert.equal(f.input.value, '24w14potato')
})
test('read-only observer rejects duplicate identity and retains unaltered event trust/selection data', () => {
  const f = fixture(), config = { token: 'actual-contract', selector: f.selector, timeOrigin: f.binding.timeOrigin, url: f.binding.url }
  vm.runInContext(`(${installCommunityInputObserver})(${JSON.stringify(config)})`, f.context)
  assert.throws(() => vm.runInContext(`(${installCommunityInputObserver})(${JSON.stringify(config)})`, f.context), /observer already/)
  for (const fn of f.listeners.get('keydown')) fn({ type: 'keydown', target: f.input, isTrusted: false, key: 'a', code: 'KeyA', metaKey: true, timeStamp: 123 })
  const receipt = vm.runInContext(`(${readCommunityInputObserver})('actual-contract',true)`, f.context)
  assert.equal(receipt.events[0].isTrusted, false); assert.equal(receipt.events[0].eventTimeStamp, 123); assert.equal(receipt.events[0].state.start, '24w14potato'.length); assert.equal(f.input.value, '24w14potato')
  assert.throws(() => vm.runInContext(`(${readCommunityInputObserver})('foreign')`, f.context), /observer identity/)
})
