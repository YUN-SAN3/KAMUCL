// QA-only platform graphics and Chromium editing commands. No product policy changes.
const assert = require('node:assert/strict')

// Timer callbacks can wake before their requested delay. Qualify the real
// elapsed interval with both a monotonic clock and the journal's wall clock;
// early wake-ups schedule another actual wait instead of changing timestamps.
async function waitForMinimumDuration(durationMs, { wallNow = Date.now, monotonicNow = () => performance.now(), sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), wallStartedAt = wallNow() } = {}) {
  assert(Number.isFinite(durationMs) && durationMs >= 0)
  assert(Number.isFinite(wallStartedAt))
  const monotonicStartedAt = monotonicNow(); assert(Number.isFinite(monotonicStartedAt))
  const waits = []
  for (;;) {
    const wallCompletedAt = wallNow(), monotonicCompletedAt = monotonicNow()
    assert(Number.isFinite(wallCompletedAt) && Number.isFinite(monotonicCompletedAt))
    const wallElapsedMs = wallCompletedAt - wallStartedAt, monotonicElapsedMs = monotonicCompletedAt - monotonicStartedAt
    if (wallElapsedMs >= durationMs && monotonicElapsedMs >= durationMs) return { requestedMs: durationMs, wallStartedAt, wallCompletedAt, wallElapsedMs, monotonicStartedAt, monotonicCompletedAt, monotonicElapsedMs, waits }
    const requestedMs = Math.max(1, Math.ceil(durationMs - Math.min(wallElapsedMs, monotonicElapsedMs)))
    waits.push(requestedMs); await sleep(requestedMs)
  }
}

function graphicsPolicy(platform = process.platform) {
  return platform === 'darwin'
    ? { platform, backend: 'platform-default', hardwareAcceleration: 'default', angle: 'default' }
    : { platform, backend: 'software-swiftshader', hardwareAcceleration: 'disabled', angle: 'swiftshader' }
}

function configureGraphics(app, platform = process.platform) {
  const policy = graphicsPolicy(platform)
  app.commandLine.appendSwitch('force-device-scale-factor', '1')
  // The ARM64 Mac runner cannot initialize the forced Vulkan SwiftShader backend.
  // Exercise its default supported driver instead; WebGL/errors remain strict gates.
  if (policy.backend === 'software-swiftshader') {
    app.disableHardwareAcceleration()
    app.commandLine.appendSwitch('enable-unsafe-swiftshader')
    app.commandLine.appendSwitch('use-angle', 'swiftshader')
  }
  return policy
}

async function observeGraphics(app, webContents, policy) {
  const observation = {
    policy, featureStatus: app.getGPUFeatureStatus(), info: await app.getGPUInfo('basic'),
    webgl: await webContents.executeJavaScript(`(()=>{
      const canvas=document.createElement('canvas'),gl=canvas.getContext('webgl2')||canvas.getContext('webgl');
      if(!gl)return{created:false};
      const extension=gl.getExtension('WEBGL_debug_renderer_info');
      const result={created:true,version:gl.getParameter(gl.VERSION),vendor:gl.getParameter(extension?extension.UNMASKED_VENDOR_WEBGL:gl.VENDOR),renderer:gl.getParameter(extension?extension.UNMASKED_RENDERER_WEBGL:gl.RENDERER)};
      gl.getExtension('WEBGL_lose_context')?.loseContext();return result;
    })()`)
  }
  return observation
}

function validateGraphics(observation, platform = process.platform) {
  assert.deepEqual(observation.policy, graphicsPolicy(platform), 'Use the recorded supported platform driver policy')
  assert(observation.featureStatus && Object.keys(observation.featureStatus).length > 0, 'Retain actual GPU feature status')
  assert(observation.info && Object.keys(observation.info).length > 0, 'Retain actual GPU information')
  assert.equal(observation.webgl?.created, true, 'The fixture must create a real WebGL context; no renderer error is filtered')
  assert.equal(typeof observation.webgl.renderer, 'string')
}

