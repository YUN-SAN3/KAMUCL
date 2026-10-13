/**
 * 账号模块：离线账号 + 微软 device code 登录（XBL → XSTS → MC）
 * 存储：userData/accounts.json
 */
import { app, safeStorage } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import type { Account, MsDeviceCodeInfo, MicrosoftAuthStatus, MicrosoftAuthFailure } from '../../shared/types'
import { getSettings } from './settings'
import * as yggdrasil from './yggdrasil'
import { microsoftFetch } from './microsoftTls'
import { logScope } from './launcherLog'
import { protectedCredentialStorage, credentialStorageStatus } from './credentialProtection'
import { MICROSOFT_IDENTITY, MicrosoftAuthError, microsoftReauthReason, oauthResponseError, safeMicrosoftError, microsoftVerificationUri } from './microsoftIdentity'

const authLog = logScope('ms-auth')

/** 登录链路某一步失败时抛出带步骤标签的错误，并写启动器日志（供错误报告诊断）。 */
async function step<T>(name: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (error) {
    const safe = safeMicrosoftError(error, name)
    authLog.error(`微软登录步骤失败：${name}`, safe)
    throw safe
  }
}

interface AccountsFile {
  accounts: Account[]
  selectedId: string | null
}

type SecretKey =
  | 'accessToken'
  | 'refreshToken'
  | 'clientToken'
  | 'loginIdentifier'
  | 'userProperties'

interface StoredAccount extends Omit<Account, SecretKey> {
  secure?: Partial<Record<SecretKey, string>>
  /** 仅用于从 0.6.5 及更早版本迁移；新写入文件绝不会保留这些明文字段。 */
  accessToken?: string
  refreshToken?: string
  clientToken?: string
  loginIdentifier?: string
  userProperties?: Array<{ name: string; value: string }>
}

interface StoredAccountsFile {
  accounts?: StoredAccount[]
  selectedId?: string | null
}

const SECRET_KEYS: SecretKey[] = [
  'accessToken',
  'refreshToken',
  'clientToken',
  'loginIdentifier',
  'userProperties'
]

let cached: AccountsFile | null = null
let accountReadFailed = false
// Preserve already encrypted credentials while a keyring is temporarily locked.
// Session-only logins never overwrite these with a basic_text ciphertext.
const storedSecrets = new Map<string, StoredAccount['secure']>()
const storedPlainSecrets = new Map<string, Partial<Record<SecretKey, unknown>>>()
export function accountStorageStatus() { return credentialStorageStatus(safeStorage) }

function storeFile(): string {
  return path.join(app.getPath('userData'), 'accounts.json')
}

function encryptSecret(value: unknown): string {
  if (!protectedCredentialStorage(safeStorage)) {
    throw new Error('系统安全存储当前不可用，无法安全保存登录令牌')
  }
  const plain = typeof value === 'string' ? value : JSON.stringify(value)
  try { return safeStorage.encryptString(plain).toString('base64') }
  catch { throw new MicrosoftAuthError('STORAGE_UNAVAILABLE', '保存账号') }
}

function decryptSecret(value: string): string | undefined {
  try {
    if (!protectedCredentialStorage(safeStorage)) return undefined
    return safeStorage.decryptString(Buffer.from(value, 'base64'))
  } catch {
    return undefined
  }
}

function deserializeAccount(stored: StoredAccount): { account: Account; legacySecrets: boolean } {
  const account = { ...stored } as Account & { secure?: StoredAccount['secure'] }
  delete account.secure
  let legacySecrets = false
  for (const key of SECRET_KEYS) {
    // A failed decrypt must never leave an older plaintext field in the active account.
    if (stored.secure?.[key]) delete (account as unknown as Record<string, unknown>)[key]
    const encrypted = stored.secure?.[key]
    if (encrypted) {
      const plain = decryptSecret(encrypted)
      if (plain !== undefined) {
        if (key === 'userProperties') {
          try {
            account.userProperties = JSON.parse(plain) as Account['userProperties']
          } catch {
            account.userProperties = []
          }
        } else {
          ;(account as unknown as Record<string, unknown>)[key] = plain
        }
      }
    } else if (stored[key] !== undefined) {
      legacySecrets = true
    }
  }
  const values: Partial<Record<SecretKey, unknown>> = {}
  for (const key of SECRET_KEYS) if (account[key] !== undefined) values[key] = account[key]
  storedPlainSecrets.set(account.id, values)
  const reason = microsoftReauthReason(account)
  if (reason) { account.msReauthRequired = true; account.msReauthReason = reason }
  else if (account.type === 'microsoft') { account.msReauthRequired = false; delete account.msReauthReason }
  return { account, legacySecrets }
}

