// Real production main/preload/renderer; a fresh profile and only owned HWNDs.
// Run: electron scripts/verify-window-controls.cjs
const {app, BrowserWindow, screen, desktopCapturer} = require('electron')
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), assert = require('node:assert/strict')
const koffi = require('koffi')
assert.equal(process.platform, 'win32')
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'KAMUCL window 中文 '))
app.setPath('userData', root)
const folder = path.join(root, 'games'); fs.mkdirSync(folder)
fs.writeFileSync(path.join(root, 'settings.json'), JSON.stringify({gameDir:folder,activeFolder:folder,folders:[{path:folder,name:'Window test'}],autoUpdate:false,theme:'blue-white'}))
const reopenBounds={x:20,y:20,width:1100,height:700}
if(process.env.KAMUCL_WINDOW_REOPEN)fs.writeFileSync(path.join(root,'window-state.json'),JSON.stringify({...reopenBounds,maximized:true}))
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
const user = koffi.load('user32.dll'), dwm = koffi.load('dwmapi.dll')
const send = user.func('intptr_t __stdcall SendMessageW(uintptr_t, uint32_t, uintptr_t, intptr_t)')
const getStyle = user.func('int32_t __stdcall GetWindowLongW(uintptr_t, int)')
const rect = koffi.struct('WindowTestRect', {left:'int32',top:'int32',right:'int32',bottom:'int32'})
const frame = dwm.func('DwmGetWindowAttribute','int',['uintptr','uint32',koffi.out(koffi.pointer(rect)),'uint32'])
const gdi=koffi.load('gdi32.dll'),createRegion=gdi.func('uintptr_t __stdcall CreateRectRgn(int,int,int,int)'),deleteRegion=gdi.func('bool __stdcall DeleteObject(uintptr_t)')
const getRegion=user.func('int __stdcall GetWindowRgn(uintptr_t,uintptr_t)'),regionBox=gdi.func('GetRgnBox','int',['uintptr',koffi.out(koffi.pointer(rect))])
const getRect=user.func('GetWindowRect','bool',['uintptr',koffi.out(koffi.pointer(rect))])
const message = (hwnd, id, wp) => new Promise((resolve,reject)=>send.async(hwnd,id,wp,0,(err,v)=>err?reject(err):resolve(v)))
const position=user.func('bool __stdcall SetWindowPos(uintptr_t,uintptr_t,int,int,int,int,uint32_t)')
const report = {profile:root,checks:[],material:[]}, events=[]
let started=false
app.on('browser-window-created', (_event, win) => {
  if (win.getTitle() !== 'KAMUCL') return
  // setIgnoreMouseEvents(true) itself adds WS_EX_LAYERED and would mask the
  // very startup-opacity regression this production test must detect.
  for(const name of ['maximize','unmaximize','minimize','restore'])win.on(name,()=>events.push(name))
  win.webContents.on('did-finish-load',async()=>{
    if(started)return;started=true
    try {
      for(let i=0;i<100&&!win.isVisible();i++)await wait(100)
      await wait(1000)
      if(process.env.KAMUCL_WINDOW_REOPEN){assert(win.isMaximized(),'reopen lost maximization');assert.deepEqual(win.getNormalBounds(),reopenBounds);win.unmaximize();await wait(300);assert.deepEqual(win.getBounds(),reopenBounds);report.reopen=true}
      win.setAlwaysOnTop(true)
      const raw=win.getNativeWindowHandle(),hwnd=Number(raw.length===8?raw.readBigUInt64LE():raw.readUInt32LE())
      assert.equal(getStyle(hwnd,-20)&0x80000,0,'startup fade left the DWM window layered')
      const button=()=>win.webContents.executeJavaScript(`document.querySelector('[data-ui="App:bd7bf1eb0182"]').click()`)
      for(const display of screen.getAllDisplays()) {
        if(display.workArea.width<960||display.workArea.height<620)continue
        const area=display.workArea
        if(win.isMaximized())win.unmaximize()
        win.setBounds({x:area.x+20,y:area.y+20,width:Math.min(1100,area.width-40),height:Math.min(700,area.height-40)})
        await wait(400)
        const normal=win.getBounds()
        for(const [name,action] of [['button',button],['caption double-click',()=>message(hwnd,0xA3,2)],['system maximize',()=>message(hwnd,0x112,0xF030)]]){
          events.length=0;await action();await wait(900)
          assert(win.isMaximized(),`${name}: maximization rebounded (${events.join(',')})`)
          assert.equal(getStyle(hwnd,-20)&0x80000,0,`${name}: layered style returned`)
          assert.equal(events.filter(e=>e==='unmaximize').length,0,`${name}: reversed native transition`)
          assert.deepEqual(win.getNormalBounds(),normal,`${name}: lost restore geometry`)
          const saved=JSON.parse(fs.readFileSync(path.join(root,'window-state.json')))
          assert.equal(saved.maximized,true);assert.deepEqual({x:saved.x,y:saved.y,width:saved.width,height:saved.height},normal)
          const visible={};assert.equal(frame(hwnd,9,visible,16),0)
          const region=createRegion(0,0,0,0),clip={},outer={}
          if(getRegion(hwnd,region)>1){regionBox(region,clip);getRect(hwnd,outer);visible.left=Math.max(visible.left,outer.left+clip.left);visible.top=Math.max(visible.top,outer.top+clip.top);visible.right=Math.min(visible.right,outer.left+clip.right);visible.bottom=Math.min(visible.bottom,outer.top+clip.bottom)}
          deleteRegion(region)
          // DWM visible frame, not the invisible native resize border, must stay on its monitor.
          const a=screen.screenToDipPoint({x:visible.left,y:visible.top}),b=screen.screenToDipPoint({x:visible.right,y:visible.bottom})
          assert(a.x>=area.x-2&&a.y>=area.y-2&&b.x<=area.x+area.width+2&&b.y<=area.y+area.height+2,'frame spills into adjacent monitor')
          await wait(500);assert(win.isMaximized(),`${name}: delayed rebound`)
          await button();await wait(700)
          assert(!win.isMaximized());assert.deepEqual(win.getBounds(),normal,`${name}: restore changed bounds`)
          report.checks.push({display:display.id,scale:display.scaleFactor,action:name,normal,visible})
        }
        await button();await wait(1000);assert(win.isMaximized())
        const backdrop=new BrowserWindow({...area,title:"Backdrop fixture",alwaysOnTop:true,webPreferences:{backgroundThrottling:false},frame:false,focusable:false,skipTaskbar:true,show:false,backgroundColor:'#000000'})
        await backdrop.loadURL('data:text/html,<html><body style=\"margin:0;background:black\"></body></html>');backdrop.setIgnoreMouseEvents(true);backdrop.showInactive();const backRaw=backdrop.getNativeWindowHandle(),backHwnd=Number(backRaw.length===8?backRaw.readBigUInt64LE():backRaw.readUInt32LE());position(backHwnd,hwnd,0,0,0,0,0x413)
        const samples=[]
        for(const color of ['#000000','#ffffff']){
          backdrop.setBackgroundColor(color);await backdrop.webContents.executeJavaScript('document.body.style.background='+JSON.stringify(color));await wait(1000);assert(win.isMaximized(),'backdrop fixture changed maximization')
          const sources=await desktopCapturer.getSources({types:['screen'],thumbnailSize:{width:Math.round(display.size.width*display.scaleFactor),height:Math.round(display.size.height*display.scaleFactor)}})
          const image=sources.find(s=>s.display_id===String(display.id)).thumbnail,size=image.getSize(),pixels=image.getBitmap()
          const x=Math.floor((area.x+400-display.bounds.x)/display.bounds.width*size.width),y=Math.floor((area.y+35-display.bounds.y)/display.bounds.height*size.height)
          fs.writeFileSync(path.join(root,'capture-'+color.slice(1)+'.png'),image.crop({x:Math.max(0,x-30),y:Math.max(0,y-15),width:200,height:100}).toPNG());const offset=(y*size.width+x)*4;samples.push([...pixels.subarray(offset,offset+3)])
        }
        backdrop.destroy()
        const difference=samples[0].reduce((total,c,i)=>total+Math.abs(c-samples[1][i]),0)/3
        report.material.push({display:display.id,samples,difference,focused:win.isFocused()})
        assert(!win.isFocused() || difference>3,`maximized backdrop became opaque: ${JSON.stringify(samples)}`)
        await button();await wait(400);assert.deepEqual(win.getBounds(),normal)
        for(let cycle=0;cycle<3;cycle++){
          // Wait for Windows' native transition before sending the next one.
          // 180 ms can still be inside the OS animation on Electron 44.
          await button();await wait(450);assert(win.isMaximized())
          await button();await wait(450);assert(!win.isMaximized())
        }
        await wait(300);assert.deepEqual(win.getBounds(),normal,'rapid toggle lost native placement')
        await button();await wait(500);win.minimize();await wait(300);win.restore();await wait(1400)
        assert(win.isMaximized(),'minimize/restore lost maximization');await button();await wait(400);assert.deepEqual(win.getBounds(),normal)
      }
      fs.writeFileSync(path.join(root,'window.png'),(await win.webContents.capturePage()).toPNG())
      fs.writeFileSync('out/window-controls-proof.json',JSON.stringify(report,null,2))
      console.log('PASS WINDOW CONTROLS',JSON.stringify(report));app.exit(0)
    }catch(error){console.error(error);console.error('EVENTS',events);app.exit(1)}
  })
})
setTimeout(()=>{console.error('Window verification timed out');app.exit(1)},60000).unref()
require(process.env.KAMUCL_TEST_ENTRY || path.resolve('out/main/index.js'))