async function selectAllInput(webContents, platform = process.platform) {
  if (platform === 'darwin') {
    if (!webContents.debugger.isAttached()) webContents.debugger.attach('1.3')
    // Chromium on macOS needs its editing command alongside Cmd+A. This is a
    // renderer key/edit command, not a claim of an offscreen OS physical shortcut.
    for (const type of ['keyDown', 'keyUp']) await webContents.debugger.sendCommand('Input.dispatchKeyEvent', {
      type, key: 'a', code: 'KeyA', modifiers: 4, windowsVirtualKeyCode: 65,
      ...(type === 'keyDown' ? { commands: ['selectAll'] } : {})
    })
  } else {
    for (const type of ['keyDown', 'keyUp']) webContents.sendInputEvent({ type, keyCode: 'A', modifiers: ['control'] })
  }
}

async function backspaceInput(webContents, platform = process.platform) {
  if (platform === 'darwin') {
    if (!webContents.debugger.isAttached()) webContents.debugger.attach('1.3')
    for (const type of ['keyDown', 'keyUp']) await webContents.debugger.sendCommand('Input.dispatchKeyEvent', { type, key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 })
  } else {
    for (const type of ['keyDown', 'keyUp']) webContents.sendInputEvent({ type, keyCode: 'Backspace' })
  }
}

function validateSelection(selection) {
  assert.equal(selection.focused, true, 'Replacement requires the actual focused input')
  assert.equal(typeof selection.value, 'string')
  assert.equal(selection.start, 0, 'Select from the beginning')
  assert.equal(selection.end, selection.value.length, 'Select the entire previous value')
}

function validateQueueControls(controls) {
  assert(controls.length >= 4, 'Observe the heading and every actual confirmation/cancel/clear control')
  for (const value of controls) {
    assert(value.inViewport === true && value.correct === true, 'Every scrolled queue action must be visible and hit its intended control')
  }
}

const UPDATE_SOURCES = ['auto', 'direct', 'mirror']
const SOURCE_KEYS = {
  ArrowDown: { code: 'ArrowDown', windowsVirtualKeyCode: 40, native: 'Down' },
  ArrowUp: { code: 'ArrowUp', windowsVirtualKeyCode: 38, native: 'Up' },
  Home: { code: 'Home', windowsVirtualKeyCode: 36, native: 'Home' },
  End: { code: 'End', windowsVirtualKeyCode: 35, native: 'End' },
  Enter: { code: 'Enter', windowsVirtualKeyCode: 13, native: 'Enter' }
}

function sourceSelectionKeys(previous, target) {
  assert(UPDATE_SOURCES.includes(previous) && UPDATE_SOURCES.includes(target))
  assert.notEqual(previous, target, 'The native select must change its option')
  // Use one target jump, so a collapsed select cannot save an intermediate value.
  return [target === 'auto' ? 'Home' : target === 'mirror' ? 'End' : previous === 'auto' ? 'ArrowDown' : 'ArrowUp', 'Enter']
}

function sourceTypeAheadCharacter(previous, target, options) {
  assert.notEqual(previous, target)
  assert.deepEqual(options.map(option => option.value), UPDATE_SOURCES)
  assert(options.every(option => typeof option.label === 'string' && option.label.trim() && !option.disabled))
  const char = Array.from(options.find(option => option.value === target).label.trim())[0]
  const index = options.findIndex(option => option.value === previous)
  assert(index >= 0)
  const ordered = [...options.slice(index + 1), ...options.slice(0, index + 1)]
  assert.equal(ordered.find(option => option.label.trim().startsWith(char))?.value, target, 'The real single printable key must choose the target without an intermediate settings request')
  return char
}

async function dispatchSourceKey(webContents, event, records) {
  if (!webContents.debugger.isAttached()) webContents.debugger.attach('1.3')
  const record = { transport: 'Chromium CDP keyboard', ...event, startedAt: Date.now(), dispatchCompleted: false }
  await webContents.debugger.sendCommand('Input.dispatchKeyEvent', event)
  record.completedAt = Date.now(); record.dispatchCompleted = true; records.push(record)
  await new Promise(resolve => setTimeout(resolve, 35))
}

