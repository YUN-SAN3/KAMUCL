// Actual native overlay + Electron coordinator, with a private fake main page and no game/user settings.
const fs=require('fs'),path=require('path'),assert=require('assert/strict'),{spawn}=require('child_process'),{build}=require('esbuild')
const {app,BrowserWindow}=require('electron')
const root=fs.mkdtempSync(path.resolve('out/unified-startup-'));app.setPath('userData',path.join(root,'userData'))
app.whenReady().then(async()=>{
 const bundle=await build({entryPoints:['src/main/nativeStartup.ts'],bundle:true,platform:'node',format:'cjs',packages:'external',write:false})
 const mod={exports:{}};new Function('require','module','exports',bundle.outputFiles[0].text)(require,mod,mod.exports)
 const signal=path.join(root,'startup.control'),start=Date.now(),probe=path.join(root,'first-paint.txt')
 const child=spawn(path.resolve('out/main/StartupFeedback.exe'),[signal,String(process.pid)],{env:{...process.env,KAMUCL_BOOT_PROBE:probe},windowsHide:true,stdio:'ignore'})
 const wait=ms=>new Promise(r=>setTimeout(r,ms))
 async function until(fn,timeout=7000){const end=Date.now()+timeout;while(!fn()){if(Date.now()>end)throw new Error('Timed out');await wait(15)}}
 try {
  await until(()=>fs.existsSync(signal+'.visible')&&fs.existsSync(probe)&&fs.statSync(probe).size>0)
  const firstPaintMs=Number(fs.readFileSync(probe,'utf8'))-start
  const pid=await mod.exports.awaitNativeStartup(signal);assert.equal(pid,child.pid)
  const startup=mod.exports.createNativeStartup(signal,pid)
  const win=new BrowserWindow({x:-10000,y:-10000,width:600,height:400,show:false,webPreferences:{nodeIntegration:true,contextIsolation:false}})
  startup.attach(win)
  // PowerShell launches this helper with SW_HIDE. Consume that first-show hint
  // offscreen so it cannot suppress the coordinator's subsequent real reveal.
  await win.loadURL('data:text/html,<body style="background:%23172021;color:white;font:24px sans-serif"><p>KAMUCL startup verification</p></body>')
  await wait(1100);assert(!win.isVisible());assert(!fs.existsSync(signal+'.assembled'),'paint alone must not complete boot')
  win.showInactive();win.hide();win.setPosition(20,20)
  await win.webContents.executeJavaScript("require('electron').ipcRenderer.send('boot:renderer-ready')")
  const readyAt=Date.now();await until(()=>fs.existsSync(signal+'.assembled'));const assembledMs=Date.now()-readyAt
  assert(assembledMs>=600,'must retain convergence/hold before main reveal')
  assert.equal(Number(fs.readFileSync(signal+'.visible')),child.pid,'same overlay must survive until final reveal')
  await until(()=>fs.existsSync(signal+'.finished'));await wait(100)
  assert(win.isVisible());assert.equal(win.getOpacity(),1);await until(()=>child.exitCode!==null)
  const result={pass:true,firstPaintMs,assembledMs,oneNativePid:pid,electronWindows:BrowserWindow.getAllWindows().length,mainOpacity:win.getOpacity()}
  assert.equal(result.electronWindows,1,'must not create a second particle renderer')
  fs.writeFileSync(path.join(root,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({root,...result},null,2));win.destroy();app.quit()
 } finally {if(child.exitCode===null)fs.writeFileSync(signal,'closed')}
}).catch(e=>{console.error(e);app.exit(1)})
