// Real official binary in an isolated profile. No public room is created or joined.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict'),crypto=require('node:crypto')
const {build}=require('esbuild')
const root=fs.mkdtempSync(path.resolve('out/terracotta-verify-'))
async function main(){
  const archive=path.resolve('out/terracotta-official-0.4.2.tar.gz')
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(archive)).digest('hex'),'07ebe139e3ca5f74576e58b1a96efe59abdfbe148d3f1a49bfdca8b6f70745f0')
  let downloads=0
  const server=http.createServer((_q,r)=>{downloads++;r.writeHead(200,{'content-length':fs.statSync(archive).size});fs.createReadStream(archive).pipe(r)})
  await new Promise(r=>server.listen(0,'127.0.0.1',r))
  const src=fs.readFileSync('src/main/core/terracotta.ts','utf8').replace(/const DOWNLOAD_BASES = \[[\s\S]*?\n\]/,`const DOWNLOAD_BASES = ['http://127.0.0.1:${server.address().port}']`)+ '\nexport const qa={startProcess,tcGet};'
  const bundle=await build({stdin:{contents:src,resolveDir:path.resolve('src/main/core'),loader:'ts'},bundle:true,write:false,platform:'node',format:'cjs',external:['electron']})
  const mod={exports:{}},events=[],handlers={}
  new Function('require','module','exports',bundle.outputFiles[0].text)(id=>id==='electron'?{app:{getPath:()=>root},BrowserWindow:{getAllWindows:()=>[{isDestroyed:()=>false,webContents:{send:(_c,e)=>events.push(e)}}]}}:require(id),mod,mod.exports)
  const api=mod.exports;api.registerTerracottaIpc({handle:(name,fn)=>handlers[name]=fn})
  try{
    assert.equal((await handlers['tc:status']()).binaryReady,false)
    await handlers['tc:start'](null,{mode:'host'})
    assert.equal(downloads,0,'浏览或启动不能偷偷下载')
    await handlers['tc:install']();assert.equal(downloads,1)
    assert.equal((await handlers['tc:status']()).binaryReady,true)
    await api.qa.startProcess()
    const state=JSON.parse(await api.qa.tcGet('/state'))
    assert(state && typeof state==='object')
    await handlers['tc:stop']()
    assert.equal((await handlers['tc:status']()).running,false)
    fs.writeFileSync(path.join(root,'result.json'),JSON.stringify({pass:true,downloads,state,progressEvents:events.filter(e=>e.type==='status').length},null,2))
    console.log('PASS manual install, official archive/exe digests, real local service /state, clean stop: '+root)
  }finally{fs.writeFileSync(path.join(root,'events.json'),JSON.stringify(events,null,2));await api.stopTerracottaOnQuit();server.close()}
}
main().catch(e=>{console.error(e);process.exitCode=1})
