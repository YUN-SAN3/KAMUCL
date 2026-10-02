import assert from 'node:assert/strict'
import test from 'node:test'
import { windowAppearance } from '../src/main/windowAppearance'
import { clampToWorkArea, dominantDisplay, isPhantomBounds } from '../src/main/windowState'
import type { Display } from 'electron'

test('Windows 主窗口使用真正透明背景和 DWM Acrylic 材质', () => {
  const options = windowAppearance('win32')
  assert.equal(options.frame, false)
  assert.equal(options.transparent, false)
  assert.equal(options.backgroundColor, '#00000000')
  assert.equal(options.backgroundMaterial, 'acrylic')
  assert.equal(options.roundedCorners, true)
  assert.equal(options.thickFrame, true)
})

test('macOS 清空原生窗口底色以透出毛玻璃，保留系统红绿灯', () => {
  const options = windowAppearance('darwin')
  assert.equal(options.transparent, true)
  assert.equal(options.frame, true)
  assert.equal(options.titleBarStyle, 'hiddenInset')
  assert.equal(options.vibrancy, 'sidebar')
  assert.equal(options.visualEffectState, 'active')
  assert.deepEqual(options.trafficLightPosition, { x: 16, y: 16 })
  assert.equal(options.backgroundColor, '#00000000')
  assert.equal(options.backgroundMaterial, undefined)
})

// ---------------- 窗口跨屏修复：幻影坐标 + 主屏判定 + 工作区夹紧 ----------------

const mkDisplay = (x: number, y: number, width: number, height: number): Display =>
  ({
    workArea: { x, y, width, height },
    bounds: { x, y, width, height }
  }) as unknown as Display

const displays = [mkDisplay(0, 0, 1920, 1040), mkDisplay(1920, 0, 2560, 1392), mkDisplay(-1200, 0, 1200, 1000)]

test('幻影坐标判定：最小化关闭留下的 -32000 位置必须判无效', () => {
  assert.equal(isPhantomBounds({ x: -32000, y: -32000 }), true)
  assert.equal(isPhantomBounds({ x: -32000, y: 100 }), true)
  assert.equal(isPhantomBounds({ x: 100, y: -32000 }), true)
  // 副屏在主屏左侧时的合法负坐标不能误伤
  assert.equal(isPhantomBounds({ x: -1200, y: 0 }), false)
  assert.equal(isPhantomBounds({ x: 100, y: 100 }), false)
})

test('主屏判定取相交面积最大者：骑缝窗口归入占多数的一侧', () => {
  // 100px 骑在副屏(-1200)、其余在主屏 → 归主屏
  const mostlyPrimary = dominantDisplay(displays, { x: -100, y: 0, width: 1200, height: 800 })
  assert.equal(mostlyPrimary, displays[0])
  // 大部分在右侧屏 → 归右侧屏
  const mostlyRight = dominantDisplay(displays, { x: 2000, y: 100, width: 1200, height: 800 })
  assert.equal(mostlyRight, displays[1])
  // 完全离屏 → null（回落默认居中）
  assert.equal(dominantDisplay(displays, { x: 9999, y: 9999, width: 800, height: 600 }), null)
})

test('位置夹紧：跨屏边与超出工作区的窗口被拉回单屏完整可见', () => {
  // 右边超出主屏 → 拉回
  assert.deepEqual(clampToWorkArea({ x: 1500, y: 100, width: 800, height: 600 }, displays[0].workArea), {
    x: 1120,
    y: 100
  })
  // 左侧越界 → 拉回左侧屏工作区内（右缘对齐工作区右缘，完整可见）
  assert.deepEqual(clampToWorkArea({ x: -300, y: -100, width: 800, height: 600 }, displays[2].workArea), {
    x: -800,
    y: 0
  })
  // 正常位置不动
  assert.deepEqual(clampToWorkArea({ x: 100, y: 50, width: 800, height: 600 }, displays[0].workArea), {
    x: 100,
    y: 50
  })
  // 窗口比工作区还大 → 对齐工作区左上角
  assert.deepEqual(clampToWorkArea({ x: 500, y: 500, width: 4000, height: 2000 }, displays[0].workArea), {
    x: 0,
    y: 0
  })
})
