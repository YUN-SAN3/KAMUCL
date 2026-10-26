// Standalone diagnostic. An unsupported accelerated format is a measured
// capability result, never a reason to skip or pass the original game test.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict'),cp=require('node:child_process')
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex')
function run({output=path.resolve('out/mac-opengl-capability120'),platform=process.platform,arch=process.arch,ci=process.env.GITHUB_ACTIONS,execute=cp.execFileSync}={}){
 const receipt={classification:'Native NSGL capability diagnostic only; no original world/graphics gate changed',startedAt:new Date().toISOString(),complete:false,commands:[],normalAcceptanceChanged:false,fallbackUsed:false,scope:'Accelerated 3.2/4.1 core default framebuffer attribute family; not a captured JVM-specific hint array',reference:'https://github.com/glfw/glfw/blob/master/src/nsgl_context.m'}
 fs.mkdirSync(output,{recursive:true});assert(!fs.existsSync(path.join(output,'receipt.json')),'Do not replace an earlier diagnostic attempt')
 const source=path.resolve(__dirname,'mac-opengl-capability120.swift'),exe=path.join(output,'native-opengl-capability')
 function command(file,args,timeout){const row={file,args,startedAt:new Date().toISOString(),complete:false};receipt.commands.push(row);try{const bytes=execute(file,args,{timeout,windowsHide:true,maxBuffer:2*1024*1024});row.complete=true;return Buffer.from(bytes)}catch(error){row.error={name:error.name,code:error.code??null,status:error.status??null,signal:error.signal??null};if(error.stdout)fs.writeFileSync(path.join(output,'failure-stdout.log'),Buffer.from(error.stdout));if(error.stderr)fs.writeFileSync(path.join(output,'failure-stderr.log'),Buffer.from(error.stderr));throw error}finally{row.finishedAt=new Date().toISOString()}}
 try{
  assert.equal(platform,'darwin');assert.equal(arch,'arm64');assert.equal(ci,'true','Only an authorized disposable native Mac runner')
  receipt.sourceCommit=command('git',['rev-parse','HEAD'],10000).toString().trim();assert(/^[a-f0-9]{40}$/.test(receipt.sourceCommit));receipt.sourceSHA256=hash(fs.readFileSync(source))
  command('/usr/bin/xcrun',['swiftc','-O','-target','arm64-apple-macos13.0',source,'-o',exe],60000)
  command('/usr/bin/lipo',[exe,'-verify_arch','arm64'],10000);command('/usr/bin/codesign',['--force','--sign','-',exe],10000);command('/usr/bin/codesign',['--verify','--strict',exe],10000)
  receipt.executableSHA256=hash(fs.readFileSync(exe));const bytes=command(exe,[],10000);fs.writeFileSync(path.join(output,'native-original.json'),bytes,{flag:'wx'});receipt.original={bytes:bytes.length,sha256:hash(bytes)}
  const native=JSON.parse(bytes);assert.equal(native.complete,true);assert.equal(native.platform,'darwin');assert.equal(native.probes.length,2)
  assert.deepEqual(native.probes.map(r=>r.profile),['3.2 core','4.1 core']);for(const row of native.probes){assert.equal(row.acceleratedRequested,true);assert.equal(row.fallbackUsed,false);assert.equal(typeof row.pixelFormatCreated,'boolean');assert.equal(typeof row.contextCreated,'boolean');assert(!row.contextCreated||row.pixelFormatCreated)}
  receipt.actual=native;receipt.acceleratedCoreAvailable=native.probes.some(r=>r.contextCreated);receipt.complete=true;return receipt
 }catch(error){receipt.error={name:error.name,message:error.message};throw error}
 finally{receipt.finishedAt=new Date().toISOString();fs.writeFileSync(path.join(output,'receipt.json'),JSON.stringify(receipt,null,2))}
}
module.exports={run}
if(require.main===module)try{console.log(JSON.stringify(run({output:process.argv[2]?path.resolve(process.argv[2]):undefined})))}catch(error){console.error(error.name+': '+error.message);process.exitCode=1}
