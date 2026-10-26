const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { configureGraphics, graphicsPolicy, validateGraphics, selectAllInput, backspaceInput, validateSelection, validateQueueControls, sourceSelectionKeys, selectSourceInput, validateSourceSelection, sourceTypeAheadCharacter, resetSourcePicker, validateSourceTypeAhead, waitForMinimumDuration } = require('./qa-fixture-ui121.cjs')

async function observedDelay(wakes) {
  let wall = 1000, monotonic = 200; const requested = []
  const observation = await waitForMinimumDuration(150, { wallStartedAt: wall, wallNow: () => wall, monotonicNow: () => monotonic, sleep: async ms => { requested.push(ms); assert(wakes.length, 'An early timer must request another actual wait'); const next = wakes.shift(); wall += next.wall; monotonic += next.monotonic } })
  assert.equal(observation.wallCompletedAt, wall); assert.equal(observation.monotonicCompletedAt, monotonic)
  assert(observation.wallElapsedMs >= 150 && observation.monotonicElapsedMs >= 150)
  assert.deepEqual(observation.waits, requested); assert.equal(wakes.length, 0)
  return observation
}

test('150ms failure injection retries an actual early149 timer instead of fabricating completion', async () => {
  const observed = await observedDelay([{ wall: 149, monotonic: 149 }, { wall: 1, monotonic: 1 }])
  assert.deepEqual(observed.waits, [150, 1]); assert.equal(observed.wallElapsedMs, 150); assert.equal(observed.monotonicElapsedMs, 150)
})

test('multiple early failure timers retain the minimum actual asynchronous interval', async () => {
  const observed = await observedDelay([{ wall: 149, monotonic: 149 }, { wall: 0, monotonic: 0 }, { wall: 0, monotonic: 0 }, { wall: 1, monotonic: 1 }])
  assert.deepEqual(observed.waits, [150, 1, 1, 1])
})

test('normal150 timer completes once with real unchanged clock samples', async () => {
  const observed = await observedDelay([{ wall: 150, monotonic: 150 }]); assert.deepEqual(observed.waits, [150])
})

test('failure delay requires both monotonic and actual journal clocks', async () => {
  assert.deepEqual((await observedDelay([{ wall: 149, monotonic: 150 }, { wall: 1, monotonic: 1 }])).waits, [150, 1])
  assert.deepEqual((await observedDelay([{ wall: 200, monotonic: 149 }, { wall: 1, monotonic: 1 }])).waits, [150, 1])
})

test('all controlled settings and draft failures use the shared actual minimum wait', () => {
  const source = fs.readFileSync(path.join(__dirname, 'verify-appearance-121-ui.cjs'), 'utf8')
  assert(source.includes('waitForMinimumDuration(proof.configuration.controlledFailureDelayMs,{wallStartedAt:invocation.startedAt})'))
  assert(source.includes('invocation.controlledDelay=observation;invocation.completedAt=Date.now()'))
  assert(source.includes('waitForMinimumDuration(proof.configuration.controlledFailureDelayMs).then(observation=>{proof.failedDraftApplyDelay=observation'))
  assert(!source.includes('new Promise((_resolve,reject)=>setTimeout'))
})

test('Darwin fixture preserves its supported default ANGLE and hardware driver', () => {
  const switches = [], disabled = []
  const app = { commandLine: { appendSwitch: (...args) => switches.push(args) }, disableHardwareAcceleration: () => disabled.push(true) }
  assert.deepEqual(configureGraphics(app, 'darwin'), graphicsPolicy('darwin'))
  assert.deepEqual(switches, [['force-device-scale-factor', '1']])
  assert.deepEqual(disabled, [])
  switches.length = 0
  configureGraphics(app, 'win32')
  assert.deepEqual(disabled, [true])
  assert.deepEqual(switches, [['force-device-scale-factor', '1'], ['enable-unsafe-swiftshader'], ['use-angle', 'swiftshader']])
})

test('GPU qualification rejects missing context, foreign policy or missing actual status', () => {
  const proof = { policy: graphicsPolicy('darwin'), featureStatus: { webgl: 'enabled' }, info: { gpuDevice: [] }, webgl: { created: true, renderer: 'Contract sample' } }
  assert.doesNotThrow(() => validateGraphics(proof, 'darwin'))
  for (const change of [{ webgl: { created: false } }, { policy: graphicsPolicy('win32') }, { featureStatus: {} }, { info: {} }]) assert.throws(() => validateGraphics({ ...proof, ...change }, 'darwin'))
})

