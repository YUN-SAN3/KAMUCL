// Real production renderer, isolated IPC fixtures: no accounts, games or downloads are touched.
// Run after build: node_modules/electron/dist/electron.exe scripts/verify-design-ui.cjs
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict')
const { app, BrowserWindow, ipcMain, session, protocol, nativeImage } = require('electron')
const { buildSync } = require('esbuild')
const root = fs.mkdtempSync(path.resolve('out/network-ui-'))
app.setPath('userData', path.join(root, 'userData'))
protocol.registerSchemesAsPrivileged([{scheme:'kamucl-asset',privileges:{standard:true,secure:true,supportFetchAPI:true}}]);
app.commandLine.appendSwitch('enable-unsafe-swiftshader')
buildSync({ entryPoints: ['src/shared/types.ts'], bundle: true, platform: 'node', format: 'cjs', outfile: path.join(root, 'types.cjs') })
const types = require(path.join(root, 'types.cjs'))
buildSync({ entryPoints: ['src/main/core/defaultGameOptions.ts'], bundle: true, platform: 'node', format: 'cjs', external: ['electron'], outfile: path.join(root, 'gameOptions.cjs') })
const gameOptions = require(path.join(root, 'gameOptions.cjs'))
buildSync({ entryPoints: ['src/main/core/exitJournal.ts'], bundle: true, platform: 'node', format: 'cjs', outfile: path.join(root, 'exitJournal.cjs') })
const journal = new (require(path.join(root, 'exitJournal.cjs')).ExitJournal)(path.join(root, 'exit-history.json'))
journal.fault('launcher', '上次启动器未正常关闭，已保留异常退出记录。')
journal.fault('game', '游戏「测试实例」异常退出（代码 -1）。')
const folder = 'C:/Design fixture/.minecraft'
const versions = ['26.2-Fabric 0.19.5', '1.21.11-NeoForge Adventures', '1.21.10-Forge Survival', '26.2 Creative'].map((name, i) => ({ id: name, name, mcVersion: i === 1 ? '1.21.11' : '26.2', loader: i === 3 ? undefined : 'fabric', loaderVersion: '0.19.5', folder, isolated: true, modpackName: i === 3 ? 'Creative 整合包' : undefined }))
let draft=null;const files=Array.from({length:240},(_,i)=>({name:String(i).padStart(4,'0')+'.jar'+(i%3===0?'.disabled':''),size:(i+1)*1024,isDir:false,mtime:Date.now()-i*10000}));const locks=new Set(['0002.jar']);let failManifest=false;let migrationResolve;
let settings = { gameDir: folder, activeFolder: folder, folders: [{ path: folder, name: '我的游戏', isDefault: true }], javaPath: '', javaAuto: true, javaCustom: [], javaHidden: [], memoryMB: 4096, memoryAuto: true, jvmArgs: '', resolution: { width: 854, height: 480, mode: 'windowed' }, mirror: 'bmclapi', theme: 'blue-white', custom: types.DEFAULT_CUSTOM_THEME, disabledFeatures: [], favoriteVersions: [], homeLayout: types.DEFAULT_HOME_LAYOUT, background: types.DEFAULT_BACKGROUND, launchThumbnail: types.DEFAULT_LAUNCH_THUMBNAIL, configVersion: 1 }
const account = { id: 'fixture', type: 'offline', username: 'KaMuaMua', uuid: '00000000000000000000000000000000' }
const calls = [], errors = []
const updateRelease = { version:'1.0.46', tag:'v1.0.46', publishedAt:'2026-09-10T14:04:00Z', assetSize:67616046, body:'KAMUCL v1.0.46\n\n- 修复：皮肤重命名后恢复默认名称的问题\n- 优化：默认配置的分组、数值输入和同步状态', assetUrl:'https://example.invalid/test.exe' }
let vox={joinedAt:Date.now()-25000,state:'in_room',pending:false,room:{name:'测试房间',currentPlayers:2,maxPlayers:8},session:{state:'in_room',code:'ABCDEF',isHost:false},settings:{allowRelay:true},connection:{phase:'p2p',status:'failed',detail:'打洞重试中'},stages:{punch:{key:'punch',status:'retry',detail:'打洞重试中',ts:Date.now()-25000}}};let tcReady=false;const requests=[];
ipcMain.handle('design:invoke', (_event, channel, ...args) => {
  calls.push(channel);requests.push({channel,args})
  switch (channel) {
    case 'fs:list': return files;
    case 'tc:status': return {phase:'idle',binaryReady:tcReady,running:false};
    case 'tc:install': tcReady=true;return null;
    case 'voxlink:status': return vox;
    case 'voxlink:stop': vox={...vox,state:'idle',session:{state:'idle',code:'',isHost:false},room:null,joinedAt:0,stages:{}};return vox;
    case 'voxlink:useTurnRelay': return {ok:true};
    case 'frp:status': return {status:'idle',config:null,logs:[],message:'尚未启动'};
    case 'frp:nodes': return {nodes:[{id:7,name:'测试免费节点',free:true,online:true,canCreate:true,load:12}],tunnels:[{id:123,name:'我的生存世界',type:'tcp',node:7,nodeName:'测试免费节点',localIp:'127.0.0.1',localPort:25566,status:0}]};
    case 'frp:create-tunnel': return {id:123};
    case 'update:check': return {ok:true,hasUpdate:true,release:updateRelease}
    case 'update:start': return {taskId:'fixture-update'}
    case 'update:pickLocalFile': return {fileName:'KAMUCL-1.0.46.exe',fileSize:67616046,version:'1.0.46',versionOk:true,sha256:'match'}
    case 'update:listReleases': return Array.from({length:18},(_,i)=>({...updateRelease,version:'1.0.'+(43-i),body:'KAMUCL v1.0.'+(43-i)+'\n\n- 改善下载体验，修复界面显示问题'}))
    case 'gameOptions:get': return gameOptions.getDefaultGameOptions()
    case 'gameOptions:set': return gameOptions.setDefaultGameOptions(args[0])
    case 'exitHistory:list': return journal.list()
    case 'exitHistory:ack': return journal.acknowledge()
    case 'exitHistory:clear': return journal.clearHistory()
    case 'appearance:draftRead': return draft;
    case 'appearance:draftSave': draft=structuredClone(args[0]);return draft;
    case 'appearance:draftDiscard': draft=null;return null;
    case 'appearance:draftApply': settings={...settings,...args[0]};draft=null;return settings;
    case 'appearance:exportTheme': return JSON.stringify(args[0]||settings);
    case 'appearance:importTheme': return JSON.parse(args[0]);
    case 'mods:migrationPlan': return new Promise(resolve=>migrationResolve=resolve);
    case 'mods:catalog': return files.map(f=>({fileName:f.name,name:'识别模组 '+f.name.slice(0,4),version:'1.0',sha1:'a'.repeat(40),locked:locks.has(f.name)}));
    case 'mods:setEnabled': return args[2].map(name=>{if(name.startsWith('0001'))return {fileName:name,ok:false,error:'模拟占用'};const f=files.find(f=>f.name===name);const n=name.replace(/\.disabled$/,'')+(args[3]?'':'.disabled');if(f)f.name=n;return {fileName:name,name:n,ok:true}});
    case 'mods:setLocked': args[2].forEach(n=>args[3]?locks.add(n):locks.delete(n));return args[2].map(fileName=>({fileName,ok:true}));
    case 'mods:versionChoices': return {id:'choice',fileName:args[2],name:'识别模组',currentVersion:'1.0',mcVersion:'26.2',loader:'fabric',locked:true,files:[{fileId:'new',version:'2.0',fileName:'mod2.jar',date:'2026-09-11',size:1234}]};
    case 'mods:versionPlan': return {id:'plan',fileName:'0002.jar',target:{version:'2.0'},files:[{fileName:'mod2.jar',version:'2.0',dependency:false}],warnings:['此模组已锁定，本次切换需要确认'],changelog:'修复性能问题'};
    case 'mods:versionApply': return {ok:true};
    case 'settings:get': return settings
    case 'settings:set': return settings = { ...settings, ...args[0] }
    case 'accounts:list': return [account]
    case 'accounts:selected': return account
    case 'versions:installed': return versions
    case 'versions:manifest': if(failManifest)throw Error('模拟断网');return Array.from({length:90},(_,i)=>({id:i%4===0?'1.21.'+i:i%4===1?'26.3-pre-'+i:i%4===2?'26.3-snapshot-'+i:'b1.7.'+i,type:i%4===0?'release':i%4===3?'old_beta':'snapshot',releaseTime:new Date(Date.UTC(2026,8,11-i)).toISOString()}));
    case 'folders:list': return { folders: settings.folders, active: folder }
    case 'folders:scan': return { folder: settings.folders[0], structure: 'minecraft', status: 'ready', versions, errors: [], durationMs: 12, scannedAt: '2026-09-10' }
    case 'mods:targets': return { versions, errors: [] }
    case 'skin:profile': return { skins: [], capes: [] }
    case 'skin:avatar': return null
    case 'update:getPending':
    case 'update:getState': return null
    case 'app:systemInfo': return { totalMemoryMB: 32768, freeMemoryMB: 16384, platform: 'win32' }
    case 'community:search': return { total: 44, offset: args[0].offset, limit: 20, items: Array.from({ length: 20 }, (_, i) => ({ projectId: String(i), source: i % 2 ? 'curseforge' : 'modrinth', slug: 'fixture', title: ['Sodium', 'Fresh Animations', 'Complementary Shaders', '高清材质与自然光影'][i % 4], author: 'Minecraft Community', description: '更流畅的冒险，更细腻的世界。支持当前游戏版本，轻松管理你的个性化体验。', downloads: 1250000, updatedAt: '2026-09-10', categories: [], iconUrl: '' })) }
    case 'community:files': return [{ fileId: 'fixture', fileName: 'example.jar', version: '1.0', gameVersions: ['26.2'], loaders: ['fabric'], date: '2026-09-10', size: 1024 }]
    default: return []
  }
})
fs.writeFileSync(path.join(root, 'preload.cjs'), `const {contextBridge,ipcRenderer}=require('electron');contextBridge.exposeInMainWorld('kamucl',{invoke:(c,...a)=>ipcRenderer.invoke('design:invoke',c,...a),on:(c,fn)=>{const h=(_,p)=>fn(p);ipcRenderer.on(c,h);return ()=>ipcRenderer.removeListener(c,h)},send:()=>{},getFilePath:()=>'',platform:'win32'});`)
app.whenReady().then(async()=>{
 protocol.handle('kamucl-asset',()=>new Response(nativeImage.createFromBitmap(Buffer.alloc(16*16*4,180),{width:16,height:16}).toPNG(),{headers:{'Content-Type':'image/png'}}));
 session.defaultSession.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(_d,cb)=>cb({cancel:true}))
 const win=new BrowserWindow({show:false,width:1440,height:1000,webPreferences:{preload:path.join(root,'preload.cjs'),backgroundThrottling:false,offscreen:true}})
 win.webContents.on('console-message',(_e,l,m)=>{if(l>=3)errors.push(m)})
 const run=c=>win.webContents.executeJavaScript(c).catch(e=>{throw new Error(e.message+'\n'+c+'\n'+JSON.stringify(errors))}),wait=ms=>new Promise(r=>setTimeout(r,ms))
 const click=async text=>{await run(`(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()===${JSON.stringify(text)});if(!b)throw Error('Missing '+${JSON.stringify(text)});if(b.disabled)throw Error('Disabled '+${JSON.stringify(text)});b.scrollIntoView({block:'center'});b.click()})()`);await wait(300)}
 const nav=async key=>{await run(`(()=>{if(!document.querySelector('[data-nav="${key}"]'))document.querySelector('[data-nav="resources"]').click()})()`);await wait(180);await run(`document.querySelector('[data-nav="${key}"]').click()`);await wait(500)}
 const shot=async name=>{await run(`document.querySelector('.content').scrollTop=0`);await wait(300);const overflow=await run(`(()=>{const e=document.querySelector('.content');return e.scrollWidth-e.clientWidth})()`);assert(overflow<=1,name+' overflow '+overflow);fs.writeFileSync(path.join(root,name+'.png'),(await win.webContents.capturePage()).toPNG())}
 await win.loadFile(path.resolve('out/renderer/index.html'));await wait(1300)

 async function select(selector){await run(`(()=>{const el=document.querySelector(${JSON.stringify(selector)}),r=el.getBoundingClientRect();el.dispatchEvent(new PointerEvent('pointerdown',{button:0,bubbles:true,clientX:r.x+10,clientY:r.y+10}));document.dispatchEvent(new PointerEvent('pointerup',{bubbles:true}))})()`);await wait(100)}
 async function field(label,value,event='change'){await run(`(()=>{const e=document.querySelector('[data-design-tools] [aria-label="${label}"]');if(!e)throw Error('Missing field ${label}');e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('${event}',{bubbles:true}))})()`);await wait(200)}
 async function openEditor(){await run(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'E',ctrlKey:true,shiftKey:true,bubbles:true}))`);await wait(500)}
 await nav('home');await openEditor();assert(await run(`!!document.querySelector('#design-preview-host .shell')`));
 await select('.hero-content h1');await click('文字');await field('外显文字','我的启动器');await field('字号','35');assert.equal(await run(`document.querySelector('.hero-content h1').textContent`),'我的启动器');await wait(500);assert(draft);assert(!settings.visualDesign);
 await click('布局');await run(`(()=>{const e=document.querySelector('.field select');e.value='free';e.dispatchEvent(new Event('change',{bubbles:true}))})()`);await wait(200);await field('宽度','400');await field('横向位移','12');
 const before=await run(`getComputedStyle(document.querySelector('.hero-content h1')).translate`);
 await run(`(()=>{const e=document.querySelector('.hero-content h1'),r=e.getBoundingClientRect(),s=document.querySelector('#design-preview-host').getBoundingClientRect().width/parseFloat(document.querySelector('#design-preview-host').style.width);e.dispatchEvent(new PointerEvent('pointerdown',{button:0,bubbles:true,clientX:r.x+5,clientY:r.y+5}));document.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,clientX:r.x+5+16*s,clientY:r.y+5+8*s,altKey:true}));document.dispatchEvent(new PointerEvent('pointerup',{bubbles:true}))})()`);await wait(200);assert.equal(await run(`getComputedStyle(document.querySelector('.hero-content h1')).translate`),'28px 8px');await click('撤销');assert.equal(await run(`getComputedStyle(document.querySelector('.hero-content h1')).translate`),before);
 assert(await run(`(()=>{const rows=[...document.querySelectorAll('.layer-row')];return rows.length>20&&rows.every(e=>e.getBoundingClientRect().height>=36)})()`));await shot('workbench-light');
 await run(`(()=>{const a=document.querySelectorAll('.runtime-item')[0],b=document.querySelectorAll('.runtime-item')[1],r=a.getBoundingClientRect(),q=b.getBoundingClientRect();a.dispatchEvent(new PointerEvent('pointerdown',{button:0,bubbles:true,clientX:r.x+10,clientY:r.y+10}));document.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,clientX:q.right-3,clientY:q.y+10}));document.dispatchEvent(new PointerEvent('pointerup',{bubbles:true}))})()`);await wait(200);assert.equal(await run(`getComputedStyle(document.querySelectorAll('.runtime-item')[0]).order`),'1');await click('撤销');
 await field('预览缩放','100');assert.equal(await run(`document.querySelector('#design-preview-host').style.transform`),'scale(1)');await field('预览缩放','fit');
 const danger=calls.filter(x=>/^(launch:|mods:apply|fs:remove|download:)/.test(x)).length;await run(`document.querySelector('.launch-main').click()`);assert.equal(calls.filter(x=>/^(launch:|mods:apply|fs:remove|download:)/.test(x)).length,danger);
 await click('退出');await click('保留草稿并退出');assert.equal(await run(`!!document.querySelector('.design-workspace')`),false);assert.notEqual(await run(`document.querySelector('.hero-content h1').textContent`),'我的启动器');await openEditor();assert.equal(await run(`document.querySelector('.hero-content h1').textContent`),'我的启动器');await click('应用外观');assert(settings.visualDesign);assert.equal(draft,null);assert.equal(await run(`document.querySelector('.hero-content h1').textContent`),'我的启动器');
 await openEditor();await select('.hero-content h1');await click('文字');await field('外显文字','');await wait(300);assert.equal(await run(`document.querySelector('.hero-content h1').textContent`),'');await click('退出');await click('放弃修改');assert.equal(await run(`document.querySelector('.hero-content h1').textContent`),'我的启动器');
 // Theme import changes only the preview until applied; different viewport and image background.
 await openEditor();await click('主题与恢复');await field('主题码',JSON.stringify({...settings,theme:'transparent',background:{...types.DEFAULT_BACKGROUND,mode:'image',image:'data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect fill="#8822aa" width="16" height="16"/></svg>')}}),'input');await click('导入到草稿');await shot('workbench-dark-image');win.setSize(1050,780);await wait(300);await shot('workbench-narrow');await click('图层');assert.equal(await run(`getComputedStyle(document.querySelector('.designer-layers-panel')).display`),'flex');await run(`document.querySelector('.designer-layers-panel .mobile-tabs button:last-child').click()`);await wait(100);await click('退出');await click('放弃修改');win.setSize(1440,1000);await wait(200);
 await nav('mods');await wait(500);assert.equal(await run(`document.querySelectorAll('.fm-row').length`),100);assert.equal(await run(`document.querySelectorAll('.fm-row>input[type=checkbox]').length`),100);
 await click('选择当前页');assert((await run(`document.querySelector('.fm-batch').textContent`)).includes('已选 100'));await click('全选筛选结果（240）');await click('批量禁用');await wait(500);assert((await run(`document.querySelector('.fm-batch').textContent`)).includes('已选 1'));assert.equal(requests.filter(r=>r.channel==='mods:setEnabled').at(-1).args[2].length,240);
 await click('清空选择');await run(`(()=>{const e=document.querySelector('[aria-label="搜索本地模组"]');e.value='识别模组 0002';e.dispatchEvent(new Event('input',{bubbles:true}))})()`);await wait(300);assert.equal(await run(`document.querySelectorAll('.fm-row').length`),1);await shot('mods-local-search');
 await run(`document.querySelector('[aria-label^="切换版本 "]').click()`);await wait(250);await run(`document.querySelector('.versions-list button').click()`);await wait(300);assert(await run(`[...document.querySelectorAll('button')].find(b=>b.textContent==='确认切换').disabled`));await shot('mod-version-change');await run(`document.querySelector('.mod-version-modal .warning input').click()`);await click('确认切换');
 await click('版本迁移');await wait(300);await run(`document.querySelector('.version-picker-trigger').click()`);await wait(300);assert.equal(await run(`document.querySelectorAll('.version-picker-option').length`),23);await shot('migration-releases');
 await click('预发布 / 候选');assert.equal(await run(`document.querySelector('.version-picker-trigger').textContent.trim()`),'选择目标游戏版本⌄');await run(`document.querySelector('[aria-label="搜索游戏版本"]').dispatchEvent(new KeyboardEvent('keydown',{key:'End',bubbles:true}))`);await wait(100);assert(await run(`document.querySelector('.version-picker-list').scrollTop>0`));await run(`document.querySelector('[aria-label="搜索游戏版本"]').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))`);await wait(200);assert.equal(await run(`!!document.querySelector('.version-picker-popup')`),false);assert((await run(`document.querySelector('.version-picker-trigger').textContent`)).includes('pre-89'));
 await run(`document.querySelector('.version-picker-trigger').click()`);await wait(100);await click('全部');const rect=await run(`(()=>{const r=document.querySelector('.version-picker-popup').getBoundingClientRect();return{top:r.top,bottom:r.bottom,height:innerHeight}})()`);assert(rect.top>=0&&rect.bottom<=rect.height);await shot('migration-all');await run(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);await wait(100);assert.equal(await run(`!!document.querySelector('.version-picker-popup')`),false);
 await run(`document.querySelector('[aria-label="关闭版本迁移"]').click()`);await wait(100);failManifest=true;await click('版本迁移');await run(`document.querySelector('.version-picker-trigger').click()`);await wait(250);assert((await run(`document.querySelector('.version-picker-message').textContent`)).includes('加载失败'));await click('手动输入');await run(`(()=>{const e=document.querySelector('[aria-label="手动输入版本号"]');e.value='1.21.1';e.dispatchEvent(new Event('input',{bubbles:true}))})()`);await click('选择');await click('检查兼容性');await wait(100);assert(migrationResolve);await run(`document.querySelector('.version-picker-trigger').click()`);await wait(200);failManifest=false;await click('重试');await wait(200);await run(`document.querySelector('.version-picker-option').click()`);await wait(100);migrationResolve({entries:[],warnings:[],id:'stale'});await wait(200);assert.equal(await run(`!!document.querySelector('.migration-summary')`),false);await shot('migration-target-changed');
 assert.deepEqual(errors,[]);fs.writeFileSync(path.join(root,'verification.json'),JSON.stringify({calls,settings,requests},null,2));console.log('PASS 1.0.54 workbench, draft, selection, mods and version picker: '+root);win.destroy();app.quit()
}).catch(e=>{console.error(e);fs.writeFileSync(path.join(root,'error.txt'),e.stack);app.exit(1)})
