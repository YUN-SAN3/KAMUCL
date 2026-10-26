export type FeedbackImagePhase='loading'|'loaded'|'decoding'|'decoded'|'cancelled'|'failed'
export type FeedbackImageEvent={name:'palm'|'print';phase:FeedbackImagePhase;at:number;reason?:string}

// decode() is a real readiness boundary. The deadline only rejects failure; it
// never makes an image ready. A late decode continuation cannot revive a closed
// or hidden initialization. Native decoding itself has no browser cancel API.
export function prepareFeedbackImages(
 entries:Array<{name:'palm'|'print';image:HTMLImageElement;url:string}>,
 observe:(event:FeedbackImageEvent)=>void,
 deadlineMs=3000
):{promise:Promise<void>;cancel:()=>void}{
 let finished=false,cancelled=false
 const cleanup:Array<()=>void>=[]
 let rejectAll!:(error:Error)=>void
 const failure=new Promise<never>((_resolve,reject)=>{rejectAll=reject})
 const report=(name:FeedbackImageEvent['name'],phase:FeedbackImagePhase,reason?:string)=>observe({name,phase,at:performance.now(),...(reason?{reason}:{})})
 const release=()=>{for(const clear of cleanup)clear()}
 const fail=(error:Error)=>{if(finished)return;finished=true;release();for(const {name,image} of entries){image.removeAttribute('src');report(name,cancelled?'cancelled':'failed',error.message)}rejectAll(error)}
 const timer=setTimeout(()=>fail(new Error(`反馈像素图片解码超时 (${deadlineMs}ms)`)),deadlineMs)
 cleanup.push(()=>clearTimeout(timer))
 const decoded=entries.map(({name,image,url})=>new Promise<void>((resolve,reject)=>{
  let started=false
  const onError=()=>{const error=new Error('反馈像素图片加载失败：'+name);reject(error);fail(error)}
  const onLoad=()=>{
   if(started||finished)return;started=true
   if(!image.naturalWidth||!image.naturalHeight){onError();return}
   report(name,'loaded');report(name,'decoding')
   let decoding:Promise<void>
   try{decoding=image.decode()}catch(error){decoding=Promise.reject(error)}
   void decoding.then(()=>{
    if(finished)return
    if(!image.complete||!image.naturalWidth){onError();return}
    report(name,'decoded');resolve()
   },error=>{if(!finished){const failure=new Error('反馈像素图片解码失败：'+String(error));reject(failure);fail(failure)}})
  }
  image.addEventListener('load',onLoad);image.addEventListener('error',onError)
  cleanup.push(()=>{image.removeEventListener('load',onLoad);image.removeEventListener('error',onError)})
  report(name,'loading');image.src=url
  if(image.complete&&image.naturalWidth)onLoad()
 }))
 const promise=Promise.race([Promise.all(decoded).then(()=>{}),failure]).then(()=>{finished=true;release()})
 return{promise,cancel:()=>{if(finished)return;cancelled=true;fail(new Error('反馈像素图片准备已取消'))}}
}
