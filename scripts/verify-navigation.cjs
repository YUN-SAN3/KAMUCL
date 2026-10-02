// Production navigation interaction; isolated profile, no downloads or user files.
const {app}=require('electron'),fs=require('fs'),path=require('path'),os=require('os'),assert=require('assert/strict');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'KAMUCL navigation '));app.setPath('userData',root);const games=path.join(root,'games');fs.mkdirSync(games);fs.writeFileSync(path.join(root,'settings.json'),JSON.stringify({gameDir:games,activeFolder:games,folders:[{path:games}],autoUpdate:false,theme:'orange-black'}));
const wait=ms=>new Promise(r=>setTimeout(r,ms));let started=false;
app.on('browser-window-created',(_,w)=>{if(w.getTitle()!=='KAMUCL')return;w.webContents.on('did-finish-load',async()=>{if(started)return;started=true;try{await wait(6500);const run=s=>w.webContents.executeJavaScript(s);const click=key=>run(`document.querySelector('[data-nav="${key}"]').click()`);const geometry=()=>run(`(()=>{const a=document.querySelector('.nav-item.active').getBoundingClientRect(),b=document.querySelector('.nav-selection').getBoundingClientRect();return {a:{x:a.x,y:a.y,h:a.height,w:a.width},b:{x:b.x,y:b.y,h:b.height,w:b.width}}})()`);const aligned=async()=>{const g=await geometry();for(const k of ['x','y','h','w'])assert(Math.abs(g.a[k]-g.b[k])<1,JSON.stringify(g));};
await aligned();const before=await geometry();await click('game');await wait(70);const mid=await geometry();assert(mid.b.y>before.b.y&&mid.b.y<mid.a.y,'must animate through intermediate position');await wait(500);await aligned();
await click('settings');await wait(60);await click('home');await wait(60);await click('game');await wait(500);await aligned();
await click('resources');await wait(400);await click('mods');await wait(500);await aligned();
await run(`document.querySelector('[data-nav="settings"]').dispatchEvent(new PointerEvent('pointerover',{bubbles:true}))`);await wait(400);await aligned();
w.setSize(1000,680);await wait(500);await run(`document.querySelector('.nav').scrollTop=120`);await wait(400);await aligned();
await click('settings');await wait(500);await aligned();
await w.webContents.debugger.attach('1.3');await w.webContents.debugger.sendCommand('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});assert(parseFloat(await run(`getComputedStyle(document.querySelector('.nav-selection')).transitionDuration`)) < 0.001);await click('home');await wait(80);await aligned();w.webContents.debugger.detach();
fs.writeFileSync('out/navigation-proof.json',JSON.stringify({version:require('../package.json').version,intermediate:mid,checks:['smooth travel','rapid retarget','submenu','hover independent of selection','resize and scroll','reduced motion']},null,2));console.log('Navigation interaction checks passed');app.exit(0);
}catch(e){console.error(e);app.exit(1);}})});
require(path.resolve(process.env.KAMUCL_TEST_ENTRY||'out/main/index.js'));setTimeout(()=>app.exit(2),45000);
