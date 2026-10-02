// Local diagnostic: solid contrast proves transmission; fine stripes prove blur.
const {app,BrowserWindow,screen,desktopCapturer}=require('electron');
const fs=require('fs'),path=require('path'),os=require('os'),koffi=require('koffi');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'KAMUCL-blur-pattern-'));
app.setPath('userData',root);const games=path.join(root,'games');fs.mkdirSync(games);
fs.writeFileSync(path.join(root,'settings.json'),JSON.stringify({gameDir:games,activeFolder:games,folders:[{path:games}],autoUpdate:false,theme:'blue-white'}));
const u=koffi.load('user32.dll'),pos=u.func('bool __stdcall SetWindowPos(uintptr_t,uintptr_t,int,int,int,int,uint32_t)');
const handle=w=>Number(w.getNativeWindowHandle().readBigUInt64LE());
const wait=ms=>new Promise(r=>setTimeout(r,ms));
app.on('browser-window-created',(_e,w)=>{
 if(w.getTitle()!=='KAMUCL')return;
 w.webContents.once('did-finish-load',async()=>{try{
  await wait(5000);const display=screen.getAllDisplays().find(d=>d.id!==screen.getPrimaryDisplay().id)||screen.getPrimaryDisplay(),area=display.workArea;
  w.setBounds({x:area.x+20,y:area.y+20,width:1200,height:800});w.show();w.maximize();w.setAlwaysOnTop(true);w.focus();await wait(1000);
  const back=new BrowserWindow({...area,frame:false,show:false,focusable:false,skipTaskbar:true,alwaysOnTop:true,backgroundColor:'#000000',webPreferences:{backgroundThrottling:false}});
  await back.loadURL('data:text/html,<html><body style="margin:0"></body></html>');back.showInactive();pos(handle(back),handle(w),0,0,0,0,0x413);
  const samples=[];
  for(const background of ['black','white','repeating-linear-gradient(90deg,black 0px,black 8px,white 8px,white 16px)']){
   await back.webContents.executeJavaScript('document.body.style.background='+JSON.stringify(background));await wait(1400);
   const sources=await desktopCapturer.getSources({types:['screen'],thumbnailSize:{width:Math.round(display.size.width*display.scaleFactor),height:Math.round(display.size.height*display.scaleFactor)}});
   const img=sources.find(s=>s.display_id===String(display.id)).thumbnail,size=img.getSize(),pixels=img.toBitmap?img.toBitmap():img.getBitmap();
   const x=Math.round((area.x+400-display.bounds.x)/display.bounds.width*size.width),y=Math.round((area.y+35-display.bounds.y)/display.bounds.height*size.height),width=Math.round(240*display.scaleFactor);
   const row=Array.from({length:width},(_,i)=>{const n=(y*size.width+x+i)*4;return(pixels[n]+pixels[n+1]+pixels[n+2])/3});
   const sorted=[...row].sort((a,b)=>a-b);samples.push({background,mean:row.reduce((a,b)=>a+b)/row.length,range:sorted.at(-1)-sorted[0],spread:sorted[Math.floor(sorted.length*.95)]-sorted[Math.floor(sorted.length*.05)]});
   fs.writeFileSync(path.join(root,`pattern-${samples.length}.png`),img.crop({x,y:y-10,width,height:40}).toPNG());
  }
  back.destroy();const transmission=samples[1].mean-samples[0].mean;
  const result={electron:process.versions.electron,root,samples,transmission,detailRatio:samples[2].spread/Math.max(1,transmission)};console.log(JSON.stringify(result));fs.writeFileSync('out/native-blur-pattern.json',JSON.stringify(result,null,2));
  app.exit(transmission>3&&result.detailRatio<.25?0:1);
 }catch(e){console.error(e);app.exit(1)}})
});
setTimeout(()=>app.exit(2),45000).unref();
require(path.resolve('out/main/index.js'));