function serializeAccount(account: Account): StoredAccount {
  const stored = { ...account } as StoredAccount
  const protectedStorage = protectedCredentialStorage(safeStorage)
  // Keep original ciphertext on every platform, including values that cannot be decrypted.
  const secure: StoredAccount['secure'] = { ...storedSecrets.get(account.id) }
  for (const key of SECRET_KEYS) {
    const value = account[key]
    delete (stored as unknown as Record<string, unknown>)[key]
    if (value !== undefined && value !== '') {
      if (protectedStorage) secure[key] = encryptSecret(value)
      else if (process.platform !== 'linux' && JSON.stringify(value) !== JSON.stringify(storedPlainSecrets.get(account.id)?.[key])) {
        throw new MicrosoftAuthError('STORAGE_UNAVAILABLE', '保存账号')
      }
    }
  }
  if (Object.keys(secure).length) stored.secure = secure
  return stored
}

function load(): AccountsFile {
  if (cached) return cached
  let migrate = false
  try {
    const raw = JSON.parse(fs.readFileSync(storeFile(), 'utf-8')) as StoredAccountsFile
    const accounts = Array.isArray(raw.accounts)
      ? raw.accounts.map((stored) => {
          if (stored.secure) storedSecrets.set(stored.id, { ...stored.secure })
          const parsed = deserializeAccount(stored)
          migrate ||= parsed.legacySecrets
          return parsed.account
        })
      : []
    cached = {
      accounts,
      selectedId: raw.selectedId ?? null
    }
  } catch (error) {
    accountReadFailed = (error as NodeJS.ErrnoException).code !== 'ENOENT'
    cached = { accounts: [], selectedId: null }
  }
  if (migrate && protectedCredentialStorage(safeStorage)) {
    try {
      persist()
    } catch (error) {
      console.error('[KAMUCL] 账号凭据安全迁移失败，原文件保持不变:', error)
    }
  }
  return cached
}

function persist(): void {
  const data = load()
  if (accountReadFailed) throw new MicrosoftAuthError('STORAGE_WRITE_FAILED', '读取原账号文件')
  const stored: StoredAccountsFile = {
    accounts: data.accounts.map(serializeAccount),
    selectedId: data.selectedId
  }
  const file = storeFile(), temporary = `${file}.${crypto.randomUUID()}.tmp`
  let descriptor: number | undefined
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    descriptor = fs.openSync(temporary, 'wx', 0o600)
    fs.writeFileSync(descriptor, JSON.stringify(stored, null, 2), { encoding: 'utf-8' })
    fs.fsyncSync(descriptor)
    fs.closeSync(descriptor); descriptor = undefined
    // Commit only a complete, flushed sibling file. A failed replacement keeps the old file.
    fs.renameSync(temporary, file)
  } catch {
    throw new MicrosoftAuthError('STORAGE_WRITE_FAILED', '保存账号')
  } finally {
    if (descriptor !== undefined) { try { fs.closeSync(descriptor) } catch { /* preserve primary failure */ } }
    try { fs.unlinkSync(temporary) } catch { /* absent after successful rename; owned temp only */ }
  }
  storedSecrets.clear()
  for (const row of stored.accounts ?? []) if (row.secure) storedSecrets.set(row.id, { ...row.secure })
  if (protectedCredentialStorage(safeStorage)) {
    storedPlainSecrets.clear()
    for (const account of data.accounts) {
      const values: Partial<Record<SecretKey, unknown>> = {}
      for (const key of SECRET_KEYS) if (account[key] !== undefined) values[key] = account[key]
      storedPlainSecrets.set(account.id, values)
    }
  }
}

/** 渲染进程只拿展示字段，token、登录标识和用户属性始终留在主进程。 */
export function publicAccount(account: Account): Account {
  const result = { ...account }
  delete result.accessToken
  delete result.refreshToken
  delete result.clientToken
  delete result.loginIdentifier
  delete result.userProperties
  const reason = microsoftReauthReason(account)
  if (reason) { result.msReauthRequired = true; result.msReauthReason = reason }
  return result
}