test('Mac Cmd+A routes the Chromium editing command without assigning input values', async () => {
  const events = [], attachments = []
  await selectAllInput({ debugger: { isAttached: () => false, attach: version => attachments.push(version), sendCommand: async (...event) => events.push(event) } }, 'darwin')
  assert.deepEqual(attachments, ['1.3'])
  assert.deepEqual(events, [
    ['Input.dispatchKeyEvent', { type: 'keyDown', key: 'a', code: 'KeyA', modifiers: 4, windowsVirtualKeyCode: 65, commands: ['selectAll'] }],
    ['Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', modifiers: 4, windowsVirtualKeyCode: 65 }]
  ])
  const windows = []
  await selectAllInput({ sendInputEvent: event => windows.push(event) }, 'win32')
  assert.deepEqual(windows, [{ type: 'keyDown', keyCode: 'A', modifiers: ['control'] }, { type: 'keyUp', keyCode: 'A', modifiers: ['control'] }])
  const deletion = []
  await backspaceInput({ debugger: { isAttached: () => true, sendCommand: async (...event) => deletion.push(event) } }, 'darwin')
  assert.deepEqual(deletion, [['Input.dispatchKeyEvent', { type: 'keyDown', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 }], ['Input.dispatchKeyEvent', { type: 'keyUp', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 }]])
})

test('replacement rejects unfocused and partially selected old input text', () => {
  const selected = { focused: true, value: 'https://old.example/', start: 0, end: 20 }
  assert.doesNotThrow(() => validateSelection(selected))
  for (const patch of [{ focused: false }, { start: 1 }, { end: 19 }, { value: undefined }]) assert.throws(() => validateSelection({ ...selected, ...patch }))
  assert.doesNotThrow(() => validateSelection({ focused: true, value: '', start: 0, end: 0 }))
})

test('scrollable queue qualification rejects obscured, clipped or omitted action controls', () => {
  const controls = Array.from({ length: 4 }, () => ({ inViewport: true, correct: true }))
  assert.doesNotThrow(() => validateQueueControls(controls))
  assert.throws(() => validateQueueControls(controls.slice(1)), /every actual/)
  for (const patch of [{ inViewport: false }, { correct: false }]) assert.throws(() => validateQueueControls([{ ...controls[0], ...patch }, ...controls.slice(1)]), /visible and hit/)
})

test('fixture drivers preserve exact old customization, errors and real keyboard observations', () => {
  const read = name => fs.readFileSync(path.join(__dirname, name), 'utf8')
  const appearance = read('verify-appearance-121-ui.cjs'), community = read('verify-community121-ui.cjs')
  assert(appearance.includes('assert.equal(proof.oldThemeKey,oldThemeTitleKey)'))
  assert(appearance.includes('await ready("getComputedStyle'))
  assert(appearance.includes("assert.equal(await run(\"getComputedStyle(document.querySelector('[data-section=\\\"theme\\\"] h3')).color\"),'rgb(155, 62, 23)')"))
  assert(appearance.includes('validateSelection(selection)') && appearance.includes('value===\'\''))
  assert(appearance.includes('insertText(value)') && !appearance.includes('.value='+String.fromCharCode(96)))
  for (const source of [appearance, community]) {
    assert(source.includes('observeGraphics(app,win.webContents,graphics)'))
    assert(source.includes('validateGraphics(proof.graphics)'))
    assert(source.includes('assert.deepEqual('))
    assert(!source.includes('failures.filter') && !source.includes('errors.filter'))
  }
  assert(community.includes('validateQueueControls(controls)'))
  assert(community.includes("await geometry('.community-confirm')"))
  assert(community.includes('heading.headingTop>=heading.barBottom'))
})

test('Windows native source selection preserves one target jump with complete keyDown/keyUp and Enter', async () => {
  for (const [previous, target, expected] of [
    ['auto', 'direct', ['ArrowDown', 'Enter']], ['auto', 'mirror', ['End', 'Enter']],
    ['direct', 'auto', ['Home', 'Enter']], ['direct', 'mirror', ['End', 'Enter']],
    ['mirror', 'auto', ['Home', 'Enter']], ['mirror', 'direct', ['ArrowUp', 'Enter']]
  ]) assert.deepEqual(sourceSelectionKeys(previous, target), expected)
  assert.throws(() => sourceSelectionKeys('auto', 'auto')); assert.throws(() => sourceSelectionKeys('auto', 'foreign'))
  const calls = [], webContents = { sendInputEvent: event => calls.push(event) }
  const dispatches = await selectSourceInput(webContents, 'auto', 'direct', 'win32')
  assert.equal(dispatches.length, 4)
  assert.deepEqual(calls, [
    { type: 'keyDown', keyCode: 'Down', modifiers: [] }, { type: 'keyUp', keyCode: 'Down', modifiers: [] },
    { type: 'keyDown', keyCode: 'Enter', modifiers: [] }, { type: 'keyUp', keyCode: 'Enter', modifiers: [] }
  ])
  assert(dispatches.every(event => event.dispatchCompleted && event.transport === 'Electron sendInputEvent'))
})

