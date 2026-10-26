// Only explicit Ctrl-minus/Ctrl-0 on an exact foreground-owned disposable HWND.
// CDP key dispatch bypasses Electron before-input-event, so it cannot qualify
// the application's native accelerator path. No user-held modifiers changed.
function sendOwnedZoomKey(binding, vk, koffiPath) {
  const w=testElectron.BrowserWindow.fromId(binding.windowId)
  if(process.pid!==binding.pid||!w||w.webContents.id!==binding.webContentsId||![0xbd,0x30].includes(vk))throw Error('Refusing unowned or unrelated native key')
  const k=process.mainModule.require(koffiPath),u=k.load('user32.dll'),fg=u.func('uintptr __stdcall GetForegroundWindow()'),owner=u.func('GetWindowThreadProcessId','uint32',['uintptr',k.out(k.pointer('uint32'))]),held=u.func('int16 __stdcall GetAsyncKeyState(int32)'),send=u.func('uint32 __stdcall SendInput(uint32,void*,int32)'),bytes=w.getNativeWindowHandle(),hwnd=Number(bytes.readBigUInt64LE()),actual=[0]
  owner(hwnd,actual);if(actual[0]!==binding.pid||fg()!==hwnd||!w.isFocused()||!w.isVisible()||w.isMinimized())throw Error('Native key requires actual owned foreground')
  const pressed=[0x11,0x10,0x12,0x5b,0x5c].filter(code=>(held(code)&0x8000)!==0)
  if(pressed.length)throw Error('User-held modifier present; native key refused without changing it')
  const input=Buffer.alloc(40*4)
  for(const [i,code,flags]of[[0,0x11,0],[1,vk,0],[2,vk,2],[3,0x11,2]]){input.writeUInt32LE(1,i*40);input.writeUInt16LE(code,i*40+8);input.writeUInt32LE(flags,i*40+12)}
  const before=fg(),accepted=send(4,input,40),after=fg()
  if(accepted!==4||before!==hwnd||after!==hwnd)throw Error('Native key batch not fully accepted by the owned foreground: '+JSON.stringify({accepted,before,after,hwnd}))
  return{pid:binding.pid,hwnd,before,after,accepted,vk,classification:'Actual Win32 four-event SendInput batch, no user-held modifier, exact foreground HWND/PID checked before and after; unrelated windows untouched'}
}
module.exports={sendOwnedZoomKey}
