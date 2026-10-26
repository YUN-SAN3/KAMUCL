import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'esbuild'
import { compileScript, parse } from '@vue/compiler-sfc'
import * as vue from 'vue'
import type { ProfileSkins, SkinHistoryEntry } from '../src/shared/types'

// Execute the actual component setup, including its real account watcher. Only
// service responses and browser-only rendering/lifecycle hooks are fixtures.
const compiled = build({ entryPoints: ['src/renderer/src/views/SkinsView.vue'], bundle: true, write: false,
  platform: 'node', format: 'cjs', packages: 'external', logLevel: 'silent', plugins: [{ name: 'skin-account-services', setup(builder) {
    builder.onResolve({ filter: /^\.\.\/(api|store|skin-render|fallbackSkin)$/ }, args => ({ path: args.path.split('/').at(-1)!, external: true }))
    builder.onLoad({ filter: /\.vue$/ }, args => {
      if (!args.path.endsWith('SkinsView.vue')) return { contents: 'export default {}', loader: 'js' }
      const { descriptor } = parse(fs.readFileSync(args.path, 'utf8'))
      return { contents: compileScript(descriptor, { id: args.path }).content, loader: 'ts', resolveDir: path.dirname(args.path) }
    })
  } }] })

const profile = (name: string): ProfileSkins => ({ username: name, skins: [{ id: name, variant: 'classic', dataUrl: 'data:' + name } as any], capes: [] })
const history: SkinHistoryEntry = { id: 'saved', name: 'saved.png', dataUrl: 'data:saved', variant: 'slim', time: 1 }
const deferred = <T>() => {
  let resolve!: (value: T) => void, reject!: (reason: unknown) => void
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail })
  return { promise, resolve, reject }
}
const flush = async () => { for (let i = 0; i < 4; i++) { await vue.nextTick(); await Promise.resolve() } }

async function fixture(overrides: Record<string, unknown>, accountType = 'microsoft') {
  const store = vue.reactive({ selectedAccount: { id: 'A', type: accountType, username: 'Player A' }, settings: { theme: 'black' } })
  const notices: { message: string; kind: string }[] = [], unmounted: (() => void)[] = []
  const reads: { file: any; reader: any }[] = []
  class FileReaderFixture {
    result = ''; onload?: () => void; onerror?: () => void
    readAsDataURL(file: any) { reads.push({ file, reader: this }) }
  }
  const api = { getSkinProfile: async () => profile(store.selectedAccount.id), getSkinHistory: async () => [history], ...overrides, errText: String }
  const require = createRequire(path.resolve('package.json')), mod = { exports: {} as any }
  new Function('require', 'module', 'exports', 'window', 'FileReader', (await compiled).outputFiles[0].text)((name: string) => name === 'vue'
    ? { ...vue, onMounted() {}, onUnmounted(fn: () => void) { unmounted.push(fn) } }
    : name === 'store' ? { store, toast: (message: string, kind: string) => notices.push({ message, kind }) }
    : name === 'api' ? api : name === 'skin-render' ? { renderCape: async () => '', renderSkinFront: async (url: string) => 'thumbnail:' + url }
    : name === 'fallbackSkin' ? { createFallbackSkin: () => ({ toDataURL: () => 'data:default-local' }) }
    : require(name), mod, mod.exports, { kamucl: { getFilePath: (file: any) => file.path } }, FileReaderFixture)
  const scope = vue.effectScope(), state = scope.run(() => mod.exports.default.setup({}, { expose() {} }))
  const switchAccount = async (id: string) => { store.selectedAccount = { id, type: accountType, username: 'Player ' + id }; await flush() }
  return { state, store, notices, reads, switchAccount, close: () => { for (const fn of unmounted) fn(); scope.stop() } }
}

