/**
 * 「默认配置 / options.txt 同步」版本矩阵表驱动测试。
 * 每行 = 选项输入 × MC 版本区间 → 期望写入 options.txt 的字段与原始行文本。
 * 证据：minecraft.wiki/w/Options.txt（graphics → 1.16 graphicsMode → 1.21.11 graphicsPreset，
 * dev 25w41a；toggleCrouch/toggleSprint 19w41a/1.15；autoJump 16w20a/1.10；fov 全版本 0-1 浮点）
 * + 真实 options.txt 实证（1.12.2 fov:0.5、26.2 fov:0.375）。
 * 纯逻辑测试：直接 import 版本解析与行生成函数，不触碰 fs / electron。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  adaptOptionsForVersion,
  compareMcVersions,
  fovDegreesToStored,
  fovStoredToDegrees,
  mcVersionAtLeast,
  parseSnapshotId,
  serializeResourcePacks
} from '../src/shared/keybindings'
import { mergeKeysIntoOptions } from '../src/main/core/keybindings'

/** 与 UI 存储一致的「其他配置」默认集合（fov/gamma/sensitivity 为度数/0-1，graphicsPreset 为 preset 标识） */
const DEFAULTS: Record<string, string> = {
  fov: '90',
  gamma: '0.8',
  mouseSensitivity: '1',
  renderDistance: '16',
  graphicsPreset: 'fabulous',
  maxFps: '260',
  enableVsync: 'true',
  toggleCrouch: 'true',
  toggleSprint: 'true',
  autoJump: 'true'
}

interface MatrixRow {
  /** 版本区间说明 */
  bracket: string
  /** MC 版本 id（实例 _mcVersion / 链底 id） */
  version: string
  /** 期望的完整适配输出（未列出的键不应存在于输出） */
  expect: Record<string, string>
}

/** 图像品质在三段分界下的期望字段 */
function graphics(bracket: 'pre1.16' | 'mode' | 'preset'): Record<string, string> {
  if (bracket === 'preset') return { graphicsPreset: '"fabulous"' }
  if (bracket === 'mode') return { graphicsMode: '2' }
  return { graphics: '1' } // 1.16 前无 fabulous(2)，极佳回退高品质(1)
}

