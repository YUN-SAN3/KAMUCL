import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import https from 'node:https'
import tls from 'node:tls'
import net from 'node:net'
import { execFileSync } from 'node:child_process'
import type { Socket } from 'node:net'
import { createRequire } from 'node:module'
import { build } from 'esbuild'
import { DEFAULT_MS_CLIENT_ID } from '../src/shared/types'
import { MICROSOFT_IDENTITY, assertMicrosoftIdentityPatch, microsoftVerificationUri } from '../src/main/core/microsoftIdentity'

const requireFixture = createRequire(path.resolve('package.json'))
const retired = 'c36a9fb6-4f2a-41ff-90bd-ae7cc92031eb'
const uuid = '11111111-2222-4333-8444-555555555555'
const cipher = (value: string) => Buffer.from('fixture-encrypted:' + value).toString('base64')
const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status })
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done }); return { promise, resolve } }
async function waitFor(check: () => boolean) {
  for (let n = 0; n < 200; n++) { if (check()) return; await new Promise(resolve => setTimeout(resolve, 2)) }
  throw new Error('Owned mocked protocol did not reach the expected stage')
}
const compiledAccounts = build({ stdin: { contents: fs.readFileSync('src/main/core/accounts.ts', 'utf8') + '\nexport const fixture = {load,persist,upsert};',
  resolveDir: path.resolve('src/main/core'), loader: 'ts' }, bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external',
  plugins: [{ name: 'owned-ms-fixtures', setup(builder) {
    builder.onResolve({ filter: /^\.\/(settings|microsoftTls|launcherLog|yggdrasil)$/ }, args => ({ path: 'fixture:' + args.path.slice(2), external: true }))
  } }] }).then(result => result.outputFiles[0].text)
