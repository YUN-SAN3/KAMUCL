// Real production renderer, isolated IPC fixtures: no accounts, games or downloads are touched.
// Run after build with ELECTRON_RUN_AS_NODE unset: electron scripts/verify-instance-center-ui.cjs
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
    case 'mods:duplicates': return []; case 'mods:crossDuplicates': return []; case 'community:search': return {items:[],total:0,offset:0,limit:20}; case 'fs:list': return files;
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
    case 'center:overview':return {target:{folder,id:versions[0].id},name:versions[0].id,directory:folder+'/versions/example',mcVersion:'26.2',loader:'fabric',running:false,shared:false,roots:['mods','config','options.txt','saves']};
    case 'center:worlds':return Array.from({length:42},(_,i)=>({id:'world-'+i,name:'生存世界 '+i,version:'1.21.1',mode:'生存',lastPlayed:Date.now()-i*10000}));
    case 'center:backups':return Array.from({length:20},(_,i)=>({id:'backup-'+i,createdAt:new Date().toISOString(),title:i?'模组版本修改前':'实例手动备份',automatic:i>0,metadata:{type:'instance'},files:[{path:'mods/test.jar',size:12000000}],roots:['mods']}));
    case 'center:screenshots':return {total:48,items:Array.from({length:24},(_,i)=>({id:'screenshot-'+(i+args[1]*24)+'.png',date:Date.now(),image:nativeImage.createFromBitmap(Buffer.alloc(64*36*4,180),{width:64,height:36}).toDataURL()}))};
    case 'center:file':return args[1]==='preview'?nativeImage.createFromBitmap(Buffer.alloc(640*360*4,180),{width:640,height:360}).toDataURL():null;
    case 'center:diagnose':return {id:'diagnosis',findings:[{rule:'java-version',title:'Java 版本不兼容',confidence:'certain',evidence:'java.lang.UnsupportedClassVersionError: class file version 65',advice:'请选择 Java 21',action:'java'},{rule:'files',title:'运行文件缺失或损坏',confidence:'certain',evidence:'client.jar 校验失败',advice:'重新下载并校验',action:'files'}],java:[{path:'C:/Java/bin/java.exe',major:21,version:'21',is64Bit:true}]};
    case 'center:operation':return {ok:true};
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



 await nav('game');{await run("[...document.querySelectorAll('button')].find(b=>b.textContent.includes('已安装')).click()");await wait(400)};await click('管理实例');assert(await run("!!document.querySelector('.ic')"));await shot('center-overview-light');await click('复制实例');assert(await run("!!document.querySelector('.ic-dialog')"));await shot('center-clone');await run("document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))");await wait(100);assert.equal(await run("!!document.querySelector('.ic-dialog')"),false);assert(await run("!!document.querySelector('.ic')"));
 await click('存档');assert.equal(await run("document.querySelectorAll('.ic-row').length"),42);assert(await run("(()=>{const c=document.querySelector('.ic-content');c.scrollTop=500;return c.scrollTop>0})()"));await shot('center-worlds');await click('备份');await shot('center-backups');await click('恢复…');await shot('center-restore');await run("document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))");await click("截图");assert.equal(await run("document.querySelectorAll('.ic-shot').length"),24);await run("document.querySelector('.ic-shot').click()");await wait(250);assert.equal(await run("document.querySelector('.ic-lightbox img').naturalWidth"),640);await shot("center-screenshots");await click("下一张");await click("另存为");assert(requests.some(r=>r.channel==="center:file"&&r.args[1]==="screenshot"&&r.args[3]===true));await run("document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))");await click("下一页");assert(await run("document.querySelector('.ic-shot span').textContent.includes('24')"));await click("诊断");await click('开始检查');await shot('center-diagnostics');assert.equal(await run("document.querySelectorAll('.ic pre').length"),2);
 await run("document.documentElement.style.setProperty('--card-solid','#182326');document.documentElement.style.setProperty('--text','#edf7f5');document.documentElement.style.setProperty('--card','#223034');document.documentElement.style.setProperty('--bg','#111b1e')");await shot('center-dark');win.setSize(820,720);await wait(350);await shot('center-narrow');assert(await run("(()=>{const e=document.querySelector('.ic-content');return e.scrollWidth<=e.clientWidth+1})()"));await run("document.querySelector('[aria-label=\"关闭实例管理\"]').click()");assert.equal(await run("!!document.querySelector('.ic')"),false);assert.equal(calls.includes('game:launch'),false);assert.equal(errors.length,0,errors.join('\n'));console.log('PASS instance center production interactions: '+root);win.destroy();app.quit()
}).catch(e=>{console.error(e);app.exit(1)})
