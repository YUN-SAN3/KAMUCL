import test from 'node:test'
import assert from 'node:assert/strict'
import {build} from 'esbuild'

test('樱花删除 API：精确账号与单条 ID、远端复核、锁定失败和响应不明',async t=>{
 let replies:any[]=[],calls:any[]=[]
 ;(globalThis as any).__frpDeleteHttp=async(url:string,init:any)=>{calls.push({url,...init});const next=replies.shift();if(next instanceof Error)throw next;return new Response(JSON.stringify(next.body),{status:next.status||200})}
 t.after(()=>delete (globalThis as any).__frpDeleteHttp)
 const bundle=await build({entryPoints:['src/main/core/frpNodes.ts'],bundle:true,write:false,platform:'node',format:'cjs',plugins:[{name:'http',setup(b){b.onResolve({filter:/^\.\/httpClient$/},()=>({path:'http',namespace:'mock'}));b.onLoad({filter:/.*/,namespace:'mock'},()=>({contents:'export const httpFetch=(...a)=>globalThis.__frpDeleteHttp(...a)'}))}}]})
 const mod={exports:{} as any};new Function('module','exports',bundle.outputFiles[0].text)(mod,mod.exports)
 const run=mod.exports.deleteFrpTunnel
 const reset=(...b:any[])=>{calls=[];replies=b}
 reset({body:[{id:11},{id:22}]},{body:{deleted:[11],failed:[]}},{body:[{id:22}]})
 assert.deepEqual(await run(' secret-key ','11'),{remoteDisconnectPending:false});assert.equal(calls.length,3)
 assert(calls.every(c=>c.headers.Authorization==='Bearer secret-key'&&!c.url.includes('secret-key')))
 assert.equal(calls[1].url,'https://api.natfrp.com/v4/tunnel/delete');assert.equal(calls[1].method,'POST');assert.equal(calls[1].body,'{"ids":"11"}')
 reset({body:[]});await run('secret-key','11');assert.equal(calls.length,1)
 reset({body:[{id:11}]},{body:{deleted:[],failed:[11]}},{body:[]});assert.equal((await run('secret-key','11')).remoteDisconnectPending,true)
 reset({body:[{id:11}]},{body:{code:403,msg:'locked secret-key'},status:500});await assert.rejects(run('secret-key','11'),/locked \*\*\*/);assert.equal(calls.length,2)
 reset({body:[{id:11}]},new Error('network'));await assert.rejects(run('secret-key','11'),/网络/);assert.equal(calls.length,2)
 reset({body:[{id:11}]},{body:{deleted:[11],failed:[]}},{body:[{id:11}]});await assert.rejects(run('secret-key','11'),/仍存在/)
 reset({body:[{id:11}]},{body:{deleted:[22],failed:[]}});await assert.rejects(run('secret-key','11'),/未确认删除/)
 reset();await assert.rejects(run('secret-key','11,22'),/无效/);assert.equal(calls.length,0)
})
