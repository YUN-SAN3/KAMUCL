/** Controllable Web Animations contract: effects advance even without a JS render callback. */
export function animationElement(now:()=>number){
 const animations:any[]=[],styles=new Map<string,string>()
 const element={style:{setProperty:(key:string,value:string)=>styles.set(key,value)},animate(frames:Keyframe[],options:KeyframeAnimationOptions){
  const duration=Number(options.duration);let start=now(),base=0,held:number|undefined,canceled=false,done=false,resolve!:()=>void,reject!:(reason:Error)=>void
  const finished=new Promise<void>((yes,no)=>{resolve=yes;reject=no})
  const animation={frames,options,createdAt:now(),finished,
   get currentTime(){if(canceled)return null;const time=Math.min(duration,held??base+(now()-start));if(time>=duration&&!done){done=true;resolve()}return time},
   get playState(){return canceled?'idle':held!==undefined?'paused':Number(this.currentTime)>=duration?'finished':'running'},
   pause(){if(!canceled)held=Number(this.currentTime)},play(){if(!canceled){base=held??Number(this.currentTime);start=now();held=undefined}},
   cancel(){if(canceled)return;canceled=true;if(!done)reject(Error('AbortError'))},
   get canceled(){return canceled}
  };animations.push(animation);return animation as unknown as Animation
 },getAnimations(){return animations.filter(a=>!a.canceled)}}
 const originalGet=styles.get.bind(styles)
 styles.get=(key:string)=>{const effect=element.getAnimations().at(-1);if(!effect)return originalGet(key)??(key==='opacity'?'0':undefined);const first=effect.frames[0],last=effect.frames.at(-1);if(key==='opacity'){const fraction=Number(effect.currentTime)/Number(effect.options.duration);return String(Number(first.opacity)+(Number(last.opacity)-Number(first.opacity))*fraction)}return originalGet(key)}
 return{element:element as unknown as HTMLElement,animations,styles}
}
