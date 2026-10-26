export type MascotFrame={kind:'raf'|'watchdog';at:number;rafTimestamp?:number;gap:number;pendingAge:number;fallbacks:number}
export type MascotFrameClock={
 now:()=>number
 requestAnimationFrame:(callback:(timestamp:number)=>void)=>number
 cancelAnimationFrame:(id:number)=>void
 setTimeout:(callback:()=>void,delay:number)=>ReturnType<typeof setTimeout>
 clearTimeout:(id:ReturnType<typeof setTimeout>)=>void
}
type PendingFrame={requestedAt:number;raf?:number;timer?:ReturnType<typeof setTimeout>}

// rAF drives normal frames. A foreground pending frame alone owns a one-shot
// deadline: a host that keeps timers alive but starves rAF can still draw the
// current real pose. Token identity rejects a cancelled callback arriving late.
export class MascotFrameDriver{
 private pending?:PendingFrame
 private disposed=false
 private lastAt?:number
 private fallbackCount=0
 constructor(private readonly render:(frame:MascotFrame)=>void,private readonly clock:MascotFrameClock,private readonly deadlineMs=40){}
 get hasPending(){return!!this.pending}
 get fallbacks(){return this.fallbackCount}
 request(){
  if(this.disposed||this.pending)return
  const pending:PendingFrame={requestedAt:this.clock.now()};this.pending=pending
  try{
   pending.raf=this.clock.requestAnimationFrame(timestamp=>this.deliver(pending,'raf',timestamp))
   if(this.pending===pending)pending.timer=this.clock.setTimeout(()=>this.deliver(pending,'watchdog'),this.deadlineMs)
   else this.clock.cancelAnimationFrame(pending.raf)
  }catch(error){if(this.pending===pending)this.cancel();throw error}
 }
 private clear(pending:PendingFrame){
  if(pending.raf!==undefined)this.clock.cancelAnimationFrame(pending.raf)
  if(pending.timer!==undefined)this.clock.clearTimeout(pending.timer)
 }
 private deliver(pending:PendingFrame,kind:MascotFrame['kind'],rafTimestamp?:number){
  if(this.disposed||this.pending!==pending)return
  this.pending=undefined;this.clear(pending)
  const at=this.clock.now(),gap=this.lastAt===undefined?0:at-this.lastAt;this.lastAt=at
  if(kind==='watchdog')this.fallbackCount++
  try{this.render({kind,at,...(kind==='raf'?{rafTimestamp}:{}),gap,pendingAge:at-pending.requestedAt,fallbacks:this.fallbackCount})}
  catch(error){this.cancel();throw error}
 }
 cancel(){const pending=this.pending;this.pending=undefined;if(pending)this.clear(pending);this.lastAt=undefined}
 dispose(){this.disposed=true;this.cancel()}
}
