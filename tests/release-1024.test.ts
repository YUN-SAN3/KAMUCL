import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'

const read = (file: string) => fs.readFileSync(file, 'utf8')

test('fix-1: edit panel footer pinned at bottom, body pure scrollable (个性化面板溢出)', () => {
  const ep = read('src/renderer/src/components/EditPanel.vue')
  // 主题码+恢复默认移出滚动区，钉在底部
  assert.match(ep, /class="ep-foot"/)
  const footIdx = ep.indexOf('ep-foot')
  const bodyIdx = ep.indexOf('ep-body')
  assert.ok(footIdx > bodyIdx, 'ep-foot 必须在 ep-body 之后（底部）')
  assert.match(ep, /\.ep-foot \{[\s\S]*?flex-shrink: 0/)
  assert.match(ep, /border-top: 1px solid var\(--border\)/)
  // 滚动区保持 overflow-y auto
  assert.match(ep, /\.ep-body \{[\s\S]*?overflow-y: auto/)
})

test('fix-2: game process CWD wired through CreateProcessW lpCurrentDirectory (启动 CWD)', () => {
  const gc = read('src/main/core/gracefulClose.ts')
  assert.match(gc, /lpCurrentDirectory 显式传游戏目录/)
  assert.match(gc, /cwdBuf = cwd \? Buffer\.from\(cwd \+ '\\0', 'utf16le'\) : null/)
  assert.match(gc, /api\.createProcess\(cmdline, outPipe\.write, errPipe\.write, options\.cwd\)/)
  assert.match(gc, /api\.createProcess\(cmdline, 0, 0, options\.cwd \?\? ''\)/)
})

test('fix-3: manual update check retries once + explicit 3-state feedback (手动检查更新)', () => {
  const su = read('src/main/core/selfUpdate.ts')
  assert.match(su, /for \(let attempt = 0; attempt < 2; attempt\+\+\)/)
  assert.match(su, /1\.5s 后重试一次/)
  const sv = read('src/renderer/src/views/SettingsView.vue')
  assert.match(sv, /发现新版本 v\$\{r\.release\.version\}，是否更新？/)
  assert.match(sv, /当前版本已是最新！/)
  assert.match(sv, /检查失败：断网或更新源不可达（已记日志）/)
})

test('fix-4: home 3D preview renders cape when worn, same as skins page (首页披风)', () => {
  const home = read('src/renderer/src/views/HomeView.vue')
  assert.match(home, /const activeCape = computed/)
  assert.match(home, /:cape="activeCape"/)
  assert.match(home, /capes\?\.find\(\(c\) => c\.active\)/)
})

test('fix-5: home memory display follows the auto toggle (首页内存跟随)', () => {
  const home = read('src/renderer/src/views/HomeView.vue')
  const mem = home.match(/const memoryText = computed\(\(\) => \{[\s\S]*?\}\)/)![0]
  assert.match(mem, /memoryAuto === true/)
  assert.match(mem, /return '自动'/)
})

test('fix-6: missing folder deadlock resolved — prompt card + remove works even for last/default (失效文件夹)', () => {
  const gv = read('src/renderer/src/views/GameView.vue')
  assert.match(gv, /folder-missing-card/)
  assert.match(gv, /在启动器内移除该绑定/)
  assert.match(gv, /稍后处理/)
  assert.match(gv, /removeMissingFolder/)
  const gf = read('src/main/core/gameFolders.ts')
  // 最后一个/默认文件夹也允许移除：自动重建内置默认
  assert.doesNotMatch(gf, /至少需要保留一个游戏文件夹/)
  assert.match(gf, /自动重建内置默认文件夹/)
})

test('fix-7: builtin CurseForge API key wired as default (CF 下载)', () => {
  const c = read('src/main/core/community.ts')
  assert.match(c, /CF_BUILTIN_KEY = '\$2a\$10\$m36VLjTaHEqxr/)
  assert.match(c, /curseforgeApiKey\?\.trim\(\) \|\| CF_BUILTIN_KEY/)
  assert.match(c, /'x-api-key': ch\.key/)
})

test('1.0.24 changed SFCs compile', () => {
  for (const file of [
    'src/renderer/src/components/EditPanel.vue',
    'src/renderer/src/views/HomeView.vue',
    'src/renderer/src/views/GameView.vue',
    'src/renderer/src/views/SettingsView.vue',
  ]) {
    const source = read(file)
    const { descriptor, errors } = parse(source)
    assert.deepEqual(errors, [], file)
    const script = compileScript(descriptor, { id: file })
    const result = compileTemplate({ source: descriptor.template!.content, filename: file, id: file, compilerOptions: { bindingMetadata: script.bindings } })
    assert.deepEqual(result.errors, [], file)
  }
})