/** 插入或更新账号（按 uuid 去重），并设为当前选中 */
function upsert(account: Account, select = true, preserveExistingSelection = false): Account {
  const data = load()
  const previousAccounts = data.accounts
  const previousSelectedId = data.selectedId
  const nextAccounts = [...data.accounts]
  const idx = data.accounts.findIndex(
    (existing) =>
      existing.id === account.id ||
      (account.type !== 'yggdrasil' &&
        existing.type !== 'yggdrasil' &&
        existing.uuid === account.uuid)
  )
  const savedAccount = idx >= 0 ? { ...nextAccounts[idx], ...account, id: nextAccounts[idx].id } : account
  if (idx >= 0) nextAccounts[idx] = savedAccount
  else nextAccounts.push(savedAccount)
  data.accounts = nextAccounts
  if (select && !(idx >= 0 && preserveExistingSelection)) data.selectedId = savedAccount.id
  try {
    persist()
  } catch (error) {
    data.accounts = previousAccounts
    data.selectedId = previousSelectedId
    throw error
  }
  return savedAccount
}

// ---------------- 基础操作 ----------------

export function listAccounts(): Account[] {
  return load().accounts.map(publicAccount)
}

/** 仅供主进程按账号读取凭据，不改变当前选择。 */
export function accountById(id: string): Account | null {
  return load().accounts.find((account) => account.id === id) ?? null
}

export function selectedAccount(): Account | null {
  const data = load()
  return data.accounts.find((a) => a.id === data.selectedId) ?? null
}

export function selectedAccountPublic(): Account | null {
  const account = selectedAccount()
  return account ? publicAccount(account) : null
}

export function selectAccount(id: string): Account | null {
  const data = load()
  const acc = data.accounts.find((a) => a.id === id) ?? null
  if (acc) {
    const previousSelectedId = data.selectedId
    data.selectedId = acc.id
    try {
      persist()
    } catch (error) {
      data.selectedId = previousSelectedId
      throw error
    }
  }
  return acc ? publicAccount(acc) : null
}

export async function removeAccount(id: string): Promise<Account[]> {
  const data = load()
  const account = data.accounts.find((item) => item.id === id)
  if (account?.type === 'yggdrasil') await yggdrasil.invalidateAccount(account)
  const previousAccounts = data.accounts
  const previousSelectedId = data.selectedId
  data.accounts = data.accounts.filter((a) => a.id !== id)
  if (data.selectedId === id) data.selectedId = data.accounts[0]?.id ?? null
  try {
    persist()
  } catch (error) {
    data.accounts = previousAccounts
    data.selectedId = previousSelectedId
    throw error
  }
  refreshOperations.get(id)?.operation.controller.abort()
  refreshOperations.delete(id)
  return data.accounts.map(publicAccount)
}

export function hasProviderAccounts(providerId: string): boolean {
  return load().accounts.some(
    (account) => account.type === 'yggdrasil' && account.providerId === providerId
  )
}

export function saveYggdrasilAccount(account: Account): Account {
  if (account.type !== 'yggdrasil') throw new Error('无效的外置登录账号')
  return publicAccount(upsert(account))
}

// ---------------- 离线账号 ----------------

/** 32 位 hex 格式化为 8-4-4-4-12，并设置 version 3 / variant 位（与 MC 离线模式一致） */
function offlineUuid(username: string): string {
  const hex = crypto.createHash('md5').update(`OfflinePlayer:${username}`, 'utf-8').digest('hex')
  const fixed = hex.slice(0, 12) + '3' + hex.slice(13, 16) + '8' + hex.slice(17)
  return `${fixed.slice(0, 8)}-${fixed.slice(8, 12)}-${fixed.slice(12, 16)}-${fixed.slice(16, 20)}-${fixed.slice(20)}`
}

export function addOffline(username: string): Account {
  const name = username.trim()
  if (!name) throw new Error('用户名不能为空')
  const uuid = offlineUuid(name)
  const account: Account = {
    id: uuid,
    type: 'offline',
    username: name,
    uuid,
    accessToken: crypto.randomBytes(16).toString('hex')
  }
  return upsert(account)
}

