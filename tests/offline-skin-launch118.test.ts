import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import http from 'node:http'
import net from 'node:net'
import sharp from 'sharp'
import { spawn, execFileSync } from 'node:child_process'
import { createOfflineSkinLaunch } from '../src/main/core/offlineSkinLaunch'
import type { Account } from '../src/shared/types'

const javaRoot = process.env.JAVA_HOME || (process.platform === 'win32' ? 'C:/Program Files/Java/jdk-25.0.2' : '')
const tool = (name: string) => javaRoot ? path.join(javaRoot, 'bin', name + (process.platform === 'win32' ? '.exe' : '')) : name
const agent = path.resolve('offline-skin-agent/dist/kamucl-offline-skin.jar')
// A complete original PNG generated without user data; the producer's validation
// is covered separately. These tests also execute the bundled Java bytecode.
const pngReady = sharp({ create: { width:64, height:64, channels:4, background:{ r:37, g:177, b:145, alpha:1 } } }).png().toBuffer()
let built = false
function build(root: string) {
  if (!built) { execFileSync(process.execPath, ['scripts/build-offline-skin-agent.cjs'], { stdio: 'pipe', windowsHide: true, env: { ...process.env, ...(javaRoot ? { JAVA_HOME: javaRoot } : {}) } }); built = true }
  execFileSync(tool('javac'), ['--release', '8', '-d', root, 'tests/fixtures/OfflineSkinProbe.java'], { stdio: 'pipe', windowsHide: true })
}
function request(url: string, method = 'GET', body?: string, headers: Record<string,string> = {}): Promise<{ status: number; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const call = http.request(url, { method, headers: { ...(body ? { 'content-length': Buffer.byteLength(body) } : {}), ...headers } }, response => {
      const chunks: Buffer[] = []; response.on('data', data => chunks.push(data)); response.on('end', () => resolve({ status: response.statusCode!, body: Buffer.concat(chunks) }))
    }); call.setTimeout(5000, () => call.destroy(new Error('probe request timeout'))); call.on('error', reject); call.end(body)
  })
}
async function fixture(t: any, username = 'OfflineSkinProbe', variant: 'classic'|'slim' = 'slim') {
  const png = await pngReady
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'KAMUCL 离线皮肤118 ')); build(root)
  const skin = path.join(root, '皮肤 § 1.png'); fs.writeFileSync(skin, png)
  const account: Account = { id: 'test-only', type: 'offline', uuid: 'c430be75-2e7a-37ab-839f-44d28d4a52f0', username }
  const launch = await createOfflineSkinLaunch(account, { filePath: skin, sha256: crypto.createHash('sha256').update(png).digest('hex'), variant }, agent, 'unused-test-injector.jar', root)
  const address = launch.args[1].split('=')[1]
  const config = Buffer.from(launch.args[0].split('=')[1], 'base64url').toString('utf8')
  await launch.releasePort()
  const child = spawn(tool('java'), [launch.args[0], '-cp', root, 'OfflineSkinProbe'], { windowsHide: true, stdio: ['pipe','pipe','pipe'] })
  let stderr = ''; child.stderr.on('data', data => { stderr += data.toString() })
  const closed = new Promise<number|null>(resolve => child.once('close', resolve))
  let done = false
  t.after(async () => { if (!done) child.stdin.end('x'); await closed; await launch.dispose(); fs.rmSync(root, { recursive: true, force: true }) })
  await new Promise<void>((resolve, reject) => {
    let output = ''; const timeout = setTimeout(() => reject(new Error('JVM skin probe did not become ready: ' + stderr)), 15000)
    child.stdout.on('data', data => { output += data.toString(); if (output.includes('PROBE_READY')) { clearTimeout(timeout); resolve() } })
    child.once('error', error => { clearTimeout(timeout); reject(error) }); child.once('close', code => { clearTimeout(timeout); reject(new Error('JVM skin probe closed: '+code+' '+stderr)) })
  })
  return { root, skin, png, account, launch, address, config, child, finish: async () => { done = true; child.stdin.end('x'); assert.equal(await closed, 0, stderr) } }
}

