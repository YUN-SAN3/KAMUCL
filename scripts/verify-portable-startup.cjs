// Real portable cold/warm startup; private paths, no launcher settings and no Minecraft process.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process')
const version=require('../package.json').version
const root=fs.mkdtempSync(path.join(os.tmpdir(),'kamucl startup 中文-'))
const exe=path.join(root,`KAMUCL ${version}.exe`)
fs.copyFileSync(path.resolve(`release/KAMUCL-${version}.exe`),exe)
const results=[]
for(const phase of ['cold','warm']){
 const marker=path.join(root,phase+'.json'),probe=path.join(root,phase+'-paint.txt'),start=Date.now()
 const result=spawnSync(exe,['-e',`require('fs').writeFileSync(process.env.KAMUCL_START_PROOF,JSON.stringify({at:Date.now(),exe:process.execPath}));setTimeout(()=>{},1200)`],{env:{...process.env,ELECTRON_RUN_AS_NODE:'1',TEMP:root,TMP:root,KAMUCL_BOOT_PROBE:probe,KAMUCL_START_PROOF:marker},windowsHide:true,encoding:'utf8',timeout:90000})
 assert.ifError(result.error);assert.equal(result.status,0,result.stderr)
 const inner=JSON.parse(fs.readFileSync(marker,'utf8'));assert(fs.existsSync(probe),'native first-paint proof missing')
 const cache=path.join(path.dirname(inner.exe),'cache.ready');assert(fs.existsSync(cache))
 results.push({phase,firstPaintMs:Number(fs.readFileSync(probe,'utf8'))-start,electronEntryMs:inner.at-start,cache,cacheMtime:fs.statSync(cache).mtimeMs})
}
assert.equal(results[0].cache,results[1].cache);assert.equal(results[0].cacheMtime,results[1].cacheMtime,'warm run must not extract again')
assert(results[0].firstPaintMs<results[0].electronEntryMs,'particles must appear before Electron on cold launch')
assert(results[1].electronEntryMs<results[0].electronEntryMs,'warm launch must benefit from cached extraction')
fs.writeFileSync(path.join(root,'results.json'),JSON.stringify({version,results},null,2))
console.log(JSON.stringify({pass:true,root,results},null,2))
