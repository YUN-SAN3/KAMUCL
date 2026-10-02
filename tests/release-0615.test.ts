import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import { EventEmitter } from 'node:events'
import { mcmodSearchUrl } from '../src/shared/communityLinks'
import { THEME_PRESETS } from '../src/shared/types'
import { trackMaterialLifecycle } from '../src/main/materialLifecycle'

test('百科仅发送原始英文名称，不包含中文译名（卡片与弹窗共用）', () => {
  for (const item of [
    { title: '农夫乐事 | Farmer’s Delight', originalTitle: 'Farmer’s Delight', slug: 'farmers-delight' },
    { title: '农夫乐事 | Farmer’s Delight', slug: 'farmers-delight' }
  ]) assert.equal(new URL(mcmodSearchUrl(item)!).searchParams.get('key'), 'Farmer’s Delight')
  assert.equal(new URL(mcmodSearchUrl({ title: '中文名', slug: 'english-mod' })!).searchParams.get('key'), 'english mod')
  assert.equal(mcmodSearchUrl({ title: '中文名', slug: '中文' }), null)
})

test('默认黑紫主题与设置预览共用紫色，其他主题不变', () => {
  assert.equal(THEME_PRESETS.transparent.colors.accent, '#9475ed')
  assert.equal(THEME_PRESETS['black-orange'].colors.accent, '#f97316')
  const settings = fs.readFileSync('src/renderer/src/views/SettingsView.vue', 'utf8')
  assert.match(settings, /named\('transparent'\)/)
  assert.match(settings, /theme\.colors\.accent/)
})

test('窗口状态切换只修复原生边框，不反复安装毛玻璃；关闭取消刷新', async () => {
  const events = new EventEmitter()
  const calls: string[] = []
  const errors: string[] = []
  let restored = 0
  trackMaterialLifecycle(Object.assign(events, {
    isDestroyed: () => false,
    setBackgroundMaterial: (s: string) => { calls.push(s) }
  }), m => errors.push(m), () => { restored++ })
  for (const e of ['show', 'maximize', 'unmaximize', 'restore', 'leave-full-screen']) {
    events.emit(e)
    await new Promise(r => setTimeout(r, 160))
    assert.deepEqual(calls, [])
  }
  events.emit('maximize'); events.emit('closed')
  await new Promise(r => setTimeout(r, 160))
  assert.deepEqual(calls, [])
  assert.deepEqual(errors, [])
  assert.equal(restored, 5)
})

test('最大化/show/focus 合并修复；切屏返回节流，不重复刷新材质', async () => {
  const events = new EventEmitter()
  const calls: string[] = []
  trackMaterialLifecycle(Object.assign(events, {
    isDestroyed: () => false,
    setBackgroundMaterial: (s: string) => { calls.push(s) }
  }), () => {}, () => { calls.push('repair') })
  events.emit('maximize')
  events.emit('show')
  events.emit('focus')
  events.emit('focus') // 立即重复 focus 被节流吞掉
  await new Promise(r => setTimeout(r, 200))
  assert.deepEqual(calls, ['repair'])
  events.emit('focus')
  await new Promise(r => setTimeout(r, 200))
  assert.deepEqual(calls.splice(0), ['repair'], '1s 内的 focus 被节流')
  await new Promise(r => setTimeout(r, 1100))
  events.emit('focus')
  await new Promise(r => setTimeout(r, 200))
  assert.deepEqual(calls, ['repair'], '超过节流窗口后检查原生边框')
})

test('最小化/隐藏时不触碰 DWM，恢复可重试；原生失败上报且不循环刷新', async () => {
  const events = new EventEmitter(), errors: string[] = []
  let minimized = true, visible = true, calls = 0
  const refresh = trackMaterialLifecycle(Object.assign(events, {
    isDestroyed: () => false, isMinimized: () => minimized, isVisible: () => visible
  }), error => errors.push(error), () => { calls++; throw Error('fixture') })
  refresh(); await new Promise(r => setTimeout(r, 160)); assert.equal(calls, 0)
  minimized = false; visible = false
  events.emit('show'); await new Promise(r => setTimeout(r, 160)); assert.equal(calls, 0)
  visible = true
  events.emit('restore'); await new Promise(r => setTimeout(r, 320))
  assert.equal(calls, 1); assert.equal(errors.length, 1)
  events.emit('closed'); refresh(); await new Promise(r => setTimeout(r, 160))
  assert.equal(calls, 1)
})

test('只在启动淡入完成后释放分层状态，隐藏期间完成也保留到恢复时', async () => {
  const events = new EventEmitter(), calls: boolean[] = []
  let visible = true
  trackMaterialLifecycle(Object.assign(events, { isDestroyed: () => false, isVisible: () => visible }),
    () => {}, finished => calls.push(!!finished))
  events.emit('show'); await new Promise(r => setTimeout(r, 160))
  assert.deepEqual(calls, [false], '淡入途中不能清除原生透明度')
  visible = false; events.emit('kamucl:startup-opacity-complete')
  await new Promise(r => setTimeout(r, 160)); assert.deepEqual(calls, [false])
  visible = true; events.emit('restore'); events.emit('focus')
  await new Promise(r => setTimeout(r, 160)); assert.deepEqual(calls, [false, true])
  events.emit('maximize'); await new Promise(r => setTimeout(r, 160))
  assert.deepEqual(calls, [false, true, true])
  events.emit('closed')
})

test('便携包模板引用含空格/中文的TEMP路径，失败明确提示而非静默退出', () => {
  const require = createRequire(import.meta.url)
  const { repairPortableScript } = require('../scripts/portable-build-hook.cjs')
  const script = fs.readFileSync('node_modules/app-builder-lib/templates/nsis/portable.nsi', 'utf8')
  const fixed = repairPortableScript(script)
  assert.ok(fixed.includes(`ExecWait '"$INSTDIR\\\${APP_EXECUTABLE_FILENAME}" $R0' $0`))
  assert.ok(fixed.includes('IfErrors'))
  // 解压目标：exe 所在文件夹的固定子目录，不再落系统 TEMP 随机目录
  assert.ok(fixed.includes('StrCpy $INSTDIR "$EXEDIR\\KAMUCL-runtime"'))
  assert.ok(!fixed.includes('StrCpy $INSTDIR "$PLUGINSDIR\\app"'))
  assert.equal(repairPortableScript(fixed), fixed)
  assert.throws(() => repairPortableScript('unexpected template'), /template changed/)
  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'))
  assert.equal(pkg.build.beforePack, 'scripts/portable-build-hook.cjs')
  assert.equal(pkg.build.portable.unpackDirName, false)
  assert.ok(pkg.build.win.target.includes('zip'))
})
