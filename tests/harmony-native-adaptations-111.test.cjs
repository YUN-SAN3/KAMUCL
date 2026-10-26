// Fault-injected execution of the actual generated adapter methods. This is
// JavaScript sequencing coverage, not ArkTS compilation or HarmonyOS evidence.
const test = require('node:test'), assert = require('node:assert/strict')
const vm = require('node:vm'), ts = require('typescript')
const { adapt, transform, sourceHashes } = require('../scripts/harmony-native-adaptations.cjs')
const tick = () => new Promise(resolve => setImmediate(resolve))
function deferred() { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b }); return { promise, resolve, reject } }
function compile(source, name, globals = {}) {
  const javascript = ts.transpileModule(source.replaceAll('@LogMethod', ''), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
  }).outputText
  return vm.runInNewContext(javascript + `\n${name}`, { console: { error() {} }, ...globals })
}
function stage() {
  const global = { approved: false, browserReady: false, dispatcher: undefined, isTerminationApproved() { return this.approved },
    isBrowserReady() { return this.browserReady }, setCloseDispatcher(fn) { this.dispatcher = fn },
    markBrowserReady() { this.browserReady = true; this.dispatcher?.() } }, calls = []
  const source = transform('application/WebAbilityStage.ets', `class Stage {
    private nativeContext: any;
    private nativeThemeAdapter: NativeThemeAdapter | undefined;
    onPrepareTermination(): any { return 0; }
    onConfigurationUpdate() {}
    ready(context: any) { this.nativeContext = context;
        this.nativeThemeAdapter = Inject.get(NativeThemeAdapter);
    }
  }`)
  const Stage = compile(source, 'Stage', {
    GlobalThisHelper: global, AbilityConstant: { PrepareTermination: { CANCEL: 1, TERMINATE_IMMEDIATELY: 0 } },
    CommandType: { kAppQuit: 'quit' }, NativeThemeAdapter: class {}, Inject: { get() {} }
  })
  return { global, calls, instance: new Stage(), context: { ExecuteCommand: (command, options) => calls.push({ command, options }) } }
}
function permissions(options = {}) {
  let record = options.raw ?? JSON.stringify(options.uris || []), flushes = 0, persisted = [], activationCalls = 0
  const backups = new Map()
  const store = { getSync: () => record, putSync: (key, value) => { if (key === 'defaultDownloadUri') record = value; else backups.set(key, value) }, flush: callback => {
    flushes++; if (options.flush) options.flush(callback, flushes); else callback(undefined)
  } }
  const source = transform('adapter/PermissionManagerAdapter.ets', `class Manager {
    private ctxAdapter: any = {getContext: () => ({})};
    private isInitialized: boolean = false;
    @LogMethod
    public async initPermissions() {}
    @LogMethod
    public activateFileAccessPersist(uris: string[], callback: any) { activate(uris, callback); }
    @LogMethod
    public fileAccessPersist(uris: string[]) {}
    @LogMethod
    openPermissionConfirm() {}
  }`.replace(/^    /gm, '  '))
  const Manager = compile(source, 'Manager', {
    preferences: { getPreferencesSync: () => store }, options: {}, ACTIVATE_SUCCESS: 1, TAG: 'test',
    LogUtil: { error() {} }, activate(uris, callback) { activationCalls++; if (options.activate) options.activate(uris, callback); else callback(1) },
    fileShare: { OperationMode: { READ_MODE: 1, WRITE_MODE: 2 }, persistPermission: policies => {
      persisted.push(policies.map(p => p.uri)); return options.persist ? options.persist(policies, persisted.length) : Promise.resolve()
    } }
  })
  return { instance: new Manager(), record: () => JSON.parse(record), raw: () => record, backups, flushes: () => flushes, persisted, activationCalls: () => activationCalls }
}
function picker(manager, result) {
  const source = transform('adapter/FilePickerAdapter.ets', `class Picker {
    private permissionManagerAdapter: any;
    constructor(manager: any) { this.permissionManagerAdapter = manager; }
    private dirFilter(uris: string[]) { return uris.map(uri => uri.replace('file://docs', '')); }
    @LogMethod
    showDirDocumentViewPicker(flag: boolean, callback: any) {}
    @LogMethod
    showSaveAsDocumentViewPicker() {}
  }`.replace(/^    /gm, '  '))
  const Picker = compile(source, 'Picker', {
    picker: { DocumentSelectOptions: class {}, DocumentSelectMode: { FOLDER: 1 }, DocumentViewPicker: class { select() { return result } } },
    TAG: 'test', LogUtil: { error() {} }
  })
  return new Picker(manager)
}
function nativeDialog(manager, selection) {
  const source = transform('adapter/DialogAdapter.ets', `import { BaseAdapter } from '../common/BaseAdapter';
class Dialog {
  showOpenDialog(settings: string, callback: any) {
    const dialogSettings = JSON.parse(settings);
    const DocumentSelectOptions = {};
    const documentPicker = new picker.DocumentViewPicker();
    documentPicker.select(DocumentSelectOptions).then(() => {});
  }

  @LogMethod
  showSaveDialog() {}
}`)
  const Dialog = compile(source.replace(/^import .*;$/gm, ''), 'Dialog', {
    Inject: { get: () => manager }, PermissionManagerAdapter: class {}, TAG: 'test', LogUtil: { error() {} },
    fileUri: { FileUri: class { constructor(uri) { this.path = uri.replace('file://docs', '') } } },
    fs: { statSync: file => ({ isDirectory: () => !file.endsWith('.jar') }) },
    picker: { DocumentViewPicker: class { select() { return selection } } }
  })
  return new Dialog()
}
function nativeWindow(manager) {
  let launches = 0, dialog
  const source = transform('components/WebWindow.ets', `import Inject from '../common/InjectModule';
class Window {
  private config: any = {nativeContext: {runBrowser() { launched(); }}};
  run() { const vec_args = ['native'];
        this.config.nativeContext.runBrowser(vec_args);
        if (this.config.uri)
          this.config.nativeContext.ExecuteCommand(CommandType.kNewWindow, { url: this.config.uri, is_sync: true });
  }
  private setDefaultBounds() {}
}`)
  const Window = compile(source.replace(/^import .*;$/gm, ''), 'Window', {
    Inject: { get: () => manager }, PermissionManagerAdapter: class {}, TAG: 'test', LogUtil: { error() {} }, CommandType: {},
    launched: () => { launches++ }, AlertDialog: { show: value => { dialog = value } }
  })
  return { instance: new Window(), launches: () => launches, dialog: () => dialog }
}

