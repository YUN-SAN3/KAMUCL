// Mount the real Vue view in an isolated Electron renderer; only IPC/data are fixtures.
// Run: node_modules/electron/dist/electron.exe scripts/verify-community-ui.cjs
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict')
const { app, BrowserWindow } = require('electron')
const { build } = require('esbuild')
const { parse, compileScript } = require('@vue/compiler-sfc')
const root = fs.mkdtempSync(path.resolve('out/community-ui-'))
app.setPath('userData', path.join(root, 'userData'))
const sourcePath = path.resolve('src/renderer/src/views/CommunityView.vue')
const mocks = {
  api: `export const errText = String;
    export const getManifest = async()=>[{id:'26.2',type:'release'},{id:'1.20.1',type:'release'}];
    export const getModTargets = async()=>({versions:[],errors:[]});
    export const communityDownload = async()=>'';
    export async function communitySearch(q){
      window.qa.calls.push({...q});
      if(window.qa.hold){window.qa.hold=false;await new Promise(r=>window.qa.release=r)}
      const total=q.source==='all'?52:44;
      return {total,offset:q.offset,limit:q.limit,items:Array.from({length:Math.max(0,Math.min(q.limit,total-q.offset))},(_,i)=>({source:q.source==='all'?'curseforge':q.source,projectId:String(q.offset+i),slug:'fixture',title:q.kind+' '+(q.offset+i),author:'Fixture',description:'Pagination and filter fixture',downloads:10,updatedAt:'2026-09-10',categories:[],iconUrl:''}))};
    }
    export async function communityFiles(source,id,filter){window.qa.files.push({source,id,...filter});return [{fileId:'fixture',fileName:'compatible.zip',version:'1',gameVersions:[filter.mcVersion],loaders:[],date:'2026-09-10',size:120,releaseType:'release'}]}`,
  store: `import {reactive} from 'vue';
    export const store=reactive({installed:[{id:'fabric-fixture',mcVersion:'26.2',loader:'fabric',folder:'fixture'}],settings:{theme:'light'},searchKeyword:''});
    export const toast=()=>{};window.qa.store=store;`
}
app.whenReady().then(async () => {
  const compiled = await build({
    stdin: { contents: `import {createApp} from 'vue';import View from ${JSON.stringify(sourcePath)};createApp(View).mount('#app')`, resolveDir: process.cwd() },
    bundle: true, write: false, format: 'iife', platform: 'browser', define: { __VUE_OPTIONS_API__: 'true', __VUE_PROD_DEVTOOLS__: 'false', __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: 'false', 'process.env.NODE_ENV': '"development"' },
    plugins: [{ name: 'view-fixture', setup(b) {
      b.onResolve({ filter: /^\.\.\/(api|store)$/ }, args => ({ path: args.path.endsWith('api') ? 'api' : 'store', namespace: 'qa' }))
      b.onLoad({ filter: /.*/, namespace: 'qa' }, args => ({ contents: mocks[args.path], loader: 'js', resolveDir: process.cwd() }))
      b.onResolve({ filter: /^@shared\// }, args => ({ path: path.resolve('src/shared', args.path.slice(8) + '.ts') }))
      b.onLoad({ filter: /\.vue$/ }, args => {
        if (args.path !== sourcePath) return { contents: `import {h} from 'vue';export default {props:['text'],render(){return h('span',this.text)}}`, loader: 'js', resolveDir: process.cwd() }
        return { contents: compileScript(parse(fs.readFileSync(args.path, 'utf8')).descriptor, { id: 'community-qa', inlineTemplate: true }).content, loader: 'ts', resolveDir: path.dirname(args.path) }
      })
    } }]
  })
  const css = fs.readFileSync('src/renderer/src/styles.css', 'utf8') + '\n' + parse(fs.readFileSync(sourcePath, 'utf8')).descriptor.styles[0].content
  fs.writeFileSync(path.join(root, 'ui.js'), compiled.outputFiles[0].text)
  fs.writeFileSync(path.join(root, 'index.html'), `<meta charset="utf-8"><style>${css}\nbody{overflow:auto;padding:24px;height:auto}#app{min-height:100vh}</style><div id="app"></div><script>window.qa={calls:[],files:[],errors:[]};window.addEventListener('error',e=>qa.errors.push(e.message))</script><script src="ui.js"></script>`)
  const win = new BrowserWindow({ show: false, width: 1140, height: 820, webPreferences: { contextIsolation: true, backgroundThrottling: false, offscreen: true } })
  const run = code => win.webContents.executeJavaScript(code)
  const wait = ms => new Promise(r => setTimeout(r, ms))
  const click = selector => run(`document.querySelector(${JSON.stringify(selector)}).click()`)
  const last = () => run('qa.calls.at(-1)')
  await win.loadFile(path.join(root, 'index.html')); await wait(500)
  const measurements = []
  for (const kind of ['modpack', 'resourcepack', 'shader', 'datapack', 'shader', 'resourcepack', 'mod']) {
    await click(`[data-kind="${kind}"]`); await wait(420)
    const r = await run(`(()=>{const a=document.querySelector('.capsule.active').getBoundingClientRect(),b=document.querySelector('.capsule-blob').getBoundingClientRect();return {kind:document.querySelector('.capsule.active').dataset.kind,dx:a.x-b.x,dy:a.y-b.y,dw:a.width-b.width,dh:a.height-b.height,width:b.width}})()`)
    assert.equal(r.kind, kind); assert(r.width > 0)
    for (const key of ['dx', 'dy', 'dw', 'dh']) assert(Math.abs(r[key]) <= 1.5, JSON.stringify(r))
    assert.equal((await last()).kind, kind)
    measurements.push(r)
  }
  await click('[data-kind="resourcepack"]'); await wait(100)
  assert.equal((await last()).loader, undefined)
  assert.equal(await run('document.querySelectorAll(".search-card .filter-row:last-child select").length'), 2)
  assert.equal(await run('document.querySelectorAll(".more-sentinel").length'), 0)
  assert.match(await run('document.querySelector(".pagination").textContent'), /共 52 项/)
  await run(`Array.from(document.querySelectorAll('.pagination button')).find(b=>b.textContent==='2').click()`); await wait(120)
  assert.equal((await last()).offset, 20)
  assert.equal(await run('document.querySelectorAll(".result-card").length'), 20)
  assert.match(await run('document.querySelector(".result-card").textContent'), /resourcepack 20/)
  await run(`Array.from(document.querySelectorAll('.pagination button')).find(b=>b.textContent==='3').click()`); await wait(120)
  assert.equal((await last()).offset, 40)
  assert.equal(await run('document.querySelectorAll(".result-card").length'), 12)
  assert(await run(`Array.from(document.querySelectorAll('.pagination button')).find(b=>b.textContent==='下一页').disabled`))
  const beforeScroll = await run('qa.calls.length')
  await run('window.scrollTo(0,document.body.scrollHeight)'); await wait(350)
  assert.equal(await run('qa.calls.length'), beforeScroll)
  await run(`const select=document.querySelector('.search-card .filter-row:last-child select');select.value='modrinth';select.dispatchEvent(new Event('change',{bubbles:true}))`); await wait(100)
  assert.equal((await last()).offset, 0); assert.equal((await last()).source, 'modrinth')
  await run(`const v=document.querySelector('.ver-filter-input');v.value='1.20.1';v.dispatchEvent(new Event('input',{bubbles:true}));v.dispatchEvent(new Event('change',{bubbles:true}))`); await wait(100)
  assert.equal((await last()).mcVersion, '1.20.1')
  // Stale source/kind replies must not replace the active tab's results.
  await run('qa.hold=true'); await click('[data-kind="shader"]'); await click('[data-kind="datapack"]'); await wait(100)
  await run('qa.release()'); await wait(100)
  assert.match(await run('document.querySelector(".result-card").textContent'), /datapack 0/)
  await click('.result-dl'); await wait(120)
  assert.equal((await run('qa.files.at(-1)')).kind, 'datapack')
  assert.equal((await run('qa.files.at(-1)')).loader, undefined)
  assert.equal(await run('document.querySelectorAll(".modal-field select").length'), 0)
  assert.equal(await run('document.querySelectorAll(".file-row").length'), 1)
  await run(`document.querySelector('.modal-actions button').click()`)
  await run(`document.querySelector('.kind-capsules').style.width='180px';qa.store.settings.theme='pink'`); await wait(450)
  const wrap = await run(`(()=>{const a=document.querySelector('.capsule.active').getBoundingClientRect(),b=document.querySelector('.capsule-blob').getBoundingClientRect();return {y:a.y-b.y,x:a.x-b.x,top:document.querySelector('.capsule.active').offsetTop}})()`)
  assert(wrap.top > 3); assert(Math.abs(wrap.y) <= 1.5); assert(Math.abs(wrap.x) <= 1.5)
  assert.deepEqual(await run('qa.errors'), [])
  await run(`document.querySelector('.kind-capsules').style.width='';window.scrollTo(0,0)`); await wait(450)
  fs.writeFileSync(path.join(root, 'screenshot.png'), (await win.webContents.capturePage()).toPNG())
  await run('window.scrollTo(0,document.body.scrollHeight)'); await wait(300)
  fs.writeFileSync(path.join(root, 'pagination.png'), (await win.webContents.capturePage()).toPNG())
  fs.writeFileSync(path.join(root, 'result.json'), JSON.stringify({ pass: true, measurements, wrap, calls: await run('qa.calls') }, null, 2))
  console.log('PASS real Vue community UI: ' + root)
  win.destroy(); app.quit()
}).catch(e => { fs.writeFileSync(path.join(root, 'error.txt'), e.stack || String(e)); console.error(e); app.exit(1) })
