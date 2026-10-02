/** One accepted click is one contact. Visual frames may skip, contacts may not. */
export class KamuInteraction {
 readonly limit=32
 queued=0
 phase:'front'|'turn'|'slap'|'rest'|'return'='front'
 started=0
 private landed=false
 private pausedAt:number|undefined
 private lastPresented:number|undefined
 private presentationBudget=Infinity
 get busy(){return this.phase!=='front'||this.queued>0}
 accept(now:number):boolean {
  if(this.queued>=this.limit)return false
  this.queued++
  if(this.phase==='front'){this.phase='turn';this.started=now;this.lastPresented=now}
  else if(this.phase==='rest'){this.phase='slap';this.started=now;this.landed=false;this.lastPresented=now}
  else if(this.phase==='return'){
   // Reverse from the last presented pose, even if an input arrives after a stall.
   const observed=Number.isFinite(this.presentationBudget)?this.lastPresented??now:now
   this.phase='turn';this.started=now-(1-Math.min(1,Math.max(0,(observed-this.started)/180)))*180;this.lastPresented=now
  }
  return true
 }
 pause(now:number){this.pausedAt??=now}
 resume(now:number){if(this.pausedAt!==undefined){this.started+=now-this.pausedAt;this.pausedAt=undefined;this.lastPresented=now}}
 advance(now:number,reduced=false,maxPresentedGap=Infinity):{yaw:number;palm:number;contacts:number[]} {
  if(this.pausedAt!==undefined)now=this.pausedAt
  this.presentationBudget=maxPresentedGap>0?maxPresentedGap:Infinity
  // A visible animation must present each queued palm cycle. Do not consume
  // several complete slaps when the host resumes a late animation callback.
  // Unbounded mode remains available for hidden close/drain and legacy callers.
  if(this.busy&&this.lastPresented!==undefined&&Number.isFinite(this.presentationBudget)){
   const missed=now-this.lastPresented-this.presentationBudget
   if(missed>0)this.started+=missed
  }
  this.lastPresented=this.busy?now:undefined
  const contacts:number[]=[],turn=reduced?1:180,slap=150,contact=75,rest=200
  for(let i=0;i<100;i++){
   const elapsed=now-this.started
   if(this.phase==='turn'&&elapsed>=turn){this.started+=turn;this.phase='slap';this.landed=false;continue}
   if(this.phase==='slap'){
    if(!this.landed&&elapsed>=contact){this.landed=true;this.queued--;contacts.push(this.started+contact)}
    if(elapsed>=slap){this.started+=slap;this.phase=this.queued?'slap':'rest';this.landed=false;continue}
   }
   if(this.phase==='rest'&&elapsed>=rest){this.started+=rest;this.phase='return';continue}
   if(this.phase==='return'&&elapsed>=turn){this.started+=turn;this.phase='front';continue}
   break
  }
  const progress=Math.min(1,Math.max(0,(now-this.started)/turn)),ease=progress*progress*(3-2*progress)
  const yaw=this.phase==='front'?0:this.phase==='turn'?Math.PI*ease:this.phase==='return'?Math.PI*(1-ease):Math.PI
  if(!this.busy)this.lastPresented=undefined
  return {yaw,palm:this.phase==='slap'?(now-this.started)/slap:-1,contacts}
 }
}
