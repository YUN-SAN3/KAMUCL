// Native mouse input is restricted to the exactly bound foreground test window.
function clickOwned(binding, point, koffiPath) {
 const w=testElectron.BrowserWindow.fromId(binding.windowId)
 if(process.pid!==binding.pid||!w||w.webContents.id!==binding.webContentsId)throw Error('Refusing unowned native click')
 const k=process.mainModule.require(koffiPath),u=k.load('user32.dll'),fg=u.func('uintptr __stdcall GetForegroundWindow()'),owner=u.func('GetWindowThreadProcessId','uint32',['uintptr',k.out(k.pointer('uint32'))]),held=u.func('int16 __stdcall GetAsyncKeyState(int32)'),send=u.func('uint32 __stdcall SendInput(uint32,void*,int32)'),P=k.struct({x:'int32',y:'int32'}),clientToScreen=u.func('ClientToScreen','bool',['uintptr',k.inout(k.pointer(P))]),getCursor=u.func('GetCursorPos','bool',[k.out(k.pointer(P))]),setCursor=u.func('bool __stdcall SetCursorPos(int32,int32)'),dpi=u.func('uint32 __stdcall GetDpiForWindow(uintptr)'),b=w.getNativeWindowHandle(),hwnd=Number(b.readBigUInt64LE()),p=[0]
 owner(hwnd,p)
 if(p[0]!==binding.pid||fg()!==hwnd||!w.isFocused()||!w.isVisible()||w.isMinimized())throw Error('Native click requires actual owned foreground')
 if([1,2,4,0x10,0x11,0x12,0x5b,0x5c].some(code=>(held(code)&0x8000)!==0))throw Error('User-held button/modifier; no input sent')
 if(!Number.isFinite(point.x)||!Number.isFinite(point.y)||point.x<0||point.y<0)throw Error('Invalid CSS click point')
 const content=w.getContentSize(),zoom=w.webContents.getZoomFactor(),scale=dpi(hwnd)/96
 if(point.x*zoom>=content[0]||point.y*zoom>=content[1])throw Error('Point outside owned content')
 const original={x:0,y:0},physical={x:Math.round(point.x*zoom*scale),y:Math.round(point.y*zoom*scale)}
 if(!getCursor(original)||!clientToScreen(hwnd,physical))throw Error('Native point observation failed')
 const proof={hwnd,pid:binding.pid,css:point,physical,zoom,scale,originalCursor:original}
 try{
  if(!setCursor(physical.x,physical.y)||fg()!==hwnd)throw Error('Owned cursor move failed')
  const input=Buffer.alloc(80);input.writeUInt32LE(0,0);input.writeUInt32LE(2,8+12);input.writeUInt32LE(0,40);input.writeUInt32LE(4,40+8+12)
  proof.sent=send(2,input,40);if(proof.sent!==2)throw Error('Native click incomplete')
  proof.afterForeground=fg();if(proof.afterForeground!==hwnd)throw Error('Native click changed owned foreground')
 }finally{
  const now={x:0,y:0};if(getCursor(now)&&now.x===physical.x&&now.y===physical.y){proof.cursorRestored=setCursor(original.x,original.y)}else proof.cursorRestored=false
 }
 return proof
}
module.exports={clickOwned}
