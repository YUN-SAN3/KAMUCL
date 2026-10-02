// Real production renderer, isolated IPC fixtures: no accounts, games or downloads are touched.
// Run after build: node_modules/electron/dist/electron.exe scripts/verify-design-ui.cjs
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict')
const { app, BrowserWindow, ipcMain, session } = require('electron')
const { buildSync } = require('esbuild')
const root = fs.mkdtempSync(path.resolve('out/network-ui-'))
app.setPath('userData', path.join(root, 'userData'))
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
let settings = { gameDir: folder, activeFolder: folder, folders: [{ path: folder, name: '我的游戏', isDefault: true }], javaPath: '', javaAuto: true, javaCustom: [], javaHidden: [], memoryMB: 4096, memoryAuto: true, jvmArgs: '', resolution: { width: 854, height: 480, mode: 'windowed' }, mirror: 'bmclapi', theme: 'blue-white', custom: types.DEFAULT_CUSTOM_THEME, disabledFeatures: [], favoriteVersions: [], homeLayout: types.DEFAULT_HOME_LAYOUT, background: types.DEFAULT_BACKGROUND, launchThumbnail: types.DEFAULT_LAUNCH_THUMBNAIL, configVersion: 1 }
const account = { id: 'fixture', type: 'offline', username: 'KaMuaMua', uuid: '00000000000000000000000000000000' }
const calls = [], errors = []
const updateRelease = { version:'1.0.46', tag:'v1.0.46', publishedAt:'2026-09-10T14:04:00Z', assetSize:67616046, body:'KAMUCL v1.0.46\n\n- 修复：皮肤重命名后恢复默认名称的问题\n- 优化：默认配置的分组、数值输入和同步状态', assetUrl:'https://example.invalid/test.exe' }
let vox={joinedAt:Date.now()-25000,state:'in_room',pending:false,room:{name:'测试房间',currentPlayers:2,maxPlayers:8},session:{state:'in_room',code:'ABCDEF',isHost:false},settings:{allowRelay:true},connection:{phase:'p2p',status:'failed',detail:'打洞重试中'},stages:{punch:{key:'punch',status:'retry',detail:'打洞重试中',ts:Date.now()-25000}}};let tcReady=false;const requests=[];
ipcMain.handle('design:invoke', (_event, channel, ...args) => {
  calls.push(channel);requests.push({channel,args})
  switch (channel) {
    case 'fs:list': return Array.from({length:3000},(_,i)=>({name:String(i).padStart(4,'0')+'.jar',size:100000,isDir:false,mtime:Date.now()}));
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
    case 'settings:get': return settings
    case 'settings:set': return settings = { ...settings, ...args[0] }
    case 'accounts:list': return [account]
    case 'accounts:selected': return account
    case 'versions:installed': return versions
    case 'versions:manifest': return [{ id: '26.2', type: 'release', releaseTime: '2026-09-10' }]
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
 session.defaultSession.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(_d,cb)=>cb({cancel:true}))
 const win=new BrowserWindow({show:false,width:1440,height:1000,webPreferences:{preload:path.join(root,'preload.cjs'),backgroundThrottling:false,offscreen:true}})
 win.webContents.on('console-message',(_e,l,m)=>{if(l>=3)errors.push(m)})
 const run=c=>win.webContents.executeJavaScript(c).catch(e=>{throw new Error(e.message+'\n'+c+'\n'+JSON.stringify(errors))}),wait=ms=>new Promise(r=>setTimeout(r,ms))
 const click=async text=>{await run(`(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()===${JSON.stringify(text)});if(!b)throw Error('Missing '+${JSON.stringify(text)});if(b.disabled)throw Error('Disabled '+${JSON.stringify(text)});b.scrollIntoView({block:'center'});b.click()})()`);await wait(300)}
 const nav=async key=>{await run(`(()=>{if(!document.querySelector('[data-nav="${key}"]'))document.querySelector('[data-nav="resources"]').click()})()`);await wait(180);await run(`document.querySelector('[data-nav="${key}"]').click()`);await wait(500)}
 const shot=async name=>{await run(`document.querySelector('.content').scrollTop=0`);await wait(300);const overflow=await run(`(()=>{const e=document.querySelector('.content');return e.scrollWidth-e.clientWidth})()`);assert(overflow<=1,name+' overflow '+overflow);fs.writeFileSync(path.join(root,name+'.png'),(await win.webContents.capturePage()).toPNG())}
 await win.loadFile(path.resolve('out/renderer/index.html'));await wait(1300)

 assert.equal(await run(`document.querySelectorAll('[data-nav="keys"]').length`),1);
 assert(await run(`document.querySelector('[data-nav="keys"]').classList.contains('nav-item')`));
 assert(!await run(`document.querySelector('[data-nav="keys"]').closest('.nav-sub')!==null`));
 await nav('keys');await shot('default-config-light');
 await nav('mods');await run(`document.querySelector('[data-nav="resources"]').click()`);await wait(400);
 await nav('keys');assert(await run(`document.querySelector('[data-nav="keys"]').getBoundingClientRect().height>0`));
 await run(`document.documentElement.setAttribute('data-theme','dark')`);await shot('default-config-nav');
 assert.deepEqual(errors,[]);console.log('PASS top-level default configuration: '+root);win.destroy();app.quit()
}).catch(e=>{console.error(e);fs.writeFileSync(path.join(root,'error.txt'),e.stack);app.exit(1)})