// ---------------- 微软登录 ----------------
interface MsOperation {
  readonly id: number
  readonly publicId: string
  readonly controller: AbortController
  readonly identity: typeof MICROSOFT_IDENTITY
  readonly current: () => boolean
}
let nextMsOperationId = 0
let deviceOperation: MsOperation | null = null
const refreshOperations = new Map<string, { operation: MsOperation; promise: Promise<Account> }>()
let verifiedThisSession = false
let lastMicrosoftFailure: MicrosoftAuthFailure | undefined

export function microsoftAuthStatus(): MicrosoftAuthStatus {
  return { ...MICROSOFT_IDENTITY, serviceValidation: verifiedThisSession ? 'verified-this-session' : 'unverified',
    reauthenticationRequiredAccounts: listAccounts().filter(a => a.type === 'microsoft' && a.msReauthRequired).length,
    ...(lastMicrosoftFailure ? { lastFailure: { ...lastMicrosoftFailure } } : {}) }
}
function assertCurrent(operation: MsOperation): void {
  if (operation.controller.signal.aborted || !operation.current()) throw new MicrosoftAuthError('CANCELLED', '微软登录')
}
function noteMicrosoftFailure(error: MicrosoftAuthError): void {
  if (error.failure.code !== 'CANCELLED') lastMicrosoftFailure = { ...error.failure }
}
function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const onAbort = (): void => { clearTimeout(timer); signal.removeEventListener('abort', onAbort); reject(new MicrosoftAuthError('CANCELLED', '微软登录')) }
    const timer = setTimeout(() => { signal.removeEventListener('abort', onAbort); resolve() }, ms)
    if (signal.aborted) { onAbort(); return }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}
function useProxy(): boolean {
  try { return getSettings().msUseProxy === true } catch { return false }
}
async function authRequest(operation: MsOperation, stage: string, url: string,
  init: { method?: string; headers?: Record<string, string>; body?: string }, requestDeadline?: number
): Promise<{ data: Record<string, unknown>; status: number; ok: boolean }> {
  assertCurrent(operation)
  try {
    const res = await microsoftFetch(url, { ...init,
      signal: AbortSignal.any([operation.controller.signal, AbortSignal.timeout(requestDeadline === undefined ? 30000 : Math.max(1, Math.min(30000, Math.ceil(requestDeadline - Date.now()))))]), useProxy: useProxy() })
    assertCurrent(operation)
    let data: unknown
    try { data = await res.json() } catch {
      if ([429, 502, 503, 504].includes(res.status)) data = {}
      else throw new MicrosoftAuthError('PROTOCOL_ERROR', stage, res.status)
    }
    assertCurrent(operation)
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new MicrosoftAuthError('PROTOCOL_ERROR', stage, res.status)
    return { data: data as Record<string, unknown>, status: res.status, ok: res.ok }
  } catch (error) {
    if (requestDeadline !== undefined && Date.now() >= requestDeadline && !operation.controller.signal.aborted && operation.current()) throw new MicrosoftAuthError('DEVICE_CODE_EXPIRED', stage)
    throw safeMicrosoftError(error, stage, operation.controller.signal.aborted || !operation.current())
  }
}
function postForm(operation: MsOperation, stage: string, url: string, body: Record<string, string>, requestDeadline?: number) {
  return authRequest(operation, stage, url, { method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body).toString() }, requestDeadline)
}
async function postJson(operation: MsOperation, stage: string, url: string, body: unknown): Promise<Record<string, unknown>> {
  const { data, status, ok } = await authRequest(operation, stage, url, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body) })
  if (!ok) {
    const rejectedApplication = url.endsWith('/authentication/login_with_xbox') &&
      [data.error, data.errorMessage, data.message].some(value => typeof value === 'string' && /invalid app registration/i.test(value))
    throw new MicrosoftAuthError(rejectedApplication ? 'APPLICATION_REJECTED' : status === 429 ? 'RATE_LIMITED' : 'SERVICE_ERROR', stage, status)
  }
  return data
}
async function getJson(operation: MsOperation, stage: string, url: string, bearer: string): Promise<Record<string, unknown>> {
  const { data, status, ok } = await authRequest(operation, stage, url, { headers: { Authorization: 'Bearer ' + bearer } })
  if (!ok) throw new MicrosoftAuthError(status === 429 ? 'RATE_LIMITED' : 'SERVICE_ERROR', stage, status)
  return data
}
function positiveSeconds(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= 2592000 ? value : fallback
}
function requiredToken(value: unknown, stage: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new MicrosoftAuthError('PROTOCOL_ERROR', stage)
  return value
}
function uuidWithHyphens(id: string): string {
  const hex = id.replace(/-/g, '').toLowerCase()
  if (!/^[0-9a-f]{32}$/.test(hex)) throw new MicrosoftAuthError('PROFILE_MISSING', '获取 Minecraft 档案')
  return hex.slice(0, 8) + '-' + hex.slice(8, 12) + '-' + hex.slice(12, 16) + '-' + hex.slice(16, 20) + '-' + hex.slice(20)
}