const compiledSettings = build({ stdin: { contents: "export {getSettings,saveSettings} from './src/main/core/settings';", resolveDir: process.cwd(), loader: 'ts' },
  bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external' }).then(result => result.outputFiles[0].text)
const compiledTransport = build({ entryPoints: ['src/main/core/microsoftTls.ts'], bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external' }).then(result => result.outputFiles[0].text)

/** Protocol responses and secret strings are synthetic; no userData or real service is read. */
async function runtime(t: import('node:test').TestContext, initial?: any, platform = 'win32') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kamucl-ms122-')), file = path.join(root, 'accounts.json')
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  if (initial) fs.writeFileSync(file, JSON.stringify(initial))
  const calls: Array<{ url: string; init: any }> = [], logs: unknown[] = [], sleeps: number[] = []
  const state = { unlocked: true, encryptionFails: false, badDecrypt: '', fileFailure: '',
    settings: { msClientId: DEFAULT_MS_CLIENT_ID, msUseProxy: false }, profileId: uuid.replaceAll('-', ''), handler: null as null | ((url: string, init: any) => Promise<Response> | Response) }
  const storage = { isEncryptionAvailable: () => state.unlocked,
    getSelectedStorageBackend: () => state.unlocked ? 'gnome_libsecret' : 'basic_text',
    encryptString: (value: string) => { if (state.encryptionFails) throw Error('fixture-secret-encryption-error'); return Buffer.from('fixture-encrypted:' + value) },
    decryptString: (value: Buffer) => { if (value.toString().includes(state.badDecrypt) && state.badDecrypt) throw Error('cannot decode fixture'); return value.toString().replace(/^fixture-encrypted:/, '') } }
  const fetch = async (url: string, init: any) => {
    calls.push({ url, init })
    if (state.handler) { const override = await state.handler(url, init); if (override) return override }
    if (url.endsWith('/devicecode')) return response({ device_code: 'fixture-device-code', user_code: 'ABCD-EFGH', verification_uri: 'https://microsoft.com/devicelogin', interval: 1, expires_in: 900 })
    if (url.endsWith('/token')) return response({ access_token: 'fixture-ms-access', refresh_token: 'fixture-new-refresh', expires_in: 3600 })
    if (url.includes('/user/authenticate')) return response({ Token: 'fixture-xbl-token' })
    if (url.includes('/xsts/authorize')) return response({ Token: 'fixture-xsts-token', DisplayClaims: { xui: [{ uhs: 'fixture-uhs' }] } })
    if (url.endsWith('/login_with_xbox')) return response({ access_token: 'fixture-mc-access', expires_in: 3600 })
    if (url.endsWith('/mcstore')) return response({ items: [{ name: 'product_minecraft' }] })
    if (url.endsWith('/minecraft/profile')) return response({ id: state.profileId, name: 'OwnedFixture' })
    throw new Error('Unexpected owned protocol fixture URL')
  }
  const controlledFs = { ...fs,
    writeFileSync: (target: any, data: any, options: any) => {
      if (state.fileFailure === 'partial-write' && typeof target === 'number') { fs.writeFileSync(target, '{partial', options); throw Error('fixture-secret-write-error') }
      return fs.writeFileSync(target, data, options)
    }, renameSync: (from: fs.PathLike, to: fs.PathLike) => {
      if (state.fileFailure === 'rename') throw Error('fixture-secret-rename-error')
      fs.renameSync(from, to)
    } }
  const fakeProcess = Object.create(process); Object.defineProperty(fakeProcess, 'platform', { value: platform })
  Object.defineProperty(fakeProcess, 'env', { value: { ...process.env, KAMUCL_MSA_CLIENT_ID: retired, MS_CLIENT_ID: retired } })
  const module = { exports: {} as any }
  // Only fixture polling sleeps are accelerated; no product code/timestamps are rewritten.
  new Function('require', 'module', 'exports', 'process', 'setTimeout', await compiledAccounts)((name: string) => {
    if (name === 'electron') return { app: { getPath: () => root }, safeStorage: storage }
    if (name === 'node:fs') return controlledFs
    if (name === 'fixture:settings') return { getSettings: () => state.settings }
    if (name === 'fixture:microsoftTls') return { microsoftFetch: fetch }
    if (name === 'fixture:launcherLog') return { logScope: () => ({ error: (...values: unknown[]) => logs.push(values) }) }
    if (name === 'fixture:yggdrasil') return { refreshAccount: async (a: any) => a, invalidateAccount: async () => {} }
    return requireFixture(name)
  }, module, module.exports, fakeProcess, (fn: (...args: any[]) => void, delay: number, ...args: any[]) => { sleeps.push(delay); return setTimeout(fn, delay >= 1000 ? 1 : delay, ...args) })
  t.after(() => module.exports.cancelMsLogin())
  return { api: module.exports, root, file, calls, logs, state, sleeps }
}
function storedMicrosoft(id = 'existing-account', bound?: string) {
  return { id, type: 'microsoft', username: 'BeforeFixture', uuid, expiresAt: Math.floor(Date.now() / 1000) + 99999,
    ...(bound ? { msOAuthClientId: bound } : {}), secure: { accessToken: cipher('fixture-old-access'), refreshToken: cipher('fixture-old-refresh') } }
}
async function login(api: any) {
  const done = deferred<{ account: any; error?: string; operationId?: string }>()
  const info = await api.beginMsDeviceCode((account: any, error?: string, operationId?: string) => done.resolve({ account, error, operationId }))
  return { info, result: await done.promise }
}

test('formal ID is immutable, has no client secret, and settings patches reject all other identities', () => {
  assert.equal(DEFAULT_MS_CLIENT_ID, '06cc8cf6-4b8f-4631-8459-b2bd828808f8')
  assert(Object.isFrozen(MICROSOFT_IDENTITY))
  for (const msClientId of [retired, '00000000402b5328', '', undefined, null, '11111111-1111-4111-8111-111111111111']) assert.throws(() => assertMicrosoftIdentityPatch({ msClientId }), /不可覆写/)
  assert.doesNotThrow(() => assertMicrosoftIdentityPatch({}))
  assert.doesNotThrow(() => assertMicrosoftIdentityPatch({ msClientId: DEFAULT_MS_CLIENT_ID }))
  assert(!Object.hasOwn(MICROSOFT_IDENTITY, 'clientSecret'))
})
test('actual settings load replaces legacy, Prism and arbitrary IDs while preserving other settings; IPC-style patch rejects override', async t => {
  for (const old of [retired, '00000000402b5328', '11111111-1111-4111-8111-111111111111', null]) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ms122-settings-')); t.after(() => fs.rmSync(root, { recursive: true, force: true }))
    fs.mkdirSync(path.join(root, 'userData')); const file = path.join(root, 'userData/settings.json')
    fs.writeFileSync(file, JSON.stringify({ msClientId: old, memoryMB: 6144, favoriteVersions: ['keep-existing-version'] }))
    const module = { exports: {} as any }
    new Function('require', 'module', 'exports', await compiledSettings)((name: string) => name === 'electron' ? { app: { getPath: (key: string) => path.join(root, key) } } : requireFixture(name), module, module.exports)
    const settings = module.exports.getSettings(); assert.equal(settings.msClientId, DEFAULT_MS_CLIENT_ID); assert.equal(settings.memoryMB, 6144)
    assert.deepEqual(settings.favoriteVersions, ['keep-existing-version']); const before = fs.readFileSync(file, 'utf8')
    assert.throws(() => module.exports.saveSettings({ msClientId: retired, memoryMB: 1 }), /不可覆写/)
    assert.equal(fs.readFileSync(file, 'utf8'), before)
    assert.equal(JSON.parse(before).msClientId, DEFAULT_MS_CLIENT_ID)
  }
})
test('unknown and old MS bindings require reauth even with a valid access token, never sending any token', async t => {
  for (const bound of [undefined, retired, '00000000402b5328']) {
    const account = storedMicrosoft('keep-id', bound), rt = await runtime(t, { accounts: [account], selectedId: 'keep-id' })
    const before = fs.readFileSync(rt.file, 'utf8'), row = rt.api.accountById('keep-id')
    assert.equal(rt.api.listAccounts()[0].msReauthRequired, true)
    await assert.rejects(rt.api.getValidAccount(row), /ACCOUNT_REAUTH_REQUIRED/)
    await assert.rejects(rt.api.refreshMicrosoft(row), /ACCOUNT_REAUTH_REQUIRED/)
    assert.equal(rt.calls.length, 0); assert.equal(rt.api.selectedAccount().id, 'keep-id')
    assert.equal(fs.readFileSync(rt.file, 'utf8'), before)
    assert.equal(rt.api.microsoftAuthStatus().reauthenticationRequiredAccounts, 1)
  }
})
test('new login freezes official identity across settings/env changes, verifies every service and stores encrypted binding', async t => {
  const rt = await runtime(t)
  rt.state.handler = async url => { if (url.endsWith('/devicecode')) rt.state.settings.msClientId = retired; return undefined as any }
  assert.equal(rt.api.microsoftAuthStatus().serviceValidation, 'unverified')
  const { info, result } = await login(rt.api); assert.equal(result.error, undefined); assert.equal(result.account.msOAuthClientId, DEFAULT_MS_CLIENT_ID)
  assert.match(info.operationId, /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/)
  assert.equal(result.operationId, info.operationId)
  assert.equal(rt.calls.length, 7); assert.equal(info.verificationUri, 'https://microsoft.com/devicelogin')
  for (const call of rt.calls.filter(x => /\/(devicecode|token)$/.test(x.url))) {
    const form = new URLSearchParams(call.init.body); assert.equal(form.get('client_id'), DEFAULT_MS_CLIENT_ID)
    assert(call.url.startsWith(MICROSOFT_IDENTITY.authority)); assert(!form.has('client_secret'))
  }
  assert(rt.calls.every(call => call.init.signal instanceof AbortSignal))
  const file = fs.readFileSync(rt.file, 'utf8'); assert(!file.includes('fixture-new-refresh')); assert(!file.includes('fixture-mc-access'))
  const stored = JSON.parse(file).accounts[0]; assert.equal(stored.msOAuthClientId, DEFAULT_MS_CLIENT_ID); assert(stored.secure.refreshToken)
  assert.equal(rt.api.microsoftAuthStatus().serviceValidation, 'verified-this-session')
  for (const key of ['accessToken', 'refreshToken', 'clientToken', 'userProperties']) assert(!Object.hasOwn(rt.api.listAccounts()[0], key))
})
test('same-UUID reauthorization preserves original account ID, selected account and unrelated offline data', async t => {
  const rt = await runtime(t, { accounts: [storedMicrosoft('original-custom-id', retired), { id: 'offline-keep', type: 'offline', username: 'OfflineKeep', uuid: 'offline-uuid' }], selectedId: 'offline-keep' })
  const { result } = await login(rt.api)
  assert.equal(result.account.id, 'original-custom-id'); assert.equal(rt.api.listAccounts().length, 2)
  assert.equal(rt.api.selectedAccount().id, 'offline-keep'); assert.equal(result.account.msReauthRequired, false)
  const stored = JSON.parse(fs.readFileSync(rt.file, 'utf8')); assert.equal(stored.accounts[0].id, 'original-custom-id')
  assert.equal(stored.accounts[0].msOAuthClientId, DEFAULT_MS_CLIENT_ID); assert(!Object.hasOwn(stored.accounts[0], 'msReauthReason'))
  assert.equal(stored.selectedId, 'offline-keep')
})
test('cancel pending devicecode aborts its request; an abort-ignoring late response cannot poll, callback or save', async t => {
  const rt = await runtime(t), pending = deferred<Response>(); let callbacks = 0
  rt.state.handler = () => pending.promise
  const start = rt.api.beginMsDeviceCode(() => { callbacks++ }); const rejected = assert.rejects(start, /CANCELLED/)
  await waitFor(() => rt.calls.length === 1); rt.api.cancelMsLogin(); assert.equal(rt.calls[0].init.signal.aborted, true)
  pending.resolve(response({ device_code: 'late-fixture', user_code: 'ABCD-EFGH', verification_uri: 'https://microsoft.com/devicelogin' }))
  await rejected; assert.equal(rt.calls.length, 1); assert.equal(callbacks, 0); assert(!fs.existsSync(rt.file))
})
test('replacement suppresses previous pending login and does not clear the successful new flow', async t => {
  const rt = await runtime(t), pending = deferred<Response>(); let deviceRequests = 0, oldCallbacks = 0
  rt.state.handler = url => { if (url.endsWith('/devicecode') && ++deviceRequests === 1) return pending.promise; return undefined as any }
  const start = rt.api.beginMsDeviceCode(() => { oldCallbacks++ }), oldRejected = assert.rejects(start, /CANCELLED/)
  await waitFor(() => rt.calls.length === 1); const current = await login(rt.api); assert(current.result.account)
  pending.resolve(response({ device_code: 'late-fixture', user_code: 'ABCD-EFGH', verification_uri: 'https://microsoft.com/devicelogin' }))
  await oldRejected; assert.equal(oldCallbacks, 0); assert.equal(rt.api.listAccounts().length, 1)
})
for (const stage of ['/token', '/minecraft/profile']) test('cancel at ' + stage + ' blocks downstream/commit and aborts all prior request signals', async t => {
  const rt = await runtime(t), pending = deferred<Response>(); let callbacks = 0
  rt.state.handler = url => url.endsWith(stage) ? pending.promise : undefined as any
  await rt.api.beginMsDeviceCode(() => { callbacks++ }); await waitFor(() => rt.calls.some(x => x.url.endsWith(stage)))
  const count = rt.calls.length; rt.api.cancelMsLogin(); assert(rt.calls.every(x => x.init.signal.aborted))
  pending.resolve(stage === '/token' ? response({ access_token: 'late-ms', refresh_token: 'late-refresh', expires_in: 3600 }) : response({ id: uuid.replaceAll('-', ''), name: 'LateProfile' }))
  await new Promise(resolve => setTimeout(resolve, 10)); assert.equal(rt.calls.length, count); assert.equal(callbacks, 0)
  assert(!fs.existsSync(rt.file)); assert.equal(rt.api.microsoftAuthStatus().serviceValidation, 'unverified')
})
test('application rejection is safely classified without returning or logging raw OAuth payload', async t => {
  const rt = await runtime(t); rt.state.handler = async () => response({ error: 'invalid_client', error_description: 'fixture-secret-token-and-private-email' }, 400)
  await assert.rejects(rt.api.beginMsDeviceCode(() => {}), /APPLICATION_REJECTED/)
  const text = JSON.stringify({ status: rt.api.microsoftAuthStatus(), logs: rt.logs }); assert(!text.includes('fixture-secret-token-and-private-email'))
  assert.equal(rt.api.microsoftAuthStatus().serviceValidation, 'unverified'); assert(!fs.existsSync(rt.file))
})
test('Minecraft invalid app registration is not treated as a credential problem or successful authorization', async t => {
  const rt = await runtime(t); rt.state.handler = url => url.endsWith('/login_with_xbox') ? response({ errorMessage: 'Invalid app registration; fixture-private-value' }, 403) : undefined as any
  const { result } = await login(rt.api); assert.equal(result.account, null); assert.match(result.error!, /APPLICATION_REJECTED/)
  assert(!JSON.stringify(rt.logs).includes('fixture-private-value')); assert(!fs.existsSync(rt.file))
})
test('public random operation IDs correlate both success and failure events and never encode the devicecode/token', async t => {
  const rt = await runtime(t), first = await login(rt.api)
  rt.state.handler = url => url.endsWith('/token') ? response({ error: 'access_denied' }, 400) : undefined as any
  const second = await login(rt.api)
  assert.notEqual(first.info.operationId, second.info.operationId); assert.equal(second.result.operationId, second.info.operationId)
  assert.equal(second.result.account, null)
  for (const id of [first.info.operationId, second.info.operationId]) {
    assert(!id.includes('fixture')); assert(!id.includes('ABCD')); assert(!id.includes('device')); assert(!id.includes('refresh'))
  }
})
test('malformed protocol, missing refresh token and unowned game never commit any account', async t => {
  for (const mode of ['json', 'no-refresh', 'not-owned']) {
    const rt = await runtime(t)
    rt.state.handler = url => {
      if (mode === 'json' && url.endsWith('/devicecode')) return new Response('invalid fixture JSON')
      if (mode === 'no-refresh' && url.endsWith('/token')) return response({ access_token: 'fixture-ms-token' })
      if (mode === 'not-owned' && url.endsWith('/mcstore')) return response({ items: [] })
      return undefined as any
    }
    if (mode === 'json') await assert.rejects(rt.api.beginMsDeviceCode(() => {}), /PROTOCOL_ERROR/)
    else { const { result } = await login(rt.api); assert.equal(result.account, null); assert.match(result.error!, mode === 'not-owned' ? /NOT_OWNED/ : /PROTOCOL_ERROR/) }
    assert(!fs.existsSync(rt.file)); assert.equal(rt.api.microsoftAuthStatus().serviceValidation, 'unverified')
  }
})
test('current binding refresh deduplicates requests, rotates encrypted token and preserves ID/selection', async t => {
  const rt = await runtime(t, { accounts: [storedMicrosoft('current-id', DEFAULT_MS_CLIENT_ID)], selectedId: 'current-id' })
  const account = rt.api.accountById('current-id'), first = rt.api.refreshMicrosoft(account), second = rt.api.refreshMicrosoft(account)
  const [a, b] = await Promise.all([first, second]); assert.equal(a.id, 'current-id'); assert.equal(b.id, 'current-id')
  assert.equal(rt.calls.filter(x => x.url.endsWith('/token')).length, 1)
  const form = new URLSearchParams(rt.calls[0].init.body); assert.equal(form.get('client_id'), DEFAULT_MS_CLIENT_ID); assert.equal(form.get('refresh_token'), 'fixture-old-refresh')
  const stored = JSON.parse(fs.readFileSync(rt.file, 'utf8')); assert.equal(stored.selectedId, 'current-id')
  assert.equal(stored.accounts[0].secure.refreshToken, cipher('fixture-new-refresh'))
})
test('refresh cannot silently switch Minecraft UUID or resurrect a removed account', async t => {
  for (const mode of ['different-profile', 'removed']) {
    const rt = await runtime(t, { accounts: [storedMicrosoft('current-id', DEFAULT_MS_CLIENT_ID)], selectedId: 'current-id' })
    if (mode === 'different-profile') {
      rt.state.profileId = '00000000000040008000000000000001'; const before = fs.readFileSync(rt.file, 'utf8')
      await assert.rejects(rt.api.refreshMicrosoft(rt.api.accountById('current-id')), /ACCOUNT_CHANGED/); assert.equal(fs.readFileSync(rt.file, 'utf8'), before)
    } else {
      const pending = deferred<Response>(); rt.state.handler = url => url.endsWith('/token') ? pending.promise : undefined as any
      const refreshing = rt.api.refreshMicrosoft(rt.api.accountById('current-id')), rejected = assert.rejects(refreshing, /CANCELLED/)
      await waitFor(() => rt.calls.length > 0); await rt.api.removeAccount('current-id')
      pending.resolve(response({ access_token: 'late', refresh_token: 'late-refresh', expires_in: 3600 })); await rejected
      assert.deepEqual(rt.api.listAccounts(), []); assert.equal(rt.calls.length, 1)
    }
  }
})
for (const failure of ['partial-write', 'rename']) test('actual ' + failure + ' failure leaves old bytes, account IDs and selection intact and cleans owned temp', async t => {
  const rt = await runtime(t, { accounts: [storedMicrosoft('keep-id', retired)], selectedId: 'keep-id' }), before = fs.readFileSync(rt.file, 'utf8')
  rt.api.listAccounts(); rt.state.fileFailure = failure; const { result } = await login(rt.api)
  assert.equal(result.account, null); assert.match(result.error!, /STORAGE_WRITE_FAILED/); assert(!result.error!.includes('fixture-secret'))
  assert.equal(fs.readFileSync(rt.file, 'utf8'), before); assert.equal(rt.api.accountById('keep-id').msOAuthClientId, retired)
  assert.equal(rt.api.selectedAccount().id, 'keep-id'); assert.deepEqual(fs.readdirSync(rt.root), ['accounts.json'])
})
for (const platform of ['win32', 'darwin', 'linux']) test(platform + ' locked keyring retains exact old ciphertext, allows metadata selection, refuses rebinding old ciphertext', async t => {
  const initial = { accounts: [storedMicrosoft('keep-id', retired)], selectedId: 'keep-id' }, rt = await runtime(t, initial, platform)
  rt.state.unlocked = false; rt.api.listAccounts(); rt.api.selectAccount('keep-id')
  const stored = JSON.parse(fs.readFileSync(rt.file, 'utf8')); assert.deepEqual(stored.accounts[0].secure, initial.accounts[0].secure)
  const before = fs.readFileSync(rt.file, 'utf8'), { result } = await login(rt.api)
  assert.equal(result.account, null); assert.match(result.error!, /STORAGE_UNAVAILABLE/); assert.equal(fs.readFileSync(rt.file, 'utf8'), before)
  assert.equal(rt.api.selectedAccount().id, 'keep-id'); assert.equal(rt.api.accountById('keep-id').msOAuthClientId, retired)
})
test('undecryptable fields survive a protected-store metadata write and encryption failure cannot replace old file', async t => {
  const initial = { accounts: [storedMicrosoft('keep-id', DEFAULT_MS_CLIENT_ID)], selectedId: 'keep-id' }, rt = await runtime(t, initial)
  rt.state.badDecrypt = 'fixture-old-refresh'; rt.api.listAccounts(); rt.api.selectAccount('keep-id')
  assert.equal(JSON.parse(fs.readFileSync(rt.file, 'utf8')).accounts[0].secure.refreshToken, initial.accounts[0].secure.refreshToken)
  const before = fs.readFileSync(rt.file, 'utf8'); rt.state.encryptionFails = true; const { result } = await login(rt.api)
  assert.match(result.error!, /STORAGE_UNAVAILABLE/); assert.equal(fs.readFileSync(rt.file, 'utf8'), before)
})
test('a damaged old account file is never replaced by an empty/new profile', async t => {
  const rt = await runtime(t); fs.writeFileSync(rt.file, '{damaged-user-file'); const before = fs.readFileSync(rt.file, 'utf8')
  assert.deepEqual(rt.api.listAccounts(), []); assert.throws(() => rt.api.addOffline('FixtureOffline'), /STORAGE_WRITE_FAILED/)
  assert.equal(fs.readFileSync(rt.file, 'utf8'), before)
})
test('verification URI must be an actual Microsoft HTTPS origin, never arbitrary device response navigation', () => {
  for (const value of ['http://microsoft.com/link', 'https://microsoft.com.evil.test/link', 'https://user:pass@microsoft.com/link', 'https://microsoft.com:8443/link', 'javascript:alert(1)', 'https://evil.test/link']) assert.throws(() => microsoftVerificationUri(value), /PROTOCOL_ERROR/)
  assert.equal(microsoftVerificationUri('https://microsoft.com/link'), 'https://microsoft.com/link')
})

test('device polling preserves authorization_pending and increases delay on slow_down without changing identity', async t => {
  const rt = await runtime(t); let tokenRequests = 0
  rt.state.handler = url => {
    if (!url.endsWith('/token')) return undefined as any
    tokenRequests++
    if (tokenRequests === 1) return response({ error: 'authorization_pending' }, 400)
    if (tokenRequests === 2) return response({ error: 'slow_down' }, 400)
    return undefined as any
  }
  const { result } = await login(rt.api); assert(result.account); assert.deepEqual(rt.sleeps, [1000, 1000, 6000])
  for (const request of rt.calls.filter(x => x.url.endsWith('/token'))) assert.equal(new URLSearchParams(request.init.body).get('client_id'), DEFAULT_MS_CLIENT_ID)
})
test('OAuth error classes expose controlled messages and never server error descriptions', async t => {
  for (const [error, expected, status] of [
    ['access_denied', 'USER_DECLINED', 400], ['expired_token', 'DEVICE_CODE_EXPIRED', 400],
    ['invalid_grant', 'ACCOUNT_REAUTH_REQUIRED', 400], ['invalid_scope', 'APPLICATION_REJECTED', 400],
    ['anything-private', 'RATE_LIMITED', 429], ['authorization_pending', 'SERVICE_ERROR', 503]
  ] as const) {
    const rt = await runtime(t); rt.state.handler = url => url.endsWith('/token') ? response({ error, error_description: 'never-expose-fixture-secret' }, status) : undefined as any
    const { result } = await login(rt.api); assert.match(result.error!, new RegExp(expected)); assert.equal(result.account, null)
    assert(!JSON.stringify({ logs: rt.logs, status: rt.api.microsoftAuthStatus() }).includes('never-expose-fixture-secret')); assert(!fs.existsSync(rt.file))
  }
})
test('a cached unlocked account can survive later keyring locking without dropping its original ciphertext', async t => {
  for (const platform of ['win32', 'darwin']) {
    const initial = { accounts: [storedMicrosoft('keep-id', DEFAULT_MS_CLIENT_ID)], selectedId: 'keep-id' }, rt = await runtime(t, initial, platform)
    rt.api.listAccounts(); rt.state.unlocked = false; rt.api.selectAccount('keep-id')
    assert.deepEqual(JSON.parse(fs.readFileSync(rt.file, 'utf8')).accounts[0].secure, initial.accounts[0].secure)
  }
})
test('window cancellation aborts an active refresh and suppresses an abort-ignoring response', async t => {
  const rt = await runtime(t, { accounts: [storedMicrosoft('current-id', DEFAULT_MS_CLIENT_ID)], selectedId: 'current-id' }), before = fs.readFileSync(rt.file, 'utf8')
  const pending = deferred<Response>(); rt.state.handler = () => pending.promise
  const refreshing = rt.api.refreshMicrosoft(rt.api.accountById('current-id')), rejected = assert.rejects(refreshing, /CANCELLED/)
  await waitFor(() => rt.calls.length === 1); rt.api.cancelMsLogin(); assert(rt.calls[0].init.signal.aborted)
  pending.resolve(response({ access_token: 'late-fixture', refresh_token: 'late-fixture-refresh' })); await rejected
  assert.equal(rt.calls.length, 1); assert.equal(fs.readFileSync(rt.file, 'utf8'), before)
})
for (const phase of ['CONNECT', 'TLS']) test('actual owned proxy ' + phase + ' transport is cancelled before credentials can leave the client', async t => {
  const connected = deferred<void>(), sockets = new Set<Socket>(), chunks: Buffer[] = []
  let peerEnded = false
  const server = http.createServer()
  server.on('connect', (_request, socket) => {
    sockets.add(socket); socket.on('close', () => sockets.delete(socket)); socket.on('data', data => chunks.push(Buffer.from(data)))
    // CONNECT sockets are half-open by default; observe the client's FIN, then close our owned half.
    socket.on('end', () => { peerEnded = true; socket.destroy() })
    if (phase === 'TLS') socket.write('HTTP/1.1 200 Connection Established\r\n\r\n')
    connected.resolve()
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(async () => { for (const socket of sockets) socket.destroy(); await new Promise<void>(resolve => server.close(() => resolve())) })
  const port = (server.address() as { port: number }).port, module = { exports: {} as any }, fakeProcess = Object.create(process)
  Object.defineProperty(fakeProcess, 'platform', { value: 'win32' })
  new Function('require', 'module', 'exports', 'process', await compiledTransport)((name: string) => name === 'node:child_process'
    ? { execFileSync: (_command: string, args: string[]) => args.at(-1) === 'ProxyEnable' ? 'ProxyEnable REG_DWORD 0x1' : 'ProxyServer REG_SZ 127.0.0.1:' + port }
    : requireFixture(name), module, module.exports, fakeProcess)
  const controller = new AbortController(), request = module.exports.microsoftFetch(MICROSOFT_IDENTITY.authority + '/devicecode', {
    method: 'POST', body: 'synthetic-token-must-not-transmit', useProxy: true, signal: controller.signal })
  const rejected = assert.rejects(request)
  await connected.promise
  if (phase === 'TLS') await waitFor(() => chunks.length > 0)
  controller.abort(); await rejected; await waitFor(() => sockets.size === 0)
  assert(peerEnded, 'Cancellation must actually terminate the client transport, not just reject its Promise')
  assert(!Buffer.concat(chunks).toString().includes('synthetic-token-must-not-transmit'))
})

test('temporary token transport/HTTP failures retry the same devicecode with bounded backoff and never restart authorization', async t => {
  for (const kind of ['network', '429', '502', '503', '504']) {
    const rt = await runtime(t); let attempts = 0
    rt.state.handler = url => {
      if (!url.endsWith('/token') || ++attempts > 2) return undefined as any
      if (kind === 'network') throw Object.assign(Error('private-synthetic-network-text'), { code: 'ECONNRESET' })
      return new Response('temporary non-JSON service failure', { status: Number(kind) })
    }
    const { result } = await login(rt.api); assert(result.account); assert.equal(attempts, 3)
    assert.deepEqual(rt.sleeps, [1000, 5000, 10000]); assert.equal(rt.calls.filter(x => x.url.endsWith('/devicecode')).length, 1)
    for (const request of rt.calls.filter(x => x.url.endsWith('/token'))) {
      const body = new URLSearchParams(request.init.body); assert.equal(body.get('client_id'), DEFAULT_MS_CLIENT_ID); assert.equal(body.get('device_code'), 'fixture-device-code')
    }
  }
})
test('three temporary polling failures terminate clearly; TLS/application rejection/cancel never retry', async t => {
  for (const kind of ['network', '503', 'TLS', 'application']) {
    const rt = await runtime(t)
    rt.state.handler = url => {
      if (!url.endsWith('/token')) return undefined as any
      if (kind === 'network') throw Object.assign(Error('never-leak-fixture'), { code: 'ECONNRESET' })
      if (kind === 'TLS') throw Object.assign(Error('never-leak-fixture'), { code: 'CERT_HAS_EXPIRED' })
      return response({ error: kind === 'application' ? 'invalid_client' : 'temporary_error', error_description: 'never-leak-fixture' }, kind === 'application' ? 401 : 503)
    }
    const { result } = await login(rt.api), attempts = rt.calls.filter(x => x.url.endsWith('/token')).length
    assert.equal(result.account, null); assert(!result.error!.includes('never-leak-fixture'))
    assert.equal(attempts, kind === 'TLS' || kind === 'application' ? 1 : 3)
    if (attempts === 3) assert.match(result.error!, /连续 3 次/)
    assert(!fs.existsSync(rt.file))
  }
})
test('retry remains bounded by original device-code expiry and cannot obtain another code', async t => {
  const rt = await runtime(t)
  rt.state.handler = url => url.endsWith('/devicecode')
    ? response({ device_code: 'short-lived-fixture', user_code: 'ABCD-EFGH', verification_uri: 'https://microsoft.com/devicelogin', interval: 1, expires_in: 0.002 }) : undefined as any
  const { result } = await login(rt.api); assert.equal(result.account, null); assert.match(result.error!, /DEVICE_CODE_EXPIRED/)
  assert.equal(rt.calls.length, 1); assert(!fs.existsSync(rt.file))
})

/** A generated test CA stays in this owned temporary directory, never the system trust store. */
function testCertificate(root: string) {
  const gitOpenSSL = 'C:/Program Files/Git/usr/bin/openssl.exe'
  const executable = process.platform === 'win32' && fs.existsSync(gitOpenSSL) ? gitOpenSSL : 'openssl'
  const run = (args: string[]) => execFileSync(executable, args, { cwd: root, stdio: 'ignore', timeout: 30000, windowsHide: true })
  run(['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-sha256', '-days', '1', '-subj', '/CN=KAMUCL-Owned-Test-CA', '-keyout', 'ca-key.pem', '-out', 'ca.pem'])
  run(['req', '-new', '-newkey', 'rsa:2048', '-nodes', '-subj', '/CN=login.microsoftonline.com', '-keyout', 'server-key.pem', '-out', 'server.csr'])
  fs.writeFileSync(path.join(root, 'extensions.txt'), 'basicConstraints=CA:FALSE\nkeyUsage=digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectAltName=DNS:login.microsoftonline.com\n')
  run(['x509', '-req', '-in', 'server.csr', '-CA', 'ca.pem', '-CAkey', 'ca-key.pem', '-CAcreateserial', '-days', '1', '-sha256', '-extfile', 'extensions.txt', '-out', 'server.pem'])
  return { ca: fs.readFileSync(path.join(root, 'ca.pem')), key: fs.readFileSync(path.join(root, 'server-key.pem')), cert: fs.readFileSync(path.join(root, 'server.pem')) }
}
for (const mode of ['trusted', 'wrong-host', 'untrusted']) test('actual CONNECT→TLS→HTTPS POST ' + mode + ': verified socket is used once and every owned socket closes', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kamucl-real-tunnel122-')); t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const certificate = testCertificate(root), peerSockets = new Set<Socket>(), upstreamSockets = new Set<Socket>(), serverSockets = new Set<Socket>()
  const requestBodies: string[] = [], encryptedWire: Buffer[] = [], builtSockets: tls.TLSSocket[] = []
  let connects = 0, serverConnections = 0, httpsRequests = 0, directLookups = 0
  const body = 'client_id=' + DEFAULT_MS_CLIENT_ID + '&fixture_secret=owned-synthetic-post-only'
  const secure = https.createServer({ key: certificate.key, cert: certificate.cert }, (request, result) => {
    const chunks: Buffer[] = []; request.on('data', data => chunks.push(Buffer.from(data)))
    request.on('end', () => { requestBodies.push(Buffer.concat(chunks).toString()); result.writeHead(200, { 'Content-Type': 'application/json' }); result.end(JSON.stringify({ tunnel: 'owned-success' })) })
  })
  secure.on('tlsClientError', () => {})
  secure.on('connection', socket => { serverConnections++; serverSockets.add(socket); socket.on('close', () => serverSockets.delete(socket)) })
  await new Promise<void>(resolve => secure.listen(0, '127.0.0.1', resolve))
  const serverPort = (secure.address() as { port: number }).port
  const proxy = http.createServer()
  proxy.on('connect', (_request, peer, head) => {
    connects++; peerSockets.add(peer); peer.on('data', bytes => encryptedWire.push(Buffer.from(bytes)))
    const upstream = net.connect(serverPort, '127.0.0.1'); upstreamSockets.add(upstream)
    upstream.once('connect', () => { peer.write('HTTP/1.1 200 Connection Established\r\n\r\n'); if (head.length) upstream.write(head); peer.pipe(upstream); upstream.pipe(peer) })
    peer.on('end', () => peer.destroy()); upstream.on('end', () => upstream.destroy())
    peer.on('error', () => upstream.destroy()); upstream.on('error', () => peer.destroy())
    peer.once('close', () => { peerSockets.delete(peer); upstream.destroy() })
    upstream.once('close', () => { upstreamSockets.delete(upstream); peer.destroy() })
  })
  await new Promise<void>(resolve => proxy.listen(0, '127.0.0.1', resolve))
  t.after(async () => { for (const socket of [...peerSockets, ...upstreamSockets, ...serverSockets, ...builtSockets]) socket.destroy(); await Promise.all([new Promise<void>(resolve => proxy.close(() => resolve())), new Promise<void>(resolve => secure.close(() => resolve()))]) })
  const proxyPort = (proxy.address() as { port: number }).port, module = { exports: {} as any }, fakeProcess = Object.create(process)
  Object.defineProperty(fakeProcess, 'platform', { value: 'win32' })
  new Function('require', 'module', 'exports', 'process', await compiledTransport)((name: string) => {
    if (name === 'node:child_process') return { execFileSync: (_command: string, args: string[]) => args.at(-1) === 'ProxyEnable' ? 'ProxyEnable REG_DWORD 0x1' : 'ProxyServer REG_SZ 127.0.0.1:' + proxyPort }
    if (name === 'node:tls') return { ...tls, connect: (options: tls.ConnectionOptions) => {
      assert.equal(options.rejectUnauthorized, true); assert.equal(options.checkServerIdentity, tls.checkServerIdentity)
      const socket = tls.connect({ ...options, ...(mode !== 'untrusted' ? { ca: certificate.ca } : {}) }); builtSockets.push(socket); return socket
    } }
    if (name === 'node:https') return { ...https, request: (url: URL, options: any, callback: (res: http.IncomingMessage) => void) => {
      httpsRequests++; assert.equal(options.agent, undefined, 'agent:false would create a second connection and discard the tunnel')
      assert.equal(options.rejectUnauthorized, true); assert.equal(options.checkServerIdentity, tls.checkServerIdentity)
      assert.equal(options.createConnection(), builtSockets.at(-1)); assert.equal(builtSockets.at(-1)!.authorized, true)
      return https.request(url, { ...options, lookup: () => { directLookups++; throw Error('Unexpected direct DNS lookup; owned fixture refuses outside connections') } }, callback)
    } }
    return requireFixture(name)
  }, module, module.exports, fakeProcess)
  const hostname = mode === 'wrong-host' ? 'api.minecraftservices.com' : 'login.microsoftonline.com'
  const request = module.exports.microsoftFetch('https://' + hostname + '/fixture/post', { method: 'POST', body, useProxy: true })
  if (mode === 'trusted') { const result = await request; assert.deepEqual(await result.json(), { tunnel: 'owned-success' }); assert.deepEqual(requestBodies, [body]); assert.equal(httpsRequests, 1) }
  else { await assert.rejects(request, /SSL 证书验证失败/); assert.deepEqual(requestBodies, []); assert.equal(httpsRequests, 0) }
  await waitFor(() => peerSockets.size + upstreamSockets.size + serverSockets.size === 0 && builtSockets.every(socket => socket.destroyed))
  assert.equal(connects, 1); assert.equal(serverConnections, 1); assert.equal(directLookups, 0)
  assert(!Buffer.concat(encryptedWire).toString().includes('owned-synthetic-post-only'), 'CONNECT peer must only see encrypted TLS traffic')
})
