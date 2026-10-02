import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { recycleVersion } from '../src/main/core/versionRemoval'
import { parseFrpLine, frpLineReader } from '../src/main/core/frpLog'

test('FRP 中文成功日志、通用域名与运营商地址，地址不能单独证明连接成功', () => {
  assert.equal(parseFrpLine('[ru***w4z.Kamutest] 隧道启动成功').status, 'running')
  assert.equal(parseFrpLine('隧道启动失败').status, 'error')
  assert.equal(parseFrpLine('start proxy success').status, 'running')
  const operator = parseFrpLine('- 移动: yd.frp-hub.com:36238')
  const general = parseFrpLine('需要输 IP:端口 的地方，写 frp-hub.com:36238')
  assert.equal(operator.address, 'yd.frp-hub.com:36238')
  assert.equal(operator.status, null)
  assert.equal(general.address, 'frp-hub.com:36238')
  assert(general.priority > operator.priority)
  assert.equal(parseFrpLine('本地服务: 127.0.0.1:11111').address, null)
  assert.equal(parseFrpLine('远程地址: foo.example.com:99999').address, null)
  assert.equal(parseFrpLine('login to server failed').status, 'auth_failed')
})

test('FRP UTF-8 任意字节分片、独立输出流及无换行尾部', () => {
  const lines: string[] = [], other: string[] = []
  const a = frpLineReader(l => lines.push(l)), b = frpLineReader(l => other.push(l))
  const input = '需要输 IP:端口 的地方，写 frp-hub.com:36238\r\n隧道启动成功'
  for (const byte of Buffer.from(input)) { a.write(Buffer.from([byte])); }
  b.write(Buffer.from('隧道启动失败\n')); a.end(); b.end()
  assert.deepEqual(lines, input.split('\r\n')); assert.deepEqual(other, ['隧道启动失败'])
})

test('删除失败不预删描述文件或存档；固定目录、拒绝越界及占用', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'kamucl-delete-1082-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const dir = path.join(root, 'versions', '中文 版本')
  await fs.mkdir(path.join(dir, 'saves'), { recursive: true })
  await fs.writeFile(path.join(dir, '中文 版本.json'), '{}')
  await fs.writeFile(path.join(dir, 'saves', 'level.dat'), 'keep')
  const deps = { assertIdle: async () => {}, trash: async () => { throw new Error('EPERM') } }
  await assert.rejects(recycleVersion(root, '中文 版本', deps), /回收站.*权限/s)
  assert.equal(await fs.readFile(path.join(dir, '中文 版本.json'), 'utf8'), '{}')
  assert.equal(await fs.readFile(path.join(dir, 'saves', 'level.dat'), 'utf8'), 'keep')
  let called = false
  const safe = { assertIdle: async () => { throw new Error('正在运行') }, trash: async () => { called = true } }
  await assert.rejects(recycleVersion(root, '中文 版本', safe), /正在运行/)
  for (const id of ['../outside', '..', '.', 'C:\\outside', 'bad:ads']) await assert.rejects(recycleVersion(root, id, safe), /无效|超出/)
  assert.equal(called, false)
  await recycleVersion(root, '中文 版本', { assertIdle: async () => {}, trash: async target => {
    assert.equal(target, dir); await fs.rename(target, path.join(root, 'recycled'))
  } })
  assert.equal(await fs.readFile(path.join(root, 'recycled', 'saves', 'level.dat'), 'utf8'), 'keep')
})

test('删除拒绝目录链接，不接触链接目标', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'kamucl-links-1082-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  await fs.mkdir(path.join(root, 'versions')); await fs.mkdir(path.join(root, 'outside'))
  await fs.symlink(path.join(root, 'outside'), path.join(root, 'versions', 'linked'), 'junction')
  await assert.rejects(recycleVersion(root, 'linked', { assertIdle: async () => {}, trash: async () => { assert.fail('must not recycle link') } }), /链接/)
  assert((await fs.stat(path.join(root, 'outside'))).isDirectory())
})
