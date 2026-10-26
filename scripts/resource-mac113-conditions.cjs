// QA environment only: retain original preference evidence and verify writes
// in a disposable native runner. Actual renderer matchMedia remains mandatory.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process')
const DOMAIN='com.apple.universalaccess',KEYS=['reduceMotion','reduceTransparency']
function execute(args){const result=spawnSync('/usr/bin/defaults',args,{encoding:'utf8',timeout:10000});return{args,at:new Date().toISOString(),status:result.status,signal:result.signal,stdout:result.stdout,stderr:result.stderr,error:result.error?.message??null}}
function snapshot(){return{at:new Date().toISOString(),values:Object.fromEntries(KEYS.map(key=>[key,{read:execute(['read',DOMAIN,key]),type:execute(['read-type',DOMAIN,key])}]))}}
function main({directory=path.resolve('out/resource113/mac-native-conditions')}={}){
 assert.equal(process.platform,'darwin');assert.equal(process.arch,'arm64');assert.equal(process.env.GITHUB_ACTIONS,'true','Never change preferences on a player desktop; disposable native CI only')
 fs.mkdirSync(directory,{recursive:true});const file=path.join(directory,'conditions.json'),receipt={schema:1,sourceCommit:process.env.GITHUB_SHA,runId:process.env.GITHUB_RUN_ID,runAttempt:process.env.GITHUB_RUN_ATTEMPT,platform:process.platform,arch:process.arch,startedAt:new Date().toISOString(),before:snapshot(),writes:[],complete:false,scope:'Only disposable CI accessibility preferences, before any APP launch; original read values/status/errors retained. A missing original plist key is unavailable, never false. Actual native renderer matchMedia(false) must be proven separately; preference writes alone are not qualification.'}
 const save=()=>fs.writeFileSync(file,JSON.stringify(receipt,null,2)+'\n');save()
 try{for(const key of KEYS){const result=execute(['write',DOMAIN,key,'-bool','false']);receipt.writes.push(result);save();assert.equal(result.status,0,result.stderr||result.error)}receipt.after=snapshot();save();for(const key of KEYS){const value=receipt.after.values[key];assert.equal(value.read.status,0,value.read.stderr);assert.equal(value.type.status,0,value.type.stderr);assert.match(value.type.stdout,/boolean/i);assert(['0','false'].includes(value.read.stdout.trim()),'Written native preference must actually read as false: '+key)}receipt.complete=true;receipt.finishedAt=new Date().toISOString();save();console.log(JSON.stringify({file,complete:true,sourceCommit:receipt.sourceCommit,before:receipt.before,after:receipt.after}))}
 catch(error){receipt.failure={name:error.name,message:error.message,at:new Date().toISOString()};save();throw error}return receipt
}
module.exports={execute,snapshot,main}
if(require.main===module)try{main()}catch(error){console.error(error);process.exitCode=1}