test('unreviewed template bytes cannot be patched or reported prepared', () => {
  for (const file of Object.keys(sourceHashes)) assert.throws(() => adapt(file, Buffer.from('changed upstream')), /Unreviewed/)
  assert.throws(() => adapt('../other.ets', Buffer.from('anything')), /Unreviewed/)
})
test('system close retains an early intent, waits for real binding readiness and sends one Electron quit', () => {
  const f = stage()
  assert.equal(f.instance.onPrepareTermination(), 1)
  assert.equal(f.instance.onPrepareTermination(), 1)
  assert.equal(f.calls.length, 0)
  f.instance.ready(f.context)
  assert.equal(f.calls.length, 0, 'binding readiness alone must not dispatch to a missing Browser')
  assert.equal(f.instance.pendingTermination, true)
  f.global.markBrowserReady()
  assert.equal(f.calls.length, 1)
  assert.equal(f.calls[0].command, 'quit')
  assert.equal(f.calls[0].options.is_sync, false)
  assert.equal(f.instance.pendingTermination, false)
})
test('cancelled editor close permits a new request, while completed Electron quit permits native termination', () => {
  const f = stage(); f.instance.ready(f.context); f.global.markBrowserReady()
  assert.equal(f.instance.onPrepareTermination(), 1)
  // Electron cancels after Continue/Esc; no adapter has approved native quit.
  assert.equal(f.global.approved, false)
  assert.equal(f.instance.onPrepareTermination(), 1)
  assert.equal(f.calls.length, 2)
  f.global.approved = true
  assert.equal(f.instance.onPrepareTermination(), 0)
  assert.equal(f.calls.length, 2, 'confirmed native termination does not loop back into Electron quit')
})
test('a failed native dispatch keeps the intention for retry without terminating', () => {
  const f = stage(); f.instance.ready({ ExecuteCommand() { throw Error('native unavailable') } }); f.global.markBrowserReady()
  assert.equal(f.instance.onPrepareTermination(), 1)
  assert.equal(f.instance.pendingTermination, true)
  f.instance.ready(f.context)
  assert.equal(f.calls.length, 1)
  assert.equal(f.instance.pendingTermination, false)
})
test('directory callback waits for persistence and flushed merged records, preserving prior grants and Chinese paths', async () => {
  const grant = deferred(), flush = deferred(), callbacks = []
  const f = permissions({ uris: ['file://docs/old folder'], persist: () => grant.promise, flush: callback => { flush.promise.then(() => callback(undefined)) } })
  picker(f.instance, Promise.resolve(['file://docs/中文 § game'])).showDirDocumentViewPicker(false, value => callbacks.push(value))
  await tick(); assert.equal(callbacks.length, 0); assert.equal(f.flushes(), 0)
  grant.resolve(); await tick(); assert.equal(callbacks.length, 0); assert.equal(f.flushes(), 1)
  flush.resolve(); await tick()
  assert.deepEqual(callbacks, ['["/中文 § game"]'])
  assert.deepEqual(f.record(), ['file://docs/old folder', 'file://docs/中文 § game'])
})
test('grant denial returns cancellation once and keeps old records; a later selection still works', async () => {
  const callbacks = [], f = permissions({ uris: ['file://docs/old'], persist: (policies, count) => count === 1 ? Promise.reject(Error('denied')) : Promise.resolve() })
  picker(f.instance, Promise.resolve(['file://docs/denied'])).showDirDocumentViewPicker(false, value => callbacks.push(value))
  await tick(); assert.deepEqual(callbacks, ['']); assert.deepEqual(f.record(), ['file://docs/old'])
  picker(f.instance, Promise.resolve(['file://docs/retry'])).showDirDocumentViewPicker(false, value => callbacks.push(value))
  await tick(); assert.deepEqual(callbacks, ['', '["/retry"]']); assert.deepEqual(f.record(), ['file://docs/old', 'file://docs/retry'])
})
test('concurrent granted directory selections serialize without overwriting earlier records', async () => {
  const first = deferred(), f = permissions({ persist: (policies, count) => count === 1 ? first.promise : Promise.resolve() })
  const one = f.instance.persistGrantedDirectories(['file://docs/one']), two = f.instance.persistGrantedDirectories(['file://docs/two', 'file://docs/one'])
  await tick(); assert.equal(f.persisted.length, 1)
  first.resolve(); await Promise.all([one, two])
  assert.deepEqual(f.record(), ['file://docs/one', 'file://docs/two'])
})
test('preferences flush failure cannot yield a directory or an in-memory saved grant', async () => {
  const callbacks = [], f = permissions({ uris: ['file://docs/old'], flush: (callback, count) => callback(count === 1 ? Error('disk full') : undefined) })
  picker(f.instance, Promise.resolve(['file://docs/new'])).showDirDocumentViewPicker(false, value => callbacks.push(value))
  await tick(); assert.deepEqual(callbacks, ['']); assert.deepEqual(f.record(), ['file://docs/old'])
  await f.instance.persistGrantedDirectories(['file://docs/retry'])
  assert.deepEqual(f.record(), ['file://docs/old', 'file://docs/retry'])
})
test('restoration waits for actual activation and shares it across initializers; revoked grants remain retryable', async () => {
  let complete; const f = permissions({ uris: ['file://docs/old'], activate: (uris, callback) => { complete = callback } })
  let done = false
  const one = f.instance.initPermissions().then(() => { done = true }), two = f.instance.initPermissions()
  await tick(); assert.equal(done, false); assert.equal(f.instance.isInitialized, false); assert.equal(f.activationCalls(), 1)
  complete(401); const result = await Promise.allSettled([one, two]); assert.equal(result.every(r => r.status === 'rejected'), true); assert.equal(done, false); assert.equal(f.instance.isInitialized, false)
  const retry = f.instance.initPermissions(); await tick(); complete(1); await retry
  assert.equal(f.instance.isInitialized, true); assert.deepEqual(f.record(), ['file://docs/old'])
})
test('picker cancellation performs no permission writes and a throwing native callback is not called twice', async () => {
  const f = permissions(), selected = picker(f.instance, Promise.resolve([])); let called = 0
  selected.showDirDocumentViewPicker(false, value => { called++; assert.equal(value, ''); throw Error('bridge disposed') })
  await tick(); assert.equal(called, 1); assert.equal(f.persisted.length, 0); assert.equal(f.flushes(), 0)
})
test('standard Electron directory dialog waits for grant; ordinary files and mixed files are not persisted', async () => {
  const grant = deferred(), f = permissions({ persist: () => grant.promise }), results = []
  nativeDialog(f.instance, Promise.resolve(['file://docs/游戏 §'])).showOpenDialog('{"properties_open_directory":true}', (paths, cancelled) => results.push([Array.from(paths), cancelled]))
  await tick(); assert.equal(results.length, 0)
  grant.resolve(); await tick(); assert.deepEqual(results, [[['file://docs/游戏 §'], false]])
  nativeDialog(f.instance, Promise.resolve(['file://docs/mod.jar'])).showOpenDialog('{"properties_open_directory":false}', (paths, cancelled) => results.push([Array.from(paths), cancelled]))
  await tick(); assert.equal(f.persisted.length, 1)
  nativeDialog(f.instance, Promise.resolve(['file://docs/mod.jar', 'file://docs/another'])).showOpenDialog('{"properties_open_directory":true,"properties_open_mixed":true}', (paths, cancelled) => results.push([Array.from(paths), cancelled]))
  await tick(); assert.deepEqual(f.record(), ['file://docs/游戏 §', 'file://docs/another'])
  assert.deepEqual(Array.from(f.persisted[1]), ['file://docs/another'])
})
test('standard directory dialog rejects failed grants and returns one cancellation', async () => {
  const f = permissions({ persist: () => Promise.reject(Error('denied')) }), results = []
  nativeDialog(f.instance, Promise.resolve(['file://docs/denied'])).showOpenDialog('{"properties_open_directory":true}', (paths, cancelled) => results.push([Array.from(paths), cancelled]))
  await tick(); assert.deepEqual(results, [[[], true]]); assert.deepEqual(f.record(), [])
})
test('native window never silently launches on failed authorization; visible retry waits for actual success', async () => {
  let complete; const f = permissions({ uris: ['file://docs/old'], activate: (uris, callback) => { complete = callback } }), w = nativeWindow(f.instance)
  w.instance.run(); await tick(); assert.equal(w.launches(), 0)
  complete(401); await tick(); assert.equal(w.launches(), 0); assert.equal(w.dialog().autoCancel, false)
  w.dialog().primaryButton.action(); await tick(); assert.equal(w.launches(), 0)
  complete(1); await tick(); assert.equal(w.launches(), 1)
})
test('native authorization failure can explicitly enter the UI to reselect a directory, without recording recovery', async () => {
  const f = permissions({ uris: ['file://docs/old'], activate: (uris, callback) => callback(401) }), w = nativeWindow(f.instance)
  w.instance.run(); await tick(); assert.equal(w.launches(), 0); assert.equal(f.instance.isInitialized, false)
  w.dialog().secondaryButton.action(); assert.equal(w.launches(), 1)
  assert.equal(f.instance.isInitialized, false, 'explicit degraded continuation never records a successful restore')
  await f.instance.persistGrantedDirectories(['file://docs/new'])
  assert.deepEqual(f.record(), ['file://docs/old', 'file://docs/new'])
})
test('new explicitly granted selection repairs corrupt metadata only after preserving the exact old value', async () => {
  const old = '{"damaged":', f = permissions({ raw: old })
  await assert.rejects(f.instance.initPermissions())
  assert.equal(f.raw(), old)
  await f.instance.persistGrantedDirectories(['file://docs/重新授权'])
  assert.deepEqual(f.record(), ['file://docs/重新授权'])
  assert.equal(f.backups.size, 1)
  assert.equal(JSON.parse([...f.backups.values()][0]).originalValue, old)
  await f.instance.initPermissions(); assert.equal(f.instance.isInitialized, true)
})
test('corrupt metadata recovery with failed flush retains the original damaged value and never reports success', async () => {
  const old = '{', f = permissions({ raw: old, flush: callback => callback(Error('disk full')) })
  await assert.rejects(f.instance.persistGrantedDirectories(['file://docs/new']), /disk full/)
  assert.equal(f.raw(), old)
  assert.equal(JSON.parse([...f.backups.values()][0]).originalValue, old)
})