const MATRIX: MatrixRow[] = [
  // 第一档：1.7 / 1.12（无 toggle、无 autoJump、graphics 数字 0/1、fov 浮点）
  {
    bracket: '1.7/1.12',
    version: '1.7.10',
    expect: {
      fov: '0.75', gamma: '0.8', mouseSensitivity: '1', renderDistance: '16',
      maxFps: '260', enableVsync: 'true', ...graphics('pre1.16')
    }
  },
  {
    bracket: '1.7/1.12',
    version: '1.12.2',
    expect: {
      fov: '0.75', gamma: '0.8', mouseSensitivity: '1', renderDistance: '16',
      maxFps: '260', enableVsync: 'true', autoJump: 'true', ...graphics('pre1.16')
    }
  },
  // 第二档：1.15-1.21（toggle 在 1.15 起写入；autoJump 1.10 起写入；graphicsMode 自 1.16）
  {
    bracket: '1.15-1.21',
    version: '1.15.2',
    expect: {
      fov: '0.75', gamma: '0.8', mouseSensitivity: '1', renderDistance: '16',
      maxFps: '260', enableVsync: 'true', toggleCrouch: 'true', toggleSprint: 'true',
      autoJump: 'true', ...graphics('pre1.16')
    }
  },
  {
    bracket: '1.15-1.21',
    version: '1.16.1',
    expect: {
      fov: '0.75', gamma: '0.8', mouseSensitivity: '1', renderDistance: '16',
      maxFps: '260', enableVsync: 'true', toggleCrouch: 'true', toggleSprint: 'true',
      autoJump: 'true', ...graphics('mode')
    }
  },
  {
    bracket: '1.15-1.21',
    version: '1.20.1',
    expect: {
      fov: '0.75', gamma: '0.8', mouseSensitivity: '1', renderDistance: '16',
      maxFps: '260', enableVsync: 'true', toggleCrouch: 'true', toggleSprint: 'true',
      autoJump: 'true', ...graphics('mode')
    }
  },
  {
    bracket: '1.15-1.21',
    version: '1.21.10',
    expect: {
      fov: '0.75', gamma: '0.8', mouseSensitivity: '1', renderDistance: '16',
      maxFps: '260', enableVsync: 'true', toggleCrouch: 'true', toggleSprint: 'true',
      autoJump: 'true', ...graphics('mode')
    }
  },
  // 第三档：1.21.11+（graphicsPreset 带引号 JSON 串）
  {
    bracket: '1.21.11+',
    version: '1.21.11',
    expect: {
      fov: '0.75', gamma: '0.8', mouseSensitivity: '1', renderDistance: '16',
      maxFps: '260', enableVsync: 'true', toggleCrouch: 'true', toggleSprint: 'true',
      autoJump: 'true', ...graphics('preset')
    }
  },
  {
    bracket: '1.21.11+',
    version: '1.21.11-pre1',
    expect: {
      fov: '0.75', gamma: '0.8', mouseSensitivity: '1', renderDistance: '16',
      maxFps: '260', enableVsync: 'true', toggleCrouch: 'true', toggleSprint: 'true',
      autoJump: 'true', ...graphics('preset')
    }
  },
  {
    bracket: '1.21.11+',
    version: '25w41a',
    expect: {
      fov: '0.75', gamma: '0.8', mouseSensitivity: '1', renderDistance: '16',
      maxFps: '260', enableVsync: 'true', toggleCrouch: 'true', toggleSprint: 'true',
      autoJump: 'true', ...graphics('preset')
    }
  },
  // 第四档：26.x 新版号与快照
  {
    bracket: '26.x',
    version: '26.2',
    expect: {
      fov: '0.75', gamma: '0.8', mouseSensitivity: '1', renderDistance: '16',
      maxFps: '260', enableVsync: 'true', toggleCrouch: 'true', toggleSprint: 'true',
      autoJump: 'true', ...graphics('preset')
    }
  },
  {
    bracket: '26.x',
    version: '26w05a',
    expect: {
      fov: '0.75', gamma: '0.8', mouseSensitivity: '1', renderDistance: '16',
      maxFps: '260', enableVsync: 'true', toggleCrouch: 'true', toggleSprint: 'true',
      autoJump: 'true', ...graphics('preset')
    }
  },
  {
    bracket: '26.x',
    version: '26.2-snapshot-1',
    expect: {
      fov: '0.75', gamma: '0.8', mouseSensitivity: '1', renderDistance: '16',
      maxFps: '260', enableVsync: 'true', toggleCrouch: 'true', toggleSprint: 'true',
      autoJump: 'true', ...graphics('preset')
    }
  },
  // 分界周前一周的快照必须落回旧字段（25w40a 属 1.21.10 周期）
  {
    bracket: '1.15-1.21',
    version: '25w40a',
    expect: {
      fov: '0.75', gamma: '0.8', mouseSensitivity: '1', renderDistance: '16',
      maxFps: '260', enableVsync: 'true', toggleCrouch: 'true', toggleSprint: 'true',
      autoJump: 'true', ...graphics('mode')
    }
  }
]

test('config matrix: option × version bracket → exact fields written', () => {
  for (const row of MATRIX) {
    const out = adaptOptionsForVersion(DEFAULTS, row.version)
    const keys = new Set([...Object.keys(out), ...Object.keys(row.expect)])
    for (const key of keys) {
      assert.equal(
        out[key],
        row.expect[key],
        `[${row.bracket}] ${row.version}: field "${key}" expected ${JSON.stringify(row.expect[key])}, got ${JSON.stringify(out[key])}`
      )
    }
  }
})

