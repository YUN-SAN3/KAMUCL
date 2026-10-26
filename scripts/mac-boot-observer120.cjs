// Injected read-only into the exact disposable main process. These listeners
// never emit boot messages or alter visibility, timers or production gates.
function installBootObserver(expected){
 const electron=process.mainModule.require('electron'),fs=process.mainModule.require('node:fs')
 if(process.pid!==expected.pid||fs.realpathSync.native(electron.app.getPath('userData'))!==expected.profile)throw Error('Boot observer belongs to a foreign app/profile')
 if(globalThis.__qaBoot120)throw Error('Do not replace an earlier boot observer')
 const state={startedAt:Date.now(),classification:'Read-only boot events observed after inspector connection; no replay or gate advancement',events:[],rejected:0},listeners=[],windowListeners=[]
 const role=window=>{const url=window.webContents.getURL();return url.includes('/renderer/index.html')?'main-renderer':url.includes('/renderer/splash.html')?'startup-splash':'other'}
 const attach=window=>{if(window.isDestroyed())return;const ready=()=>state.events.push({at:Date.now(),type:'ready-to-show',windowId:window.id,webContentsId:window.webContents.id,role:role(window)});window.on('ready-to-show',ready);windowListeners.push({window,ready})}
 for(const window of electron.BrowserWindow.getAllWindows())attach(window)
 const created=(_event,window)=>attach(window);electron.app.on('browser-window-created',created)
 for(const channel of ['boot:splash-ready','boot:stage','boot:renderer-ready','boot:assembled','boot:finished','boot:splash-failed']){
  const listener=(event,value)=>{const candidates=electron.BrowserWindow.getAllWindows().filter(w=>!w.isDestroyed()&&w.webContents===event.sender),wanted=channel==='boot:stage'||channel==='boot:renderer-ready'?'main-renderer':'startup-splash'
   if(candidates.length!==1||role(candidates[0])!==wanted||(channel==='boot:stage'&&!['settings','accounts','instances','assets','paint'].includes(value))){state.rejected++;return}
   const window=candidates[0];state.events.push({at:Date.now(),type:channel,stage:channel==='boot:stage'?value:null,windowId:window.id,webContentsId:window.webContents.id,role:wanted,senderURL:event.sender.getURL()})
  };electron.ipcMain.on(channel,listener);listeners.push({channel,listener})
 }
 globalThis.__qaBoot120={snapshot:()=>({...state,events:state.events.slice(),windows:electron.BrowserWindow.getAllWindows().filter(w=>!w.isDestroyed()).map(w=>({windowId:w.id,webContentsId:w.webContents.id,role:role(w),url:w.webContents.getURL(),visible:w.isVisible(),loadingMainFrame:w.webContents.isLoadingMainFrame()}))}),restore(){for(const {channel,listener}of listeners)electron.ipcMain.removeListener(channel,listener);electron.app.removeListener('browser-window-created',created);for(const{window,ready}of windowListeners)window.removeListener('ready-to-show',ready);const result={complete:listeners.every(({channel,listener})=>!electron.ipcMain.listeners(channel).includes(listener))&&!electron.app.listeners('browser-window-created').includes(created)&&windowListeners.every(({window,ready})=>!window.listeners('ready-to-show').includes(ready))};delete globalThis.__qaBoot120;return result}}
 return{startedAt:state.startedAt,classification:state.classification,pid:process.pid,profile:expected.profile}
}
module.exports={installBootObserver}
