// QA provenance only. Hash immutable observer sources and original evidence.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict')
const digest=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
function leaf(name){assert(typeof name==='string'&&name.length&&name!=='.'&&name!=='..'&&!/[\\/:\0]/.test(name)&&!path.isAbsolute(name),'Only original relative leaf names are allowed');return name}
function ownedDirectory(root,directory){assert(fs.lstatSync(directory).isDirectory()&&!fs.lstatSync(directory).isSymbolicLink(),'Original evidence/source directories cannot be symbolic links');const base=fs.realpathSync(root),actual=fs.realpathSync(directory);assert(actual===base||actual.startsWith(base+path.sep),'Original source/evidence directory cannot escape its approved root');return actual}
function fileBinding(file){const stat=fs.lstatSync(file);assert(stat.isFile()&&!stat.isSymbolicLink(),'Original source/evidence files cannot be symbolic links');return{bytes:stat.size,sha256:digest(file)}}
function sourceBindings(files){return Object.fromEntries(files.map(file=>[leaf(file),fileBinding(path.join(__dirname,file))]))}
const common=['resource-baseline113.cjs','resource-callback113.cjs','resource-frames113.cjs','resource-provenance113.cjs','resource-fixtures113.cjs','resource-sample113.cjs','resource-visibility113.cjs','resource-legacy-restore113.cjs','qa-owned-process-119.cjs']
function collectorSources(platform){assert(['win32','darwin'].includes(platform));return{callbackEvidenceSchema:1,platform,files:sourceBindings([...common,...(platform==='win32'?['resource-native-win113.cjs','resource-win113-counter-guards.cjs','resource-occlusion113.cjs']:['resource-mac113-native.cjs','resource-native-mac113.swift'])])}}
function assertCollectorSources(proof,expected=collectorSources(proof.platform)){assert.deepEqual(proof.observerSources,expected,'Actual collector/helper source SHA must match the frozen callback contract');return true}
function rawEvidenceBindings(runFile){
 const root=path.dirname(path.resolve(runFile)),run=JSON.parse(fs.readFileSync(runFile)),result={run:fileBinding(runFile),sessions:[]}
 for(const group of run.groups)for(const label of['cold','warm']){
  const directory=path.resolve(group[label]);assert(directory.startsWith(root+path.sep),'Original evidence directory must belong to its own run root');ownedDirectory(root,directory)
  const proof=JSON.parse(fs.readFileSync(path.join(directory,'summary.json'))),names=new Set(['summary.json','native.jsonl','process.log',...(proof.platform==='win32'?['boot.json','boot-frames.txt']:[]),...proof.screenshots.map(s=>s.file)])
  const files={};for(const name of names){leaf(name);files[name]=fileBinding(path.join(directory,name))}
  const snapshot=proof.observerSourceSnapshot;let sourceSnapshot
  if(snapshot){leaf(snapshot.directory);const sourceDirectory=path.join(directory,snapshot.directory);verifySourceSnapshot(sourceDirectory,snapshot.files);assertFrozenBindings(snapshot.manifest,fileBinding(path.join(sourceDirectory,'source-bindings.json')));sourceSnapshot=structuredClone(snapshot)}
  result.sessions.push({i:group.i,kind:group.kind,label,directory:path.relative(root,directory),files,...(sourceSnapshot?{sourceSnapshot}:{})})
 }
 return result
}
function assertFrozenBindings(expected,actual){assert.deepEqual(actual,expected,'Frozen source or original evidence bytes changed; analysis must stop');return true}
function verifySourceSnapshot(directory,approvedFileBindings){ownedDirectory(path.dirname(directory),directory);for(const[name,binding]of Object.entries(approvedFileBindings)){leaf(name);assertFrozenBindings(binding,fileBinding(path.join(directory,name)))}return true}
function recordSourceSnapshot(directory,fileBindings){
 fs.mkdirSync(directory)
 ownedDirectory(path.dirname(directory),directory)
 for(const[name,binding]of Object.entries(fileBindings)){leaf(name);const source=path.join(__dirname,name);assertFrozenBindings(binding,fileBinding(source));const file=path.join(directory,name);fs.copyFileSync(source,file,fs.constants.COPYFILE_EXCL);assertFrozenBindings(binding,fileBinding(file))}
 const manifest=path.join(directory,'source-bindings.json');fs.writeFileSync(manifest,JSON.stringify(fileBindings,null,2)+'\n',{flag:'wx'});return{files:structuredClone(fileBindings),manifest:fileBinding(manifest)}
}
function verifyRawEvidenceSnapshot(runFile,originalBinding,artifactRunRoot=path.dirname(path.resolve(runFile))){
 assertFrozenBindings(originalBinding.run,fileBinding(runFile))
 for(const session of originalBinding.sessions){const parts=session.directory.split(/[\\/]/);assert(parts.length&&parts.every(part=>part&&part!=='.'&&part!=='..'&&!part.includes(':')),'Original binding must use relative owned evidence directories');const directory=path.join(artifactRunRoot,...parts);ownedDirectory(artifactRunRoot,directory);for(const[name,binding]of Object.entries(session.files)){leaf(name);assertFrozenBindings(binding,fileBinding(path.join(directory,name)))}if(session.sourceSnapshot){leaf(session.sourceSnapshot.directory);const sourceDirectory=path.join(directory,session.sourceSnapshot.directory);verifySourceSnapshot(sourceDirectory,session.sourceSnapshot.files);assertFrozenBindings(session.sourceSnapshot.manifest,fileBinding(path.join(sourceDirectory,'source-bindings.json')))}}
 return true
}
module.exports={fileBinding,sourceBindings,collectorSources,assertCollectorSources,rawEvidenceBindings,assertFrozenBindings,recordSourceSnapshot,verifySourceSnapshot,verifyRawEvidenceSnapshot}
