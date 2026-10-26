// Public QA read-only diagnostic. No window mutation, titles, process commands or GUI launch.
const assert=require('node:assert/strict')
function snapshotOwnedOcclusion({mainPid,handleHex}){
 assert.equal(process.platform,'win32');assert(Number.isInteger(mainPid)&&mainPid>0);assert(typeof handleHex==='string'&&/^0x[0-9a-f]+$/i.test(handleHex))
 const koffi=require('koffi'),user=koffi.load('user32.dll'),dwm=koffi.load('dwmapi.dll')
 const Rect=koffi.struct({left:'int32',top:'int32',right:'int32',bottom:'int32'})
 const isWindow=user.func('bool __stdcall IsWindow(uintptr_t)'),isVisible=user.func('bool __stdcall IsWindowVisible(uintptr_t)'),isIconic=user.func('bool __stdcall IsIconic(uintptr_t)'),getWindow=user.func('uintptr_t __stdcall GetWindow(uintptr_t,uint32_t)'),foreground=user.func('uintptr_t __stdcall GetForegroundWindow()')
 const getPid=user.func('GetWindowThreadProcessId','uint32',['uintptr',koffi.out(koffi.pointer('uint32'))]),getRect=user.func('GetWindowRect','bool',['uintptr',koffi.out(koffi.pointer(Rect))]),getStyle=user.func('GetWindowLongPtrW','intptr',['uintptr','int32']),getDwmRect=dwm.func('DwmGetWindowAttribute','int32',['uintptr','uint32',koffi.out(koffi.pointer(Rect)),'uint32']),getCloaked=dwm.func('DwmGetWindowAttribute','int32',['uintptr','uint32',koffi.out(koffi.pointer('uint32')),'uint32'])
 const hwnd=BigInt(handleHex),hex=h=>'0x'+BigInt(h).toString(16);assert(isWindow(hwnd),'owned HWND no longer exists')
 const raw=h=>{const pid=[0];getPid(h,pid);const r={},frame={},cloaked=[0],rectOk=getRect(h,r),frameResult=getDwmRect(h,9,frame,16),cloakedResult=getCloaked(h,14,cloaked,4);const style=Number(BigInt.asUintN(32,BigInt(getStyle(h,-16)))),exStyle=Number(BigInt.asUintN(32,BigInt(getStyle(h,-20))));return{pid:pid[0],handleHex:hex(h),visible:isVisible(h),iconic:isIconic(h),cloaked:cloakedResult===0?cloaked[0]:null,dwmCloakedHRESULT:cloakedResult,rect:rectOk?r:null,extendedFrameRect:frameResult===0?frame:null,dwmFrameHRESULT:frameResult,style,exStyle,topmost:!!(exStyle&8),layered:!!(exStyle&0x80000),transparentHitTestStyle:!!(exStyle&0x20)}}
 const own=raw(hwnd);assert.equal(own.pid,mainPid,'HWND does not belong to the explicitly owned main PID');assert(own.rect,'owned rectangle unavailable')
 const viewport=own.extendedFrameRect||own.rect,above=[],seen=new Set([hex(hwnd)]);let cursor=getWindow(hwnd,3),truncated=false
 for(let rank=1;BigInt(cursor)!==0n;rank++){
  if(rank>4096){truncated=true;break}const key=hex(cursor);assert(!seen.has(key),'z-order changed into a cycle during observation');seen.add(key)
  const row=raw(cursor),r=row.extendedFrameRect||row.rect,clip=r?{left:Math.max(r.left,viewport.left),top:Math.max(r.top,viewport.top),right:Math.min(r.right,viewport.right),bottom:Math.min(r.bottom,viewport.bottom)}:null,overlap=!!clip&&clip.right>clip.left&&clip.bottom>clip.top,visibleCandidate=row.visible&&!row.iconic&&row.cloaked===0&&overlap
  row.rankAboveOwned=rank;row.overlapRect=overlap?clip:null;row.fullCoverCandidate=visibleCandidate&&clip.left===viewport.left&&clip.top===viewport.top&&clip.right===viewport.right&&clip.bottom===viewport.bottom
  if(overlap)above.push(row);cursor=getWindow(cursor,3)
 }
 const currentOwner=raw(hwnd);assert.equal(currentOwner.pid,mainPid,'owned HWND identity changed during observation');const fg=foreground(),fgPid=[0];if(BigInt(fg)!==0n)getPid(fg,fgPid)
 return{schemaVersion:1,observedAt:new Date().toISOString(),api:'Read-only Win32 HWND z-order/visibility/rect/style and DWM cloak/frame bounds',own,currentOwner,foreground:{handleHex:hex(fg),pid:fgPid[0]},aboveOverlapping:above,truncated,fullRectCoverCandidates:above.filter(r=>r.fullCoverCandidate).map(r=>({pid:r.pid,handleHex:r.handleHex,rankAboveOwned:r.rankAboveOwned,layered:r.layered,topmost:r.topmost})),limitations:['Z-order is sampled sequentially and may change during collection.','Rectangle coverage cannot establish pixel opacity: layered windows, regions and compositor behavior require separate evidence.','No foreign process title, arguments, account, screenshot or window mutation was read or performed.']}
}
module.exports={snapshotOwnedOcclusion}
if(require.main===module){const [pid,handleHex]=process.argv.slice(2);console.log(JSON.stringify(snapshotOwnedOcclusion({mainPid:Number(pid),handleHex}),null,2))}