/** Complete all service checks before binding credentials to KAMUCL or committing an account. */
async function completeMsLogin(operation: MsOperation, msAccessToken: string, refreshToken: string, expiresIn: number,
  select = true, expectedAccount?: Account): Promise<Account> {
  requiredToken(refreshToken, '获取长期授权')
  const xbl = await step('Xbox Live 认证', () => postJson(operation, 'Xbox Live 认证', 'https://user.auth.xboxlive.com/user/authenticate', {
    Properties: { AuthMethod: 'RPS', SiteName: 'user.auth.xboxlive.com', RpsTicket: 'd=' + msAccessToken },
    RelyingParty: 'http://auth.xboxlive.com', TokenType: 'JWT'
  }))
  const xblToken = requiredToken(xbl.Token, 'Xbox Live 认证')
  const xsts = await step('XSTS 授权', () => postJson(operation, 'XSTS 授权', 'https://xsts.auth.xboxlive.com/xsts/authorize', {
    Properties: { SandboxId: 'RETAIL', UserTokens: [xblToken] },
    RelyingParty: 'rp://api.minecraftservices.com/', TokenType: 'JWT'
  }))
  const xstsToken = requiredToken(xsts.Token, 'XSTS 授权')
  const xui = (xsts.DisplayClaims as { xui?: { uhs?: unknown }[] } | undefined)?.xui
  const uhs = Array.isArray(xui) ? xui[0]?.uhs : undefined
  if (typeof uhs !== 'string' || !uhs) throw new MicrosoftAuthError('PROTOCOL_ERROR', 'XSTS 授权')
  const mc = await step('Minecraft 登录', () => postJson(operation, 'Minecraft 登录', 'https://api.minecraftservices.com/authentication/login_with_xbox', {
    identityToken: 'XBL3.0 x=' + uhs + ';' + xstsToken
  }))
  const mcToken = requiredToken(mc.access_token, 'Minecraft 登录')
  const mcExpires = positiveSeconds(mc.expires_in, expiresIn)
  const entitlements = await step('Minecraft 拥有权检查', () => getJson(operation, 'Minecraft 拥有权检查',
    'https://api.minecraftservices.com/entitlements/mcstore', mcToken))
  const items = entitlements.items
  if (!Array.isArray(items)) throw new MicrosoftAuthError('PROTOCOL_ERROR', 'Minecraft 拥有权检查')
  if (!items.some(i => i && typeof i === 'object' && i.name === 'product_minecraft')) throw new MicrosoftAuthError('NOT_OWNED', 'Minecraft 拥有权检查')
  const profile = await step('获取 Minecraft 档案', () => getJson(operation, '获取 Minecraft 档案', 'https://api.minecraftservices.com/minecraft/profile', mcToken))
  if (typeof profile.id !== 'string' || typeof profile.name !== 'string' || !/^[A-Za-z0-9_]{1,16}$/.test(profile.name)) throw new MicrosoftAuthError('PROFILE_MISSING', '获取 Minecraft 档案')
  const uuid = uuidWithHyphens(profile.id)
  if (expectedAccount && uuid.replace(/-/g, '').toLowerCase() !== expectedAccount.uuid.replace(/-/g, '').toLowerCase()) throw new MicrosoftAuthError('ACCOUNT_CHANGED', '刷新微软授权')
  assertCurrent(operation)
  const existing = load().accounts.find(a => a.type === 'microsoft' && a.uuid.replace(/-/g, '').toLowerCase() === uuid.replace(/-/g, '').toLowerCase())
  if (!protectedCredentialStorage(safeStorage) && (process.platform !== 'linux' || (existing && storedSecrets.has(existing.id)))) {
    // New identity metadata must not get paired on disk with old, undecryptable ciphertext.
    throw new MicrosoftAuthError('STORAGE_UNAVAILABLE', '保存账号')
  }
  const account: Account = { id: existing?.id ?? uuid, type: 'microsoft', username: profile.name, uuid,
    accessToken: mcToken, refreshToken, expiresAt: Math.floor(Date.now() / 1000) + mcExpires,
    msOAuthClientId: operation.identity.clientId, msReauthRequired: false, msReauthReason: undefined }
  assertCurrent(operation)
  const saved = upsert(account, select, true)
  verifiedThisSession = true
  lastMicrosoftFailure = undefined
  return saved
}
async function pollDeviceCode(operation: MsOperation, deviceCode: string, intervalSec: number, expiresInSec: number): Promise<Account> {
  let interval = Math.max(1, intervalSec) * 1000
  let nextDelay = interval, temporaryFailures = 0
  const deadline = Date.now() + expiresInSec * 1000
  const { clientId, authority } = operation.identity
  while (Date.now() < deadline) {
    await sleep(Math.min(nextDelay, Math.max(0, deadline - Date.now())), operation.controller.signal)
    assertCurrent(operation)
    if (Date.now() >= deadline) break
    let result: Awaited<ReturnType<typeof postForm>>
    try {
      result = await postForm(operation, '等待微软授权', authority + '/token', {
        client_id: clientId, grant_type: 'urn:ietf:params:oauth:grant-type:device_code', device_code: deviceCode }, deadline)
    } catch (error) {
      const safe = safeMicrosoftError(error, '等待微软授权', operation.controller.signal.aborted || !operation.current())
      if (safe.failure.code !== 'NETWORK_ERROR') throw safe
      temporaryFailures++
      if (temporaryFailures >= 3) throw new MicrosoftAuthError('NETWORK_ERROR', '等待微软授权（连续 3 次临时网络失败）')
      nextDelay = Math.max(interval, Math.min(30000, 5000 * 2 ** (temporaryFailures - 1)))
      continue
    }
    const { data: t, status, ok } = result
    if ([429, 502, 503, 504].includes(status)) {
      temporaryFailures++
      if (temporaryFailures >= 3) throw new MicrosoftAuthError(status === 429 ? 'RATE_LIMITED' : 'SERVICE_ERROR', '等待微软授权（连续 3 次临时服务失败）', status)
      nextDelay = Math.max(interval, Math.min(30000, 5000 * 2 ** (temporaryFailures - 1)))
      continue
    }
    temporaryFailures = 0; nextDelay = interval
    if (ok && typeof t.access_token === 'string' && t.access_token) return completeMsLogin(operation, t.access_token,
      requiredToken(t.refresh_token, '获取长期授权'), positiveSeconds(t.expires_in, 86400))
    if ((status === 400 || ok) && t.error === 'authorization_pending') continue
    if ((status === 400 || ok) && t.error === 'slow_down') { interval += 5000; nextDelay = interval; continue }
    throw oauthResponseError(t, status, '等待微软授权')
  }
  throw new MicrosoftAuthError('DEVICE_CODE_EXPIRED', '等待微软授权')
}
export async function beginMsDeviceCode(onDone: (account: Account | null, error: string | undefined, operationId: string) => void): Promise<MsDeviceCodeInfo> {
  cancelMsLogin()
  const controller = new AbortController()
  const operation: MsOperation = { id: ++nextMsOperationId, publicId: crypto.randomUUID(), controller, identity: MICROSOFT_IDENTITY,
    current: () => deviceOperation === operation }
  deviceOperation = operation
  const signal = controller.signal
  try {
    const { data: dc, status, ok } = await postForm(operation, '获取设备码', operation.identity.authority + '/devicecode', {
      client_id: operation.identity.clientId, scope: operation.identity.scopes })
    assertCurrent(operation)
    if (!ok || typeof dc.device_code !== 'string' || !dc.device_code) throw oauthResponseError(dc, status, '获取设备码')
    if (typeof dc.user_code !== 'string' || !/^[A-Za-z0-9-]{4,32}$/.test(dc.user_code)) throw new MicrosoftAuthError('PROTOCOL_ERROR', '获取设备码')
    const info: MsDeviceCodeInfo = { operationId: operation.publicId, userCode: dc.user_code, verificationUri: microsoftVerificationUri(dc.verification_uri),
      message: '请在微软授权页面输入设备代码 ' + dc.user_code + '，确认应用名称后完成授权。' }
    void pollDeviceCode(operation, dc.device_code, positiveSeconds(dc.interval, 5), positiveSeconds(dc.expires_in, 900))
      .then(account => { assertCurrent(operation); deviceOperation = null; onDone(account, undefined, operation.publicId) })
      .catch(error => {
        const e = safeMicrosoftError(error, '微软登录', signal.aborted || !operation.current())
        if (deviceOperation !== operation) return
        deviceOperation = null
        noteMicrosoftFailure(e)
        if (!signal.aborted) authLog.error('微软登录失败', e)
        const message = e.message
        onDone(null, signal.aborted ? undefined : message, operation.publicId)
      })
    return info
  } catch (error) {
    const safe = safeMicrosoftError(error, '获取设备码', signal.aborted || !operation.current())
    if (deviceOperation === operation) {
      deviceOperation = null; noteMicrosoftFailure(safe)
      if (safe.failure.code !== 'CANCELLED') authLog.error('微软登录步骤失败：获取设备码', safe)
    }
    throw safe
  }
}
/** Cancel initial request, polling and every downstream request; superseded callbacks are silent. */
export function cancelMsLogin(): void {
  deviceOperation?.controller.abort()
  deviceOperation = null
  for (const { operation } of refreshOperations.values()) operation.controller.abort()
  refreshOperations.clear()
}
function assertAccountCanAuthenticate(account: Account): void {
  if (account.type !== 'microsoft' || microsoftReauthReason(account)) throw new MicrosoftAuthError('ACCOUNT_REAUTH_REQUIRED', '微软账号')
}
export async function refreshMicrosoft(account: Account): Promise<Account> {
  assertAccountCanAuthenticate(account)
  if (!account.refreshToken) throw new MicrosoftAuthError('ACCOUNT_REAUTH_REQUIRED', '刷新微软授权')
  const ongoing = refreshOperations.get(account.id)
  if (ongoing) return ongoing.promise
  const original = accountById(account.id)
  if (!original || original.type !== 'microsoft' || original.refreshToken !== account.refreshToken || original.msOAuthClientId !== account.msOAuthClientId) throw new MicrosoftAuthError('ACCOUNT_CHANGED', '刷新微软授权')
  const expectedAccount = { ...account }, controller = new AbortController()
  const operation: MsOperation = { id: ++nextMsOperationId, publicId: crypto.randomUUID(), controller, identity: MICROSOFT_IDENTITY,
    current: () => refreshOperations.get(account.id)?.operation === operation &&
      accountById(account.id)?.refreshToken === expectedAccount.refreshToken &&
      accountById(account.id)?.msOAuthClientId === expectedAccount.msOAuthClientId }
  const promise = Promise.resolve().then(async () => {
    try {
      const { data: t, status, ok } = await postForm(operation, '刷新微软授权', operation.identity.authority + '/token', {
        client_id: operation.identity.clientId, grant_type: 'refresh_token', refresh_token: expectedAccount.refreshToken!, scope: operation.identity.scopes })
      if (!ok || typeof t.access_token !== 'string' || !t.access_token) throw oauthResponseError(t, status, '刷新微软授权')
      return await completeMsLogin(operation, t.access_token,
        typeof t.refresh_token === 'string' && t.refresh_token ? t.refresh_token : expectedAccount.refreshToken!, positiveSeconds(t.expires_in, 86400), false, expectedAccount)
    } catch (error) {
      const safe = safeMicrosoftError(error, '刷新微软授权', controller.signal.aborted || !operation.current())
      noteMicrosoftFailure(safe)
      throw safe
    } finally {
      if (refreshOperations.get(account.id)?.operation === operation) refreshOperations.delete(account.id)
    }
  })
  refreshOperations.set(account.id, { operation, promise })
  return promise
}
export async function getValidAccount(account: Account): Promise<Account> {
  if (account.type === 'offline') return account
  if (account.type === 'yggdrasil') {
    const refreshed = await yggdrasil.refreshAccount(account)
    if (refreshed !== account) upsert(refreshed, false)
    return refreshed
  }
  assertAccountCanAuthenticate(account)
  const now = Math.floor(Date.now() / 1000)
  if (!account.accessToken || !account.expiresAt || account.expiresAt - now < 300) return refreshMicrosoft(account)
  return account
}
export async function refreshAccountById(id: string): Promise<Account> {
  const account = load().accounts.find(item => item.id === id)
  if (!account) throw new Error('账号不存在')
  return publicAccount(await getValidAccount(account))
}