test('actual game-JVM provider signs matching classic/slim PNG and only serves its own account', async t => {
  for (const variant of ['classic','slim'] as const) {
    const f = await fixture(t, 'OfflineSkinProbe', variant)
    assert.equal(fs.existsSync(f.config), false, 'premain consumes and deletes its temporary signing config')
    const metadata = JSON.parse((await request(f.address)).body.toString())
    const response = await request(f.address + 'sessionserver/session/minecraft/profile/' + f.account.uuid.replaceAll('-', ''))
    assert.equal(response.status, 200)
    const profile = JSON.parse(response.body.toString()), prop = profile.properties[0]
    assert.equal(crypto.verify('RSA-SHA1', Buffer.from(prop.value), metadata.signaturePublickey, Buffer.from(prop.signature, 'base64')), true)
    const texture = JSON.parse(Buffer.from(prop.value, 'base64').toString())
    assert.equal(texture.profileId, profile.id); assert.equal(texture.profileName, f.account.username)
    assert.equal(texture.textures.SKIN.metadata?.model, variant === 'slim' ? 'slim' : undefined)
    assert.deepEqual((await request(texture.textures.SKIN.url)).body, f.png)
    assert.equal((await request(f.address + 'sessionserver/session/minecraft/profile/' + '0'.repeat(32))).status, 204)
    assert.equal((await request(new URL('/textures/private.png', f.address).href)).status, 404)
    assert.equal((await request(f.address + '../../accounts.json')).status, 404)
    assert.equal((await request(f.address, 'GET', undefined, { host: 'example.com' })).status, 400)
    assert.equal((await request(f.address + 'sessionserver/session/minecraft/join', 'POST', '{}')).status, 403, 'this provider cannot authenticate access to a server')
    await f.finish()
    await assert.rejects(request(f.address), /ECONNREFUSED/)
  }
})

test('Unicode names, offline-server UUID alias and disconnecting the launcher preserve the local snapshot', async t => {
  const f = await fixture(t, '玩家_皮肤')
  const names = await request(f.address + 'api/profiles/minecraft', 'POST', JSON.stringify(['Other', f.account.username]))
  assert.equal(names.status, 200); assert.equal(JSON.parse(names.body.toString())[0].name, f.account.username)
  assert.equal((await request(f.address + 'api/profiles/minecraft', 'POST', '["bad",]')).status, 400)
  const digest = crypto.createHash('md5').update('OfflinePlayer:' + f.account.username).digest(); digest[6] = (digest[6] & 15) | 48; digest[8] = (digest[8] & 63) | 128
  const profile = JSON.parse((await request(f.address + 'sessionserver/session/minecraft/profile/' + digest.toString('hex'))).body.toString())
  assert.equal(profile.id, digest.toString('hex'))
  // Dispose exactly what launcher exit/failed preparation would own. The bytes
  // are now in the game JVM and stay available without launcher files/sockets.
  await f.launch.dispose(); fs.unlinkSync(f.skin)
  const texture = JSON.parse(Buffer.from(profile.properties[0].value, 'base64').toString())
  assert.deepEqual((await request(texture.textures.SKIN.url)).body, f.png)
  await f.finish()
})

test('invalid or changed local snapshots never allocate a launch config or modify the original PNG', async () => {
  const png = await pngReady
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'KAMUCL offline reject ')), skin = path.join(root, 'skin.png'); fs.writeFileSync(skin, png)
  try {
    await assert.rejects(createOfflineSkinLaunch({ id:'test', type:'offline', uuid:'a'.repeat(32), username:'Test' }, { filePath:skin, sha256:'0'.repeat(64), variant:'classic' }, agent, 'unused.jar', root), /已变化或无效/)
    assert.deepEqual(fs.readdirSync(root), ['skin.png']); assert.deepEqual(fs.readFileSync(skin), png)
  } finally { fs.rmSync(root, { recursive:true, force:true }) }
})

test('an idle connection to the reservation cannot hold game launch or cleanup open', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'KAMUCL offline reservation ')), skin = path.join(root,'skin.png'), png = await pngReady
  fs.writeFileSync(skin,png)
  const launch = await createOfflineSkinLaunch({id:'idle-probe',type:'offline',uuid:'a'.repeat(32),username:'Test'}, {filePath:skin,sha256:crypto.createHash('sha256').update(png).digest('hex'),variant:'classic'},agent,'unused.jar',root)
  const socket = net.connect(Number(new URL(launch.args[1].split('=')[1]).port),'127.0.0.1')
  socket.on('error',()=>{})
  try {
    await new Promise<void>(resolve=>socket.once('connect',resolve))
    let timer: NodeJS.Timeout | undefined
    await Promise.race([launch.releasePort(),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error('Idle reservation held launch open')),1000)})]).finally(()=>clearTimeout(timer))
  } finally {socket.destroy();await launch.dispose();fs.rmSync(root,{recursive:true,force:true})}
})
