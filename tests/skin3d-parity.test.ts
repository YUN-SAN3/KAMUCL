import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

/**
 * 3D 人物渲染对齐 skinview3d v3.4.2（参考/skinview3d-master，MIT）的专项回归：
 * 锁定本次审计修复的三处真实渲染瑕疵，防止后续回退。
 */
const read = (file: string) => fs.readFileSync(file, 'utf8')

test('skin3d parity: -y bottom face UV follows skinview3d uvBottom vertex order (no bowtie twist)', () => {
  const viewer = read('src/renderer/src/components/SkinViewer3D.vue')
  // three.js BoxGeometry 的 ny 面顶点序 = 前左/前右/后左/后右（vdir=-1，与其他面相反）；
  // skinview3d setUVs：uvBottom = [bottom[0], bottom[1], bottom[3], bottom[2]]
  // → 前缘贴区域下边、后缘贴区域上边、u 不镜像。后缘 u 反接会让底面前后边 u 相互反转（蝶形扭曲）。
  const m = viewer.match(/if \(f === 3\) \{[\s\S]*?\} else \{/)
  assert.ok(m, 'mapBoxUVs 底面分支存在')
  assert.match(m[0], /setXY\(o \+ 0, u0, vBot\)/)
  assert.match(m[0], /setXY\(o \+ 1, u1, vBot\)/)
  assert.match(m[0], /setXY\(o \+ 2, u0, vTop\)/)
  assert.match(m[0], /setXY\(o \+ 3, u1, vTop\)/)
  // 披风（64×32 纹理）的底面（下摆）同一约定
  const cape = viewer.match(/\/\/ 与 mapBoxUVs 相同的 -y 底面约定[\s\S]*?\} else \{/)
  assert.ok(cape, '披风底面分支存在')
  assert.match(cape[0], /setXY\(o \+ 2, u0, vTop\)/)
  assert.match(cape[0], /setXY\(o \+ 3, u1, vTop\)/)
})

test('skin3d parity: walking arms swing on X only + constant 0.02π outward Z tilt (skinview3d WalkAnimation)', () => {
  const viewer = read('src/renderer/src/components/SkinViewer3D.vue')
  // FCL 的臂 Y 轴副摆（±20°@20°/s）会把内前/内后角切进与躯干齐平的手臂（穿透 0.56~0.63px）
  assert.ok(!/subRate: 20/.test(viewer), '手臂 Y 副摆已移除')
  assert.match(viewer, /const ARM_BASE_TILT = Math\.PI \* 0\.02/)
  assert.match(viewer, /joints\.armL\.rotation\.z = ARM_BASE_TILT/)
  assert.match(viewer, /joints\.armR\.rotation\.z = -ARM_BASE_TILT/)
  // FCL 主摆参数保留（用户要过的手感）：臂 ±10°@30°/s、腿 ±30°@90°/s
  assert.match(viewer, /mainRate: 30, mainAmp: 10/)
  assert.match(viewer, /mainRate: 90, mainAmp: 30/)
})

test('skin3d parity: cape keeps skinview3d standard 10x16x1 with flip mount (no 8-wide regression)', () => {
  const viewer = read('src/renderer/src/components/SkinViewer3D.vue')
  assert.match(viewer, /new THREE\.BoxGeometry\(10, 16, 1\)/)
  assert.match(viewer, /faceRegions\(1, 1, 10, 16, 1\)/)
  assert.match(viewer, /rotation\.y = Math\.PI/)
})
