export type PalmAnimationEvent={role:'palm'|'print';phase:string;at:number;cycleId:number;contactAt:number|undefined}
type Pose={cycleId:number;palm:number;contactAt?:number;reduced:boolean}
const centre='translate(0px,0px) rotate(0deg)',retreated='translate(4px,-4px) rotate(15deg)'
/** Visual-only compositor effects. Their completion never consumes a click or plays audio. */
export class KamuPalmAnimation {
 private palmAnimation:Animation|undefined
 private printAnimation:Animation|undefined
 private cycleId=-1
 private landedCycle=-1
 private contactAt:number|undefined
 private paused=false
 private disposed=false
 private palmPhase='idle'
 private printPhase='idle'
 constructor(private palm:HTMLElement,private print:HTMLElement,private observe:(event:PalmAnimationEvent)=>void=()=>{},private now=()=>performance.now()){
  if(typeof palm.animate!=='function'||typeof print.animate!=='function')throw new Error('像素反馈动画不可用')
 }
 private event(role:'palm'|'print',phase:string){if(role==='palm')this.palmPhase=phase;else this.printPhase=phase;this.observe({role,phase,at:this.now(),cycleId:this.cycleId,contactAt:this.contactAt})}
 private animate(role:'palm'|'print',frames:Keyframe[],duration:number,phase:string,finishedPhase:string){
  const previous=role==='palm'?this.palmAnimation:this.printAnimation;previous?.cancel()
  const animation=(role==='palm'?this.palm:this.print).animate(frames,{duration,easing:'linear',fill:'both'})
  if(role==='palm')this.palmAnimation=animation;else this.printAnimation=animation
  this.event(role,phase)
  if(this.paused)animation.pause()
  void animation.finished.then(()=>{
   if(!this.disposed&&(role==='palm'?this.palmAnimation:this.printAnimation)===animation)this.event(role,finishedPhase)
  },()=>{}) // cancel releases the old effect; a late completion cannot mutate its successor.
 }
 present(pose:Pose){
  if(this.disposed||this.paused)return
  if(pose.palm>=0&&pose.cycleId!==this.cycleId){
   this.cycleId=pose.cycleId
   if(pose.contactAt===undefined&&!pose.reduced){
    const progress=Math.min(.5,Math.max(0,pose.palm)),remaining=75-progress*150,offset=(1-progress*2)*12
    this.animate('palm',[{transform:`translate(${offset}px,${-offset}px) rotate(${(1-progress*2)*-35}deg)`,opacity:1},{transform:centre,opacity:1}],remaining,'approach','hold')
   }else if(pose.reduced){this.palmAnimation?.cancel();this.palmAnimation=undefined;this.event('palm','reduced')}
  }
  if(pose.contactAt!==undefined&&this.landedCycle!==pose.cycleId){
   this.landedCycle=pose.cycleId;this.contactAt=pose.contactAt
   if(!pose.reduced)this.animate('palm',[{transform:centre,opacity:1},{transform:retreated,opacity:0}],75,'retreat','idle')
   this.animate('print',[{opacity:.72},{opacity:0}],500,'fade','idle')
  }
  if(pose.reduced&&this.palmAnimation){this.palmAnimation.cancel();this.palmAnimation=undefined;this.event('palm','reduced')}
 }
 pause(){if(this.disposed||this.paused)return;this.paused=true;this.palmAnimation?.pause();this.printAnimation?.pause()}
 resume(){if(this.disposed||!this.paused)return;this.paused=false;for(const animation of [this.palmAnimation,this.printAnimation])if(animation&&animation.playState!=='finished')animation.play()}
 snapshot(){return{cycleId:this.cycleId,contactAt:this.contactAt,paused:this.paused,palmPhase:this.palmPhase,printPhase:this.printPhase,palmCurrentTime:this.palmAnimation?.currentTime??null,printCurrentTime:this.printAnimation?.currentTime??null,palmPlayState:this.palmAnimation?.playState??'idle',printPlayState:this.printAnimation?.playState??'idle'}}
 dispose(){if(this.disposed)return;this.disposed=true;this.palmAnimation?.cancel();this.printAnimation?.cancel();this.palmAnimation=this.printAnimation=undefined}
}
