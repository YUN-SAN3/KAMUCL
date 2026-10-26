import test from 'node:test'
import assert from 'node:assert/strict'
import { privateServerText, serverAddressRevealed } from '../src/shared/serverPrivacy'

test('server display hides addresses in aliases and errors without modifying connection data', () => {
  for (const [address, host, text] of [
    ['192.0.2.10:25567', '192.0.2.10', '服务器 192.0.2.10:25567 无法连接 192.0.2.10'],
    ['mc.example.test', 'mc.example.test', '连接 MC.EXAMPLE.TEST:25565'],
    ['[2001:db8::1]:25566', '2001:db8::1', '服务器 [2001:db8::1]:25566 未连接 2001:db8::1']
  ]) {
    const server = { id: 'a', address, host }
    const before = structuredClone(server)
    const hidden = privateServerText(text, server)
    assert(!hidden.toLowerCase().includes(host.toLowerCase()))
    assert(!hidden.includes(':2556'))
    assert.equal(privateServerText(text, server, true), text)
    assert.deepEqual(server, before)
  }
})

test('server privacy does not replace partial unrelated addresses or letters in names', () => {
  assert.equal(privateServerText('192.0.2.100 建筑世界', { address: '192.0.2.10' }), '192.0.2.100 建筑世界')
  assert.equal(privateServerText('Creative r 生存', { address: 'r' }), 'Creative 地址已隐藏 生存')
})

test('revealing one server never reveals a changed address or another entry', () => {
  const server = { id: 'one', address: '192.0.2.10' }
  assert.equal(serverAddressRevealed(server, null), false)
  const visible = { ...server }
  assert.equal(serverAddressRevealed(server, visible), true)
  assert.equal(serverAddressRevealed({ ...server, id: 'two' }, visible), false)
  assert.equal(serverAddressRevealed({ ...server, address: '192.0.2.11' }, visible), false)
})

test('server prose hides IPv4 and complete ports next to Chinese or IP labels', () => {
  const server = { address: '127.0.0.1:25565', host: '127.0.0.1' }
  for (const text of ['服务器IP为127.0.0.1欢迎加入', 'IP127.0.0.1欢迎加入', '地址：127.0.0.1:25565欢迎加入', 'IP127.0.0.1:25565欢迎加入']) {
    const hidden = privateServerText(text, server)
    assert(!hidden.includes('127.0.0.1'))
    assert(!hidden.includes('25565'))
    assert.equal(privateServerText(text, server, true), text)
  }
  for (const other of ['127.0.0.10', '2127.0.0.1', '127.0.0.1.5', '127.0.0.1:255650']) assert.equal(privateServerText(other, server), other)
})

test('server prose keeps DNS and IPv6 identity while masking adjoining Chinese descriptions', () => {
  const dns = { address: 'mc.example.test', host: 'mc.example.test' }
  assert.equal(privateServerText('欢迎mc.example.test:25565加入', dns), '欢迎地址已隐藏加入')
  for (const other of ['notmc.example.test', 'mc.example.test.net', 'mc.example.test-2']) assert.equal(privateServerText(other, dns), other)
  const ipv6 = { address: '[2001:db8::1]:25565', host: '2001:db8::1' }
  assert.equal(privateServerText('欢迎[2001:db8::1]:25565加入', ipv6), '欢迎地址已隐藏加入')
  assert.equal(privateServerText('欢迎2001:db8::1加入', ipv6), '欢迎地址已隐藏加入')
  assert.equal(privateServerText('2001:db8::10', ipv6), '2001:db8::10')
})