const sourceOptions = [{ value: 'auto', label: '自动择优（直连与镜像）', disabled: false }, { value: 'direct', label: '仅 GitHub 直连', disabled: false }, { value: 'mirror', label: '仅镜像', disabled: false }]
const pickerState = (id, selected = 'auto', popupOpen = false) => ({ selected, persisted: selected, popupOpen, busy: false, sourceCalls: [], focus: { id, hasFocus: true } })
test('Mac printable selection derives the next actual label and refuses intermediate patches', () => {
  for (const [previous, target, char] of [['auto', 'direct', '仅'], ['direct', 'mirror', '仅'], ['mirror', 'auto', '自']]) assert.equal(sourceTypeAheadCharacter(previous, target, sourceOptions), char)
  assert.throws(() => sourceTypeAheadCharacter('auto', 'mirror', sourceOptions), /intermediate/)
  assert.throws(() => sourceTypeAheadCharacter('direct', 'direct', sourceOptions))
  assert.throws(() => sourceTypeAheadCharacter('direct', 'auto', sourceOptions.map(option => ({ ...option, label: '重复' }))), /intermediate/)
  assert.throws(() => sourceTypeAheadCharacter('auto', 'direct', sourceOptions.map(option => ({ ...option, disabled: true }))))
})

test('Mac closes and resets the actual popup session without values or artificial events', async () => {
  const calls = [], scripts = [], states = [pickerState('update-source', 'auto', true), pickerState('update-source', 'auto', true), pickerState(''), pickerState('update-source')]
  const webContents = { debugger: { isAttached: () => true, sendCommand: async (...args) => calls.push(args) }, executeJavaScript: async code => scripts.push(code) }
  const setup = await resetSourcePicker(webContents, async () => states.shift())
  assert.deepEqual(calls.map(([, event]) => [event.type, event.key]), [['keyDown', 'Escape'], ['keyUp', 'Escape']])
  assert(scripts.every(code => !code.includes('.value=') && !code.includes('dispatchEvent')))
  assert.equal(setup.beforeJump.focus.id, 'update-source')
  const failed = {}; await assert.rejects(resetSourcePicker(webContents, async () => pickerState('update-source', 'auto', true), failed))
  assert.equal(failed.afterBlur.popupOpen, true, 'Retain partial setup evidence when the real picker never closed')
})

test('Mac typeahead requires fresh trusted receiver events and exactly one completed transaction', async () => {
  const startedAt = Date.now(), calls = [], dispatches = [], webContents = { debugger: { isAttached: () => true, sendCommand: async (_method, event) => calls.push(event) } }
  await selectSourceInput(webContents, 'auto', 'direct', 'darwin', { options: sourceOptions, dispatches, beforeEnter: async () => { assert.equal(calls.length, 2); calls.push('actual complete transaction before key release') } })
  assert.deepEqual(calls.map(event => event.type || event), ['keyDown', 'char', 'actual complete transaction before key release', 'keyUp', 'keyDown', 'keyUp'])
  const completedAt = Date.now(), sampleEvent = (type, key, targetId = 'update-source') => ({ type, key, targetId, isTrusted: true, at: completedAt })
  const row = { protocol: 'chromium-select-typeahead-v1', platform: 'darwin', startedAt, completedAt, previous: 'auto', target: 'direct', options: sourceOptions, expectedFailure: true, dispatches,
    setup: { dispatches: ['keyDown', 'keyUp'].map(type => ({ type, key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, transport: 'Chromium CDP keyboard', dispatchCompleted: true })), before: pickerState('update-source'), afterEscape: pickerState('update-source'), afterBlur: pickerState(''), beforeJump: pickerState('update-source') },
    observations: { beforeEnter: pickerState('update-source') }, focusEvents: [sampleEvent('blur'), sampleEvent('focus')], keyEvents: [sampleEvent('keypress', '仅'), sampleEvent('keyup', '仅'), sampleEvent('keydown', 'Enter'), sampleEvent('keyup', 'Enter')],
    events: [{ ...sampleEvent('change'), value: 'direct' }], invocations: [{ patch: { updateSource: 'direct' }, startedAt, completedAt, outcome: 'rejected' }], final: { selected: 'auto', persisted: 'auto', busy: false, error: 'Controlled updateSource save failure', focus: { id: 'update-source', inSources: true } } }
  assert.doesNotThrow(() => validateSourceSelection(row))
  for (const patch of [{ protocol: undefined }, { keyEvents: [] }, { keyEvents: row.keyEvents.map(event => ({ ...event, targetId: 'other' })) }, { keyEvents: row.keyEvents.map(event => ({ ...event, at: startedAt - 1 })) }, { focusEvents: row.focusEvents.slice(1) }, { observations: { beforeEnter: pickerState('') } }, { setup: { ...row.setup, afterEscape: { ...pickerState('update-source'), sourceCalls: [{}] } } }, { setup: { ...row.setup, afterBlur: { ...pickerState(''), persisted: 'direct' } } }]) assert.throws(() => validateSourceTypeAhead({ ...row, ...patch }))
  for (const patch of [{ invocations: [] }, { invocations: [row.invocations[0], row.invocations[0]] }, { events: [{ ...row.events[0], isTrusted: false }] }, { final: { ...row.final, focus: { id: '', inSources: false } } }]) assert.throws(() => validateSourceSelection({ ...row, ...patch }))
})

