// Extra raycast/PNG coverage on the real package, with the existing isolated profile.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict')
const modulePath=require.resolve('./verify-extension-ui.cjs'),original=require(modulePath)
require.cache[modulePath].exports=async ctx=>{
 await original(ctx)
 const {evaluate,call,main,nav,wait,root,screenshot}=ctx
 const button=async text=>evaluate(`(()=>{const e=[...document.querySelectorAll('.skins-page button,.skin-editor button')].find(e=>e.textContent.trim()===${JSON.stringify(text)});if(!e)throw Error('Missing button');e.click()})()`)
 await nav('skins');await button('绘制皮肤');await wait(500);await button('正面');await wait(500)
 const output=path.join(root,'surface-skin.png');await main(`testElectron.dialog.showSaveDialog=async()=>({canceled:false,filePath:${JSON.stringify(output)}})`)
 const select=async value=>evaluate(`(()=>{const e=document.querySelector('.skin-editor aside select');e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('change',{bubbles:true}))})()`)
 const paint=async(x,y)=>{const r=await evaluate(`(()=>{const r=document.querySelector('.skin-editor canvas').getBoundingClientRect();return{x:r.x,y:r.y,w:r.width,h:r.height}})()`);x=r.x+r.w*x;y=r.y+r.h*y;for(const [type,buttons]of [['mouseMoved',0],['mousePressed',1],['mouseReleased',0]])await call('Input.dispatchMouseEvent',{type,x,y,button:type==='mouseMoved'?'none':'left',buttons,clickCount:type==='mouseMoved'?0:1})}
 const result={version:ctx.version,models:{},layout:[]}
 for(const variant of ['classic','slim']){
  await select(variant);await button('新建');await wait(200)
  await evaluate(`(()=>{const e=document.querySelector('.skin-editor .palette-hex');e.value='#1177ee';e.dispatchEvent(new Event('input',{bubbles:true}))})()`)
  for(const [x,y]of [[.385,.44],[.615,.44],[.5,.44],[.46,.76],[.54,.76]])await paint(x,y)
  await button('保存 PNG…');await wait(250)
  const pixels=await main(`(()=>{const b=testElectron.nativeImage.createFromPath(${JSON.stringify(output)}).toBitmap(),p=[];for(let i=0;i<b.length;i+=4)if(b[i]===238&&b[i+1]===119&&b[i+2]===17)p.push([i/4%64,Math.floor(i/4/64)]);return p})()`)
  const face=(x,y,w,h)=>pixels.some(([px,py])=>px>=x&&px<x+w&&py>=y&&py<y+h)
  assert(face(44,20,variant==='slim'?3:4,12),variant+' right arm UV: '+JSON.stringify(pixels));assert(face(36,52,variant==='slim'?3:4,12),variant+' left arm UV')
  assert(face(20,20,8,12),'body UV');assert(face(4,20,4,12),'right leg UV');assert(face(20,52,4,12),'left leg UV');result.models[variant]=pixels
 }
 for(const [w,h,zoom]of [[960,620,1],[1280,900,1.25],[980,720,1.5]]){
  await main(`testElectron.BrowserWindow.getAllWindows()[0].setSize(${w},${h});testElectron.BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(${zoom})`);await wait(300)
  const layout=await evaluate(`(()=>{const e=document.querySelector('.skin-editor'),r=e.getBoundingClientRect();return{width:innerWidth,height:innerHeight,left:r.left,right:r.right,top:r.top,bottom:r.bottom,scroll:e.scrollWidth,client:e.clientWidth}})()`)
  assert(layout.left>=-1&&layout.right<=layout.width+1&&layout.top>=-1&&layout.bottom<=layout.height+1,JSON.stringify(layout));assert(layout.scroll<=layout.client+2,JSON.stringify(layout));result.layout.push({w,h,zoom,...layout});await screenshot('extension-skin-surface-'+w+'-'+zoom)
 }
 await evaluate(`document.querySelector('[aria-label="关闭绘制皮肤"]').click()`)
 await main('testElectron.BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(1);testElectron.BrowserWindow.getAllWindows()[0].setSize(1280,900)')
 fs.writeFileSync('out/skin-surfaces-ui.json',JSON.stringify(result,null,2));console.log('PASS both arm models, body/leg UVs and skin editor minimum/zoom layout')
}
process.env.KAMUCL_EXTENSION_GUI='1';process.env.KAMUCL_EXTENSION_ONLY='1'
require('./verify-ui-refinement.cjs')
