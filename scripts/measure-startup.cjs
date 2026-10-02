// Measure the real production homepage with a native overlay, private empty game/account settings,
// and networking disabled. Does not include portable archive extraction. No user games are started.
// Usage: node scripts/measure-startup.cjs label [path/to/app.asar/out/main/index.js]
if (!process.versions.electron) {
  const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process');
  const dir=fs.mkdtempSync(path.resolve('out/startup-measure-')), results=[];
  for(let i=0;i<3;i++){
    const output=path.join(dir,i+'.json');
    const env={...process.env,BENCH_LABEL:process.argv[2]||'current',BENCH_OUTPUT:output,BENCH_START:String(Date.now()),BENCH_MAIN:process.argv[3]||''};
    delete env.ELECTRON_RUN_AS_NODE;
    const r=spawnSync(path.resolve('node_modules/electron/dist/electron.exe'),[__filename],{env,encoding:'utf8',windowsHide:true,timeout:45000});
    assert.equal(r.status,0,r.stdout+'\n'+r.stderr+(fs.existsSync(output)?fs.readFileSync(output,'utf8'):''));results.push(JSON.parse(fs.readFileSync(output,'utf8')));
  }
  const sorted=results.map(r=>r.stages.show).sort((a,b)=>a-b);
  const report={directory:dir,medianShowMs:sorted[1],scenario:'Production homepage, empty private settings, network disabled, no portable extraction',results};
  fs.writeFileSync(path.join(dir,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
} else {
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{spawn}=require('node:child_process');const {app,ipcMain,session}=require('electron');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'kamucl-boot-bench-'));const start=Number(process.env.BENCH_START)||Date.now();const result={label:process.env.BENCH_LABEL||'baseline',root,stages:{},errors:[]};
fs.mkdirSync(path.join(root,'data'),{recursive:true});fs.mkdirSync(path.join(root,'games'),{recursive:true});
app.setPath('userData',path.join(root,'data'));app.setPath('appData',root);app.setPath('sessionData',path.join(root,'session'));
fs.writeFileSync(path.join(root,'data/settings.json'),JSON.stringify({configVersion:1,gameDir:path.join(root,'games'),activeFolder:path.join(root,'games'),folders:[{path:path.join(root,'games'),name:'Benchmark',isDefault:true}],autoUpdate:false,theme:'blue-white'}));
global.fetch=async()=>{throw new Error('Benchmark: network disabled')};
app.whenReady().then(()=>session.defaultSession.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(_d,cb)=>cb({cancel:true})));
const signal=path.join(root,'boot.control');process.env.KAMUCL_BOOT_SIGNAL=signal;
const native=spawn(path.resolve('out/main/StartupFeedback.exe'),[signal,String(process.pid)],{env:{...process.env,KAMUCL_BOOT_PROBE:path.join(root,'paint.txt')},windowsHide:true,stdio:'ignore'});
const mark=n=>result.stages[n]=Date.now()-start;ipcMain.on('boot:stage',(_e,s)=>mark(s));ipcMain.on('boot:renderer-ready',()=>mark('rendererReady'));
let mainWindow;let finished=false;const finish=()=>{if(finished)return;finished=true;result.backgroundThrottlingAfterReady=mainWindow?.webContents.getBackgroundThrottling();if(result.stages.show-result.stages.rendererReady<2600)result.errors.push('Animation assembly/hold shortened');if(!result.backgroundThrottlingAfterReady)result.errors.push('Background throttling not restored');try{fs.writeFileSync(signal,'closed')}catch{};if(fs.existsSync(path.join(root,'paint.txt')))result.stages.firstPaint=Number(fs.readFileSync(path.join(root,'paint.txt'),'utf8'))-start;fs.writeFileSync(process.env.BENCH_OUTPUT,JSON.stringify(result,null,2));app.exit(result.errors.length?1:0)};
app.on('browser-window-created',(_e,w)=>{if(w.getTitle()!=='KAMUCL')return;mainWindow=w;mark('windowCreated');result.initiallyVisible=w.isVisible();result.backgroundThrottling=w.webContents.getBackgroundThrottling();w.webContents.on('console-message',(_e,l,m)=>{if(l>=3)result.errors.push(m)});w.webContents.once('did-finish-load',()=>mark('load'));w.once('ready-to-show',()=>mark('compositor'));w.once('show',()=>{mark('show');setTimeout(finish,700)});});
setTimeout(()=>{result.errors.push('timeout');finish()},30000).unref();
require(path.resolve(process.env.BENCH_MAIN||'release/win-unpacked/resources/app.asar/out/main/index.js'));

}
