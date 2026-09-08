/**
 * MC 版本族解析 + 键位合并矩阵测试（原「默认配置 options 同步」矩阵随 1.0.12 功能移除而下线）。
 * 证据：快照/正式版版本族分界（minecraft.wiki + 实测）。纯逻辑测试，不触碰 fs / electron。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { compareMcVersions, mcVersionAtLeast, parseSnapshotId } from '../src/shared/keybindings'
import { mergeKeysIntoOptions } from '../src/main/core/keybindings'

test('version comparison: 26.x > all 1.x; numeric segments (1.21.11 > 1.21.9); snapshots by year-week', () => {
  assert(mcVersionAtLeast('26.2', '1.21.11'))
  assert(mcVersionAtLeast('26w05a', '1.21.11'))
  assert(mcVersionAtLeast('1.21.11', '1.21.9'))
  assert(!mcVersionAtLeast('1.21.10', '1.21.11'))
  assert(!mcVersionAtLeast('1.12.2', '1.13'))
  assert(mcVersionAtLeast('1.13', '1.13'))
  assert(mcVersionAtLeast('', '1.18'))
  // 快照按开发周期归属版本族
  assert(mcVersionAtLeast('25w41a', '1.21.11'))
  assert(!mcVersionAtLeast('25w40a', '1.21.11'))
  assert(mcVersionAtLeast('19w41a', '1.15'))
  assert(!mcVersionAtLeast('18w50a', '1.15'))
  assert(mcVersionAtLeast('17w43a', '1.13'))
  assert(!mcVersionAtLeast('17w31a', '1.13'))
  assert(mcVersionAtLeast('16w20a', '1.10'))
  assert(!mcVersionAtLeast('16w19a', '1.10'))
  assert(mcVersionAtLeast('20w06a', '1.16'))
  assert(!mcVersionAtLeast('19w44a', '1.16'))
  // pre/rc/snapshot 后缀视为对应正式版
  assert(mcVersionAtLeast('1.21.11-pre1', '1.21.11'))
  assert(mcVersionAtLeast('26.2-snapshot-1', '1.21.11'))
  assert(mcVersionAtLeast('1.14 Pre-Release 2', '1.13'))
  // 快照内部按年周排序
  assert.equal(compareMcVersions('25w41a', '25w40a'), 1)
  assert.equal(compareMcVersions('24w46a', '25w01a'), -1)
  assert.ok(parseSnapshotId('25w41a'))
  assert.equal(parseSnapshotId('1.21.11'), null)
})


test('mergeKeysIntoOptions: overwrite registered keys, keep other lines, LF endings, trailing newline', () => {
  const before = 'lang:zh_cn\r\nfov:0.5\r\ncustomLine:keep\n'
  const after = mergeKeysIntoOptions(before, { fov: '0.75', graphicsPreset: '"fancy"' })
  assert.match(after, /fov:0\.75/)
  assert.match(after, /lang:zh_cn/)
  assert.match(after, /customLine:keep/)
  assert.match(after, /graphicsPreset:"fancy"/)
  assert(!after.includes('\r'), 'CRLF must be normalized to LF (MC saves with \\n)')
  assert(after.endsWith('\n'), 'file ends with newline')
  // 已有同键行不重复
  assert.equal(after.split('\n').filter((l) => l.startsWith('fov:')).length, 1)
})
