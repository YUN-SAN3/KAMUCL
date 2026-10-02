// QA-only observable for this pack's ordinary Minecraft title-screen buttons.
// It rejects red Mojang loading, uniform backgrounds and a lone progress bar.
// A human still inspects the final original PNG; this is not a universal OCR.
module.exports=function titleFrame(width,height,rgb){
 if(width<160||height<180||rgb.length!==width*height*3)throw Error('Invalid RGB title capture')
 const bands=[];let first=-1
 const finish=y=>{if(first>=0){const length=y-first;if(length>=height*.015&&length<=height*.18)bands.push({first,last:y-1});first=-1}}
 for(let y=Math.floor(height*.5);y<Math.floor(height*.95);y++){
  let neutral=0,total=0
  for(let x=Math.floor(width*.2);x<Math.floor(width*.8);x++){
   const k=(y*width+x)*3,r=rgb[k],g=rgb[k+1],b=rgb[k+2];total++
   if(r>=70&&r<=195&&Math.abs(r-g)<=7&&Math.abs(r-b)<=7)neutral++
  }
  if(neutral/total>=.7){if(first<0)first=y}else finish(y)
 }
 finish(Math.floor(height*.95))
 return{menuLike:bands.length>=2,bands,width,height}
}