test('config matrix: raw options.txt line text for representative cells', () => {
  const line = (version: string, input: Record<string, string>): string =>
    mergeKeysIntoOptions('', adaptOptionsForVersion(input, version)).trim()

  // FOV：所有版本统一 0-1 浮点（90° → 0.75），历史 bug 为写整数度数
  for (const v of ['1.7.10', '1.12.2', '1.15.2', '1.16.1', '1.20.1', '1.21.10', '1.21.11', '25w40a', '25w41a', '26.2', '26w05a']) {
    assert(line(v, { fov: '90' }).includes('fov:0.75'), `fov line must be fov:0.75 for ${v}`)
  }
  // 图像品质三段
  assert.equal(line('1.12.2', { graphicsPreset: 'fancy' }), 'graphics:1')
  assert.equal(line('1.12.2', { graphicsPreset: 'fast' }), 'graphics:0')
  assert.equal(line('1.20.1', { graphicsPreset: 'fancy' }), 'graphicsMode:1')
  assert.equal(line('1.20.1', { graphicsPreset: 'fabulous' }), 'graphicsMode:2')
  assert.equal(line('1.21.11', { graphicsPreset: 'fancy' }), 'graphicsPreset:"fancy"')
  assert.equal(line('26.2', { graphicsPreset: 'fancy' }), 'graphicsPreset:"fancy"')
  assert.equal(line('25w41a', { graphicsPreset: 'fast' }), 'graphicsPreset:"fast"')
  // 潜行/疾跑：1.15 分界（含快照分界周 19w41a）
  assert.equal(line('1.12.2', { toggleCrouch: 'true', toggleSprint: 'true' }), '')
  assert.equal(line('18w50a', { toggleCrouch: 'true' }), '')
  assert.equal(line('19w41a', { toggleCrouch: 'true' }), 'toggleCrouch:true')
  assert.equal(line('1.15', { toggleSprint: 'false' }), 'toggleSprint:false')
  // 自动跳跃：1.10 分界（16w20a）
  assert.equal(line('1.8.9', { autoJump: 'true' }), '')
  assert.equal(line('16w19a', { autoJump: 'true' }), '')
  assert.equal(line('16w20a', { autoJump: 'true' }), 'autoJump:true')
  // 各版本字段一致项
  assert.equal(line('1.12.2', { renderDistance: '12' }), 'renderDistance:12')
  assert.equal(line('26.2', { renderDistance: '12' }), 'renderDistance:12')
  assert.equal(line('1.20.1', { enableVsync: 'false' }), 'enableVsync:false')
  assert.equal(line('26.2', { maxFps: '260' }), 'maxFps:260')
  assert.equal(line('1.16.1', { gamma: '1' }), 'gamma:1')
  assert.equal(line('1.21.11', { mouseSensitivity: '0.5' }), 'mouseSensitivity:0.5')
  // resourcePacks 不经 adapt 改写（由同步层 serializeResourcePacks 处理）；无输入不产生行
  assert.equal(adaptOptionsForVersion({ resourcePacks: 'file/a.zip' }, '26.2').resourcePacks, 'file/a.zip')
  assert.equal(line('26.2', {}), '')
  assert.equal(
    mergeKeysIntoOptions('', { resourcePacks: serializeResourcePacks('file/a.zip, vanilla')! }).trim(),
    'resourcePacks:["file/a.zip","vanilla"]'
  )
})

test('fov conversion: display degrees ↔ stored float ↔ in-game degrees use one formula (30 + x*80)', () => {
  assert.equal(fovDegreesToStored(90), 0.75)
  assert.equal(fovDegreesToStored(30), 0)
  assert.equal(fovDegreesToStored(110), 1)
  assert.equal(fovDegreesToStored(70), 0.5)
  assert.equal(fovStoredToDegrees(0.75), 90)
  // 全量往返一致（1° 步进）
  for (let d = 30; d <= 110; d++) {
    assert.equal(fovStoredToDegrees(fovDegreesToStored(d)), d, `roundtrip ${d}°`)
  }
  // 越界输入 clamp 到 0-1
  assert.equal(fovDegreesToStored(0), 0)
  assert.equal(fovDegreesToStored(200), 1)
})

test('resourcePacks serialization: quoted JSON array, zip gets file/ prefix, escaping intact', () => {
  assert.equal(serializeResourcePacks(''), null)
  assert.equal(serializeResourcePacks('  '), null)
  assert.equal(serializeResourcePacks('vanilla'), '["vanilla"]')
  assert.equal(serializeResourcePacks('a.zip, b'), '["file/a.zip","b"]')
  // 中文包名原样保留（UTF-8 写入；现代 MC 按 UTF-8 读取）
  assert.equal(serializeResourcePacks('我的材质包.zip'), '["file/我的材质包.zip"]')
  // 含引号的包名被 JSON 转义，解析回原值（反斜杠/斜杠是 Windows 非法文件名字符，按路径分隔归一）
  const weird = 'we"ird.zip'
  const parsed = JSON.parse(serializeResourcePacks(weird)!) as string[]
  assert.deepEqual(parsed, ['file/we"ird.zip'])
  // 路径分隔符归一为文件名（Windows 反斜杠拖入）
  assert.equal(serializeResourcePacks('C:\\packs\\x.zip'), '["file/x.zip"]')
})

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

test('multi-instance safety: same stored defaults adapt differently per instance version', () => {
  const legacy = adaptOptionsForVersion(DEFAULTS, '1.12.2')
  const modern = adaptOptionsForVersion(DEFAULTS, '26.2')
  assert.equal(legacy.graphics, '1')
  assert.equal(modern.graphicsPreset, '"fabulous"')
  assert.equal('graphicsMode' in legacy, false)
  assert.equal('graphics' in modern, false)
  // 未知/空版本按最新处理：不丢同步项
  const unknown = adaptOptionsForVersion(DEFAULTS, '')
  assert.equal(unknown.graphicsPreset, '"fabulous"')
  assert.equal(unknown.toggleCrouch, 'true')
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
