// Rebuild the bundled bridge from Java sources with pinned, verified compile-only dependencies.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{execFileSync}=require('node:child_process')
const root=path.resolve(__dirname,'..'),bridge=path.join(root,'bridge'),classes=path.join(bridge,'build/classes'),output=path.join(bridge,'dist/kamucl-bridge-1.0.1.jar')
const dependencies=[
 {file:'net/fabricmc/fabric-loader/0.19.5/fabric-loader-0.19.5.jar',base:'https://maven.fabricmc.net/',hash:'93044e4dd46de5d8136701292f05e868da096d2c9fddb4793e4fdbcc63efc695'},
 {file:'com/google/code/gson/gson/2.14.0/gson-2.14.0.jar',base:'https://repo.maven.apache.org/maven2/',hash:'2cbd119bf1961c28788310963dc80ba65f58cdeec1dd139c8bdb1240faa2c36f'}]
const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
async function main(){
 const cp=[]
 for(const dep of dependencies){const file=path.join(bridge,'.cache',path.basename(dep.file));fs.mkdirSync(path.dirname(file),{recursive:true});if(!fs.existsSync(file)||hash(file)!==dep.hash){
   const local=process.env.KAMUCL_BUILD_LIBS&&path.join(process.env.KAMUCL_BUILD_LIBS,dep.file)
   if(local&&fs.existsSync(local)&&hash(local)===dep.hash)fs.copyFileSync(local,file)
   else{const response=await fetch(dep.base+dep.file);if(!response.ok)throw new Error(`Build dependency HTTP ${response.status}`);const data=Buffer.from(await response.arrayBuffer());if(crypto.createHash('sha256').update(data).digest('hex')!==dep.hash)throw new Error('Build dependency checksum mismatch');fs.writeFileSync(file,data)}
 }cp.push(file)}
 const tool=name=>process.env.JAVA_HOME?path.join(process.env.JAVA_HOME,'bin',name+(process.platform==='win32'?'.exe':'')):name
 if(!classes.startsWith(bridge+path.sep))throw new Error('Invalid build output path')
 fs.rmSync(classes,{recursive:true,force:true});fs.mkdirSync(classes,{recursive:true});fs.mkdirSync(path.dirname(output),{recursive:true})
 const sources=[];const scan=dir=>{for(const entry of fs.readdirSync(dir,{withFileTypes:true})){const file=path.join(dir,entry.name);if(entry.isDirectory())scan(file);else if(file.endsWith('.java'))sources.push(file)}};scan(path.join(bridge,'src/cn'))
 execFileSync(tool('javac'),['-encoding','UTF-8','--release','17','-cp',cp.join(path.delimiter),'-d',classes,...sources],{stdio:'inherit',windowsHide:true})
 fs.copyFileSync(path.join(bridge,'src/fabric.mod.json'),path.join(classes,'fabric.mod.json'))
 execFileSync(tool('jar'),['cf',output,'-C',classes,'.'],{stdio:'inherit',windowsHide:true});console.log('Built bridge: '+output)
}
main().catch(error=>{console.error(error.message);process.exitCode=1})