async function resetSourcePicker(webContents, observe, setup = {}) {
  Object.assign(setup, { classification: 'Chromium Escape plus DOM blur/focus setup only; actual selection remains a trusted printable key event', dispatches: [], before: await observe() })
  for (const type of ['keyDown', 'keyUp']) await dispatchSourceKey(webContents, { type, key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }, setup.dispatches)
  setup.afterEscape = await observe()
  // Blur closes the external picker and resets the browser's type-ahead session.
  // No option value, settings state or synthetic DOM event is assigned here.
  await webContents.executeJavaScript("document.querySelector('#update-source').blur()")
  setup.afterBlur = await observe()
  assert.notEqual(setup.afterBlur.focus.id, 'update-source')
  assert.equal(setup.afterBlur.popupOpen, false, 'Blur must really close the native picker')
  await webContents.executeJavaScript("document.querySelector('#update-source').focus({preventScroll:true})")
  setup.beforeJump = await observe()
  assert.equal(setup.beforeJump.popupOpen, false)
  assert.equal(setup.beforeJump.focus.id, 'update-source')
  assert.equal(setup.beforeJump.focus.hasFocus, true)
  assert.equal(setup.beforeJump.selected, setup.before.selected)
  return setup
}

async function selectSourceInput(webContents, previous, target, platform = process.platform, context) {
  if (platform === 'darwin') {
    const char = sourceTypeAheadCharacter(previous, target, context.options), base = { key: char, code: 'Unidentified', windowsVirtualKeyCode: 0 }
    // This Unicode text key belongs to Chromium, not a physical macOS keyboard.
    await dispatchSourceKey(webContents, { type: 'keyDown', ...base }, context.dispatches)
    await dispatchSourceKey(webContents, { type: 'char', ...base, text: char, unmodifiedText: char }, context.dispatches)
    await context.beforeEnter()
    await dispatchSourceKey(webContents, { type: 'keyUp', ...base }, context.dispatches)
    for (const type of ['keyDown', 'keyUp']) await dispatchSourceKey(webContents, { type, key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 }, context.dispatches)
    return context.dispatches
  }
  const dispatches = []
  for (const key of sourceSelectionKeys(previous, target)) for (const type of ['keyDown', 'keyUp']) {
    const { code, windowsVirtualKeyCode, native } = SOURCE_KEYS[key]
    const record = { transport: platform === 'darwin' ? 'Chromium CDP keyboard' : 'Electron sendInputEvent', type, key, code, windowsVirtualKeyCode, dispatchCompleted: false }
    if (platform === 'darwin') await webContents.debugger.sendCommand('Input.dispatchKeyEvent', { type, key, code, windowsVirtualKeyCode })
    else webContents.sendInputEvent({ type, keyCode: native, modifiers: [] })
    // Command/call completion is distinct from an OS receiver acknowledgement.
    record.dispatchCompleted = true; dispatches.push(record)
    await new Promise(resolve => setTimeout(resolve, 35))
  }
  return dispatches
}

function validateSourceSelection(row) {
  if (row.platform === 'darwin') validateSourceTypeAhead(row)
  else {
  const keys = sourceSelectionKeys(row.previous, row.target)
  assert.equal(row.dispatches.length, keys.length * 2, 'Retain every actual option-navigation keyDown/keyUp and Enter dispatch')
  for (let i = 0; i < keys.length; i++) for (let j = 0; j < 2; j++) {
    const event = row.dispatches[i * 2 + j]
    assert.equal(event.key, keys[i]); assert.equal(event.type, j ? 'keyUp' : 'keyDown')
    assert.equal(event.code, SOURCE_KEYS[keys[i]].code); assert.equal(event.windowsVirtualKeyCode, SOURCE_KEYS[keys[i]].windowsVirtualKeyCode)
    assert.equal(event.dispatchCompleted, true)
    assert.equal(event.transport, row.platform === 'darwin' ? 'Chromium CDP keyboard' : 'Electron sendInputEvent')
  }
  }
  assert(row.events.some(event => event.type === 'change' && event.isTrusted === true && event.targetId === 'update-source' && event.value === row.target), 'Actual native select change must name the target value')
  assert.equal(row.invocations.length, 1, 'Actual updateSource settings:set must be invoked exactly once; idle alone is not evidence')
  const call = row.invocations[0]
  assert.equal(call.patch.updateSource, row.target)
  assert(Number.isFinite(call.startedAt) && Number.isFinite(call.completedAt) && call.completedAt >= call.startedAt, 'Retain the completed actual settings patch invocation')
  assert.equal(row.final.busy, false)
  if (row.expectedFailure) {
    assert.equal(call.outcome, 'rejected'); assert.equal(row.final.selected, row.previous); assert.equal(row.final.persisted, row.previous)
    assert.equal(typeof row.final.error, 'string', 'The rejected native selection must display its real error')
    assert(row.final.error.includes('Controlled updateSource save failure'))
    assert.equal(row.final.focus.id, 'update-source'); assert.equal(row.final.focus.inSources, true)
  } else {
    assert.equal(call.outcome, 'resolved'); assert.equal(row.final.selected, row.target); assert.equal(row.final.persisted, row.target)
  }
}