test('offline UI applies with captured account ID and a late A result cannot replace B preview, pending file, or history', async () => {
  const reply = deferred<ProfileSkins>(), args: unknown[][] = []
  const f = await fixture({ applyOfflineSkin: (...a: unknown[]) => { args.push(a); return reply.promise } }, 'offline')
  try {
    f.state.pending.value = { path: 'offline-A.png', name: 'offline-A.png' }; f.state.variant.value = 'slim'
    const apply = f.state.doUpload()
    await f.switchAccount('B')
    f.state.previewHistoryId.value = history.id; f.state.pending.value = { path: 'offline-B.png', name: 'offline-B.png' }
    reply.resolve(profile('applied-A')); await apply; await flush()
    assert.deepEqual(args, [['offline-A.png', 'slim', 'A']])
    assert.equal(f.state.profile.value.username, 'B'); assert.equal(f.state.previewSource.value, 'data:saved')
    assert.equal(f.state.pending.value.path, 'offline-B.png'); assert.equal(f.state.uploading.value, false)
    assert(f.notices.some(row => row.message.includes('Player A') && row.message.includes('已应用')))
  } finally { f.close() }
})

test('offline reset captures account ID and a deferred reset cannot clear the new account appearance', async () => {
  const reply = deferred<ProfileSkins>(), args: unknown[][] = []
  const f = await fixture({ resetOfflineSkin: (...a: unknown[]) => { args.push(a); return reply.promise } }, 'offline')
  try {
    f.state.profile.value = profile('A')
    const reset = f.state.onResetOffline()
    await f.switchAccount('B')
    f.state.previewHistoryId.value = history.id
    reply.resolve({ username: 'A', skins: [], capes: [] }); await reset; await flush()
    assert.deepEqual(args, [['A']]); assert.equal(f.state.profile.value.username, 'B')
    assert.equal(f.state.previewHistoryId.value, history.id); assert.equal(f.state.uploading.value, false)
  } finally { f.close() }
})

test('actual skin upload retains the accepted request but cannot replace a later account or clear its pending file', async () => {
  const reply = deferred<ProfileSkins>(), args: unknown[][] = []
  const f = await fixture({ uploadSkin: (...a: unknown[]) => { args.push(a); return reply.promise } })
  try {
    f.state.profile.value = profile('A')
    f.state.pending.value = { path: 'A.png', name: 'A.png' }; f.state.variant.value = 'slim'
    const upload = f.state.doUpload()
    await f.switchAccount('B')
    f.state.previewHistoryId.value = history.id; f.state.pending.value = { path: 'B.png', name: 'B.png' }; f.state.pendingDataUrl.value = 'data:B-pending'
    reply.resolve(profile('uploaded-A')); await upload; await flush()
    assert.deepEqual(args, [['A.png', 'slim']])
    assert.equal(f.state.profile.value.username, 'B')
    assert.equal(f.state.previewSource.value, 'data:saved'); assert.equal(f.state.previewHistoryId.value, history.id)
    assert.equal(f.state.pending.value.path, 'B.png'); assert.equal(f.state.pendingDataUrl.value, 'data:B-pending')
    assert.equal(f.state.uploading.value, false)
    assert(f.notices.some(row => row.kind === 'success' && row.message.includes('Player A') && row.message.includes('保持不变')))
  } finally { f.close() }
})

test('historical restore rejects an old response even after switching back to the original account', async () => {
  const reply = deferred<ProfileSkins>(), accepted: string[] = []
  const f = await fixture({ uploadSkinFromHistory: (id: string) => { accepted.push(id); return reply.promise } })
  try {
    f.state.profile.value = profile('initial-A'); f.state.previewHistoryId.value = history.id
    const restore = f.state.onRestore(history)
    await f.switchAccount('B'); await f.switchAccount('A')
    f.state.profile.value = profile('fresh-A'); f.state.previewHistoryId.value = history.id
    reply.resolve(profile('stale-A')); await restore; await flush()
    assert.deepEqual(accepted, [history.id]); assert.equal(f.state.profile.value.username, 'fresh-A')
    assert.equal(f.state.previewSource.value, 'data:saved'); assert.equal(f.state.historyBusy.value, null)
    assert(f.notices.some(row => row.kind === 'success' && row.message.includes('Player A')))
  } finally { f.close() }
})