test('native source qualification rejects idle-only, wrong or duplicate invocation, forged changes and lost rollback focus', async () => {
  const dispatches = await selectSourceInput({ sendInputEvent: () => {} }, 'auto', 'direct', 'win32')
  const call = { patch: { updateSource: 'direct' }, startedAt: 1, completedAt: 151, outcome: 'rejected' }
  const row = { platform: 'win32', previous: 'auto', target: 'direct', expectedFailure: true, dispatches, events: [{ type: 'change', isTrusted: true, targetId: 'update-source', value: 'direct' }], invocations: [call], final: { selected: 'auto', persisted: 'auto', busy: false, error: 'Controlled updateSource save failure', focus: { id: 'update-source', inSources: true } } }
  assert.doesNotThrow(() => validateSourceSelection(row))
  for (const patch of [
    { invocations: [] }, { invocations: [call, call] }, { invocations: [{ ...call, completedAt: undefined }] },
    { invocations: [{ ...call, patch: { updateSource: 'mirror' } }] },
    { events: [{ ...row.events[0], isTrusted: false }] }, { events: [{ ...row.events[0], targetId: 'other-control' }] },
    { events: [{ ...row.events[0], type: 'input' }] }, { events: [{ ...row.events[0], value: 'auto' }] },
    { dispatches: dispatches.slice(0, -1) }, { dispatches: dispatches.map(event => ({ ...event, dispatchCompleted: false })) },
    { final: { ...row.final, error: undefined } }, { final: { ...row.final, focus: { id: '', inSources: false } } },
    { final: { ...row.final, persisted: 'direct' } }, { final: { ...row.final, busy: true } }
  ]) assert.throws(() => validateSourceSelection({ ...row, ...patch }))
  const success = { ...row, expectedFailure: false, invocations: [{ ...call, outcome: 'resolved' }], final: { ...row.final, selected: 'direct', persisted: 'direct', error: undefined } }
  assert.doesNotThrow(() => validateSourceSelection(success))
  assert.throws(() => validateSourceSelection({ ...success, final: { ...success.final, selected: 'auto' } }))
})

test('source driver records true events and actual settings calls before testing rollback', () => {
  const source = fs.readFileSync(path.join(__dirname, 'verify-appearance-121-ui.cjs'), 'utf8')
  assert(source.includes("patch:structuredClone(args[0]),startedAt:Date.now()"))
  assert(source.includes("invocation.completedAt=Date.now();invocation.outcome='rejected'"))
  assert(source.includes('isTrusted:event.isTrusted,targetId:event.target.id,value:event.target.value'))
  assert(source.includes('settingsPatchInvocations.slice(baseline)'))
  assert(source.includes("assert.equal(row.invocations.length,1,'Native source selection must invoke exactly one actual updateSource settings:set:"))
  assert(source.indexOf('row.invocations.length,1') < source.indexOf('save();validateSourceSelection(row)'))
  assert(!source.includes("querySelector('#update-source').value="))
})