function validateSourceTypeAhead(row) {
  assert.equal(row.protocol, 'chromium-select-typeahead-v1')
  assert(Number.isFinite(row.startedAt) && Number.isFinite(row.completedAt) && row.completedAt >= row.startedAt)
  const char = sourceTypeAheadCharacter(row.previous, row.target, row.options)
  assert.equal(row.setup.dispatches.length, 2)
  for (const [index, type] of ['keyDown', 'keyUp'].entries()) {
    const event = row.setup.dispatches[index]
    assert.equal(event.type, type); assert.equal(event.key, 'Escape'); assert.equal(event.code, 'Escape'); assert.equal(event.windowsVirtualKeyCode, 27)
    assert.equal(event.dispatchCompleted, true); assert.equal(event.transport, 'Chromium CDP keyboard')
  }
  for (const phase of ['before', 'afterEscape', 'afterBlur', 'beforeJump']) {
    const observation = row.setup[phase]
    assert.equal(observation.selected, row.previous); assert.equal(observation.persisted, row.previous)
    assert.equal(observation.sourceCalls.length, 0, 'Picker setup must not consume the failure or save an intermediate option')
  }
  assert.notEqual(row.setup.afterBlur.focus.id, 'update-source'); assert.equal(row.setup.afterBlur.popupOpen, false)
  assert.equal(row.setup.beforeJump.popupOpen, false); assert.equal(row.setup.beforeJump.focus.id, 'update-source')
  assert.equal(row.setup.beforeJump.focus.hasFocus, true); assert.equal(row.setup.beforeJump.selected, row.previous)
  const fresh = event => event.isTrusted === true && Number.isFinite(event.at) && event.at >= row.startedAt && event.at <= row.completedAt
  const blurIndex = row.focusEvents.findIndex(event => event.type === 'blur' && event.targetId === 'update-source' && fresh(event))
  assert(blurIndex >= 0 && row.focusEvents.slice(blurIndex + 1).some(event => event.type === 'focus' && event.targetId === 'update-source' && fresh(event)), 'Retain this row actual UA blur then focus reset')
  const expected = [['keyDown', char], ['char', char], ['keyUp', char], ['keyDown', 'Enter'], ['keyUp', 'Enter']]
  assert.equal(row.dispatches.length, expected.length)
  expected.forEach(([type, key], index) => {
    const event = row.dispatches[index]
    assert.equal(event.type, type); assert.equal(event.key, key); assert.equal(event.dispatchCompleted, true)
    assert.equal(event.transport, 'Chromium CDP keyboard'); assert.equal(event.code, index < 3 ? 'Unidentified' : 'Enter'); assert.equal(event.windowsVirtualKeyCode, index < 3 ? 0 : 13)
    assert(Number.isFinite(event.startedAt) && Number.isFinite(event.completedAt) && event.completedAt >= event.startedAt && event.startedAt >= row.startedAt && event.completedAt <= row.completedAt)
    if (type === 'char') { assert.equal(event.text, char); assert.equal(event.unmodifiedText, char) }
  })
  for (const [type, key] of [['keypress', char], ['keyup', char], ['keydown', 'Enter'], ['keyup', 'Enter']]) assert(row.keyEvents.some(event => event.type === type && event.key === key && event.targetId === 'update-source' && fresh(event)), 'Retain actual trusted Chromium select received key: ' + type + '/' + key)
  assert.equal(row.observations.beforeEnter.busy, false)
  assert.equal(row.observations.beforeEnter.selected, row.expectedFailure ? row.previous : row.target)
  assert.equal(row.observations.beforeEnter.focus.id, 'update-source')
  assert.equal(row.observations.beforeEnter.popupOpen, false)
}

module.exports = { graphicsPolicy, configureGraphics, observeGraphics, validateGraphics, selectAllInput, backspaceInput, validateSelection, validateQueueControls, sourceSelectionKeys, selectSourceInput, validateSourceSelection, sourceTypeAheadCharacter, resetSourcePicker, validateSourceTypeAhead, waitForMinimumDuration }
