import fs from 'node:fs'
import path from 'node:path'
import net from 'node:net'
import crypto from 'node:crypto'
import { app } from 'electron'
import type { Account, SkinVariant } from '../../shared/types'
import { getOfflineSkin } from './skins'
import { ensureAuthlibInjector } from './yggdrasil'

export interface OfflineSkinLaunch {
  args: string[]
  releasePort(): Promise<void>
  dispose(): Promise<void>
}
type Snapshot = { filePath: string; sha256: string; variant: SkinVariant }

/** Leave shared cache work running, but detach a cancelled launch immediately.
 * Callers must check their signal before allocating any launch-owned resource. */
function waitForResult<T>(work: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return work
  return new Promise<T>((resolve, reject) => {
    const abort = () => { signal.removeEventListener('abort', abort); reject(signal.reason ?? new DOMException('已取消', 'AbortError')) }
    signal.addEventListener('abort', abort, { once: true })
    work.then(value => { signal.removeEventListener('abort', abort); resolve(value) }, error => { signal.removeEventListener('abort', abort); reject(error) })
    if (signal.aborted) abort()
  })
}

/** Both the PNG provider and authlib hook live in the game JVM. Closing the
 * launcher therefore never takes away a running game's texture source. */
export async function prepareOfflineSkinLaunch(account: Account, signal?: AbortSignal): Promise<OfflineSkinLaunch | null> {
  signal?.throwIfAborted()
  if (account.type !== 'offline') return null
  account = { ...account }
  const snapshot = await waitForResult(getOfflineSkin(account.id), signal)
  signal?.throwIfAborted()
  if (!snapshot) return null
  const agent = path.join(__dirname, 'kamucl-offline-skin.jar').replace('app.asar', 'app.asar.unpacked')
  if (!fs.existsSync(agent)) throw new Error('离线皮肤加载组件缺失，请重新安装启动器')
  const injector = await waitForResult(ensureAuthlibInjector(), signal)
  signal?.throwIfAborted()
  const launch = await createOfflineSkinLaunch(account, snapshot, agent, injector, path.join(app.getPath('userData'), 'offline-skin-sessions'), signal)
  try { signal?.throwIfAborted(); return launch }
  catch (error) { await launch.dispose(); throw error }
}

/** Exported for native JVM contract tests; callers cannot configure a remote
 * endpoint, arbitrary HTTP route or authentication response. */
export async function createOfflineSkinLaunch(account: Account, snapshot: Snapshot, agent: string, injector: string, directory: string, signal?: AbortSignal): Promise<OfflineSkinLaunch> {
  signal?.throwIfAborted()
  account = { ...account }
  if (account.type !== 'offline' || !/^(?:[a-f\d]{32}|[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12})$/i.test(account.uuid) || !account.username || account.username.length > 64 || /[\u0000-\u001f\u007f]/.test(account.username)) throw new Error('离线账号身份无效，无法应用皮肤')
  const png = fs.readFileSync(snapshot.filePath)
  if (png.length < 24 || png.length > 1024 * 1024 || png.readUInt32BE(0) !== 0x89504e47 || png.readUInt32BE(16) !== 64 || png.readUInt32BE(20) !== 64 || crypto.createHash('sha256').update(png).digest('hex') !== snapshot.sha256 || !['classic', 'slim'].includes(snapshot.variant)) throw new Error('离线皮肤文件已变化或无效，请重新应用皮肤')
  // Generate before reserving the socket: a crypto failure must not leak a
  // listening reservation, and key generation should not block the UI thread.
  const keys = await waitForResult(new Promise<{ publicKey: Buffer; privateKey: Buffer }>((resolve, reject) => crypto.generateKeyPair('rsa', { modulusLength: 2048, publicKeyEncoding: { type: 'spki', format: 'der' }, privateKeyEncoding: { type: 'pkcs8', format: 'der' } }, (error, publicKey, privateKey) => error ? reject(error) : resolve({ publicKey, privateKey }))), signal)
  signal?.throwIfAborted()
  const nonce = crypto.randomBytes(32).toString('hex')
  const config = path.join(directory, `${crypto.randomUUID()}.properties`), temp = config + '.tmp'
  // This socket only reserves a port. Never accept a connection that can hold
  // server.close() open after the launch deadline has ended.
  const reservation = net.createServer(socket => socket.destroy())
  // Keep existing launcher UUIDs intact. Offline servers use Java's standard
  // name UUID; accept that one alias for this same captured player as well.
  const serverUuid = crypto.createHash('md5').update(`OfflinePlayer:${account.username}`, 'utf8').digest()
  serverUuid[6] = (serverUuid[6] & 0x0f) | 0x30; serverUuid[8] = (serverUuid[8] & 0x3f) | 0x80
  let released = false
  const releasePort = async () => {
    if (released) return
    released = true
    if (!reservation.listening) return
    await new Promise<void>((resolve, reject) => reservation.close(error => error ? reject(error) : resolve()))
  }
  const dispose = async () => {
    const failures: unknown[] = []
    try { await releasePort() } catch (error) { failures.push(error) }
    for (const file of [config, temp]) { try { fs.unlinkSync(file) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') failures.push(error) } }
    if (failures.length) throw new AggregateError(failures, '离线皮肤临时会话清理失败')
  }
  try {
    signal?.throwIfAborted()
    await new Promise<void>((resolve, reject) => { reservation.once('error', reject); reservation.listen(0, '127.0.0.1', () => { reservation.removeListener('error', reject); resolve() }) })
    reservation.unref()
    signal?.throwIfAborted()
    const port = (reservation.address() as net.AddressInfo).port
    const root = `http://127.0.0.1:${port}/${nonce}/`
    const metadata = JSON.stringify({ meta: { serverName: 'KAMUCL Offline Appearance', 'feature.no_mojang_namespace': true, 'feature.username_check': true }, skinDomains: ['127.0.0.1'], signaturePublickey: `-----BEGIN PUBLIC KEY-----\n${keys.publicKey.toString('base64')}\n-----END PUBLIC KEY-----` })
    const values = { port: String(port), nonce, uuid: account.uuid.replaceAll('-', '').toLowerCase(), serverUuid: serverUuid.toString('hex'), username64: Buffer.from(account.username, 'utf8').toString('base64'), sha256: snapshot.sha256, variant: snapshot.variant, png: png.toString('base64'), privateKey: keys.privateKey.toString('base64'), publicKey: keys.publicKey.toString('base64') }
    fs.mkdirSync(directory, { recursive: true })
    signal?.throwIfAborted()
    fs.writeFileSync(temp, Object.entries(values).map(([key, value]) => `${key}=${value}`).join('\n') + '\n', { mode: 0o600, flag: 'wx' })
    signal?.throwIfAborted()
    fs.renameSync(temp, config)
    signal?.throwIfAborted()
    return { args: [`-javaagent:${agent}=${Buffer.from(config, 'utf8').toString('base64url')}`, `-javaagent:${injector}=${root}`, `-Dauthlibinjector.yggdrasil.prefetched=${Buffer.from(metadata, 'utf8').toString('base64')}`, '-Dauthlibinjector.noShowServerName', '-Dauthlibinjector.mojangNamespace=disabled'], releasePort, dispose }
  } catch (error) { await dispose(); throw error }
}