test('late upload and restore failures retain explicit errors while leaving the new account state intact', async () => {
  for (const operation of ['upload', 'restore']) {
    const reply = deferred<ProfileSkins>()
    const f = await fixture({ uploadSkin: () => reply.promise, uploadSkinFromHistory: () => reply.promise })
    try {
      f.state.profile.value = profile('A'); f.state.pending.value = { path: 'A.png', name: 'A.png' }
      const result = operation === 'upload' ? f.state.doUpload() : f.state.onRestore(history)
      await f.switchAccount('B'); f.state.previewHistoryId.value = history.id
      reply.reject(new Error('HTTP 503 fixture')); await result; await flush()
      assert.equal(f.state.profile.value.username, 'B'); assert.equal(f.state.previewHistoryId.value, history.id)
      assert(f.notices.some(row => row.kind === 'error' && row.message.includes('Player A') && row.message.includes('HTTP 503 fixture')))
      assert.equal(f.state.historyBusy.value, null); assert.equal(f.state.uploading.value, false)
    } finally { f.close() }
  }
})

test('current upload updates the profile but preserves a new file selected while the old upload was pending', async () => {
  const reply = deferred<ProfileSkins>(), f = await fixture({ uploadSkin: () => reply.promise })
  try {
    f.state.pending.value = { path: 'first.png', name: 'first.png' }
    const upload = f.state.doUpload()
    f.state.pending.value = { path: 'next.png', name: 'next.png' }; f.state.pendingDataUrl.value = 'data:next'
    reply.resolve(profile('uploaded')); await upload; await flush()
    assert.equal(f.state.profile.value.username, 'uploaded')
    assert.equal(f.state.pending.value.path, 'next.png'); assert.equal(f.state.pendingDataUrl.value, 'data:next')
    assert(f.notices.some(row => row.message === '皮肤上传成功'))
  } finally { f.close() }
})

test('current restore does not dismiss another history preview selected before its response', async () => {
  const reply = deferred<ProfileSkins>(), f = await fixture({ uploadSkinFromHistory: () => reply.promise })
  try {
    f.state.previewHistoryId.value = 'previous'
    const restore = f.state.onRestore(history)
    f.state.previewHistoryId.value = history.id
    reply.resolve(profile('restored')); await restore; await flush()
    assert.equal(f.state.profile.value.username, 'restored'); assert.equal(f.state.previewHistoryId.value, history.id)
  } finally { f.close() }
})

test('successful current upload invalidates an earlier pending profile read and clears only its submitted file', async () => {
  const oldRead = deferred<ProfileSkins>(), uploadReply = deferred<ProfileSkins>()
  const f = await fixture({ getSkinProfile: () => oldRead.promise, uploadSkin: () => uploadReply.promise })
  try {
    const read = f.state.loadProfile()
    f.state.pending.value = { path: 'submitted.png', name: 'submitted.png' }; f.state.pendingDataUrl.value = 'data:submitted'
    const upload = f.state.doUpload()
    uploadReply.resolve(profile('uploaded')); await upload
    assert.equal(f.state.profile.value.username, 'uploaded'); assert.equal(f.state.pending.value, null)
    assert.equal(f.state.pendingDataUrl.value, ''); assert.equal(f.state.loadingProfile.value, false)
    oldRead.resolve(profile('old-before-upload')); await read; await flush()
    assert.equal(f.state.profile.value.username, 'uploaded')
  } finally { f.close() }
})

test('actual file preview reads cannot overwrite a later selected file or account preview', async () => {
  const f = await fixture({})
  try {
    const oldRead = f.state.pickFile({ name: 'A.png', path: 'A.png' })
    await f.switchAccount('B')
    const currentRead = f.state.pickFile({ name: 'B.png', path: 'B.png' })
    f.reads[1].reader.result = 'data:current-B'; f.reads[1].reader.onload(); await currentRead
    f.reads[0].reader.result = 'data:old-A'; f.reads[0].reader.onload(); await oldRead
    assert.equal(f.state.pending.value.path, 'B.png'); assert.equal(f.state.pendingDataUrl.value, 'data:current-B')
    const superseded = f.state.pickFile({ name: 'first-B.png', path: 'first-B.png' })
    const latest = f.state.pickFile({ name: 'next-B.png', path: 'next-B.png' })
    f.reads[3].reader.result = 'data:next-B'; f.reads[3].reader.onload(); await latest
    f.reads[2].reader.onerror(); await superseded
    assert.equal(f.state.pending.value.path, 'next-B.png'); assert.equal(f.state.pendingDataUrl.value, 'data:next-B')
  } finally { f.close() }
})
