import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import assert from 'node:assert/strict'
import { versionInstallHarness } from '../tests/helpers/version-install-harness'
async function main(){
const source=process.argv[2]==='curseforge'?'curseforge':'modrinth'
const root=fs.mkdtempSync(path.join(os.tmpdir(),'KAMUCL real public search116 ')),records:any[]=[],proof:any={complete:false,classification:'Real public '+source+' metadata through current source; Electron profile is private test adapter, no UI, download or game qualification; headers/credentials not recorded',root,queries:[]}
const runtime=await versionInstallHarness(root,async(input:any,init:any)=>{
 const url=String(input);assert(['api.modrinth.com','api.curseforge.com','mod.mcimirror.top'].includes(new URL(url).hostname));const row:any={url,startedAt:Date.now()};records.push(row)
 const response=await fetch(input,{...init,signal:AbortSignal.timeout(30000)});row.status=response.status;row.finishedAt=Date.now();return response
})
try {
 for(const keyword of ['玉','物品管理器']){
  const query:any={keyword,source,kind:'mod',mcVersion:'1.20.1',loader:'fabric',sort:'relevance',offset:0,limit:10},result=await runtime.communitySearchPage(query)
  assert(result.items.length>0);assert(new Set(result.items.map(item=>item.projectId)).size===result.items.length)
  proof.queries.push({query,result})
 }
 assert(proof.queries[0].result.items.some((item:any)=>/jade/i.test(item.slug)))
 proof.complete=true
} catch(error:any){proof.error={name:error.name,message:error.message};process.exitCode=1}
finally{await runtime.closeHttpClient();proof.records=records;proof.sourceSha256=crypto.createHash('sha256').update(fs.readFileSync('src/main/core/community.ts')).digest('hex');proof.finishedAt=new Date().toISOString();const file='out/community116-real-'+source+'-'+crypto.randomUUID()+'.json';fs.writeFileSync(file,JSON.stringify(proof,null,2));console.log(JSON.stringify({complete:proof.complete,file,error:proof.error}))}
}
void main().catch(error=>{console.error(error.message);process.exitCode=1})
