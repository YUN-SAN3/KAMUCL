import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import dgram from 'node:dgram'
import net from 'node:net'
import { createRequire } from 'node:module'
import { build } from 'esbuild'
const require=createRequire(path.resolve('package.json'))
async function runtime(root:string,stun:string){const built=await build({entryPoints:['src/main/core/voxlink/engine.ts'],bundle:true,write:false,platform:'node',format:'cjs',packages:'external',plugins:[{name:'local-stun',setup(builder){builder.onLoad({filter:/[\\/]voxlink[\\/]stun\.ts$/},args=>({contents:fs.readFileSync(args.path,'utf8').replace(/export const STUN_SERVERS = \[[^\]]+\]/,`export const STUN_SERVERS = [${JSON.stringify(stun)}]`),loader:'ts'}))}}]});const module={exports:{} as any};new Function('require','module','exports',built.outputFiles[0].text)((id:string)=>id==='electron'?{app:{getPath:()=>root}}:require(id),module,module.exports);return module.exports}
const waitFor=async(check:()=>boolean)=>{const end=Date.now()+12000;while(!check()){if(Date.now()>end)throw new Error('connection timeout');await new Promise(r=>setTimeout(r,30))}}
test('replacement room engine: create/join, authenticated UDP plus TCP echo, leave cleanup', {timeout:25000},async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'kamucl-new-vox-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}))
 const stun=dgram.createSocket('udp4');await new Promise<void>(r=>stun.bind(0,'127.0.0.1',r));t.after(()=>stun.close())
 stun.on('message',(p,from)=>{const reply=Buffer.alloc(32);p.copy(reply);reply.writeUInt16BE(0x101);reply.writeUInt16BE(12,2);reply.writeUInt16BE(1,20);reply.writeUInt16BE(8,22);reply[25]=1;reply.writeUInt16BE(from.port,26);reply.set([127,0,0,1],28);stun.send(reply,from.port,from.address)})
 const echo=net.createServer(socket=>socket.pipe(socket));await new Promise<void>(r=>echo.listen(0,'127.0.0.1',r));t.after(()=>echo.close())
 const port=(echo.address() as net.AddressInfo).port,queues:{host:any[];guest:any[]}={host:[],guest:[]};let left=0
 const room={code:'ABCDEF',name:'测试房间',hostIp:'127.0.0.1',hostPort:port,hostCapabilities:['punchAuthV1']}
 const api={async post(_base:string,route:string,data:any){switch(route){case '/room/create':return{...room,hostToken:'host-token',expiresIn:600};case '/room/join':queues.host.push({from:'guest',type:'join_request',data:{clientCapabilities:['punchAuthV1']},timestamp:Date.now()});return{room,clientToken:'guest-token',clientId:'guest'};case '/room/leave':left++;return{};case '/signal/send':queues[data.to==='host'?'host':'guest'].push({from:data.isHost?'host':'guest',type:data.type,data:data.data,timestamp:Date.now()});return{};case '/signal/poll':return{s:queues[data.isHost?'host':'guest'].splice(0),ts:Date.now()};case '/room/heartbeat':return{heartbeatInterval:5,currentPlayers:2};default:throw new Error(route)}},async get(){return{}}}
 ;(api as any).do=(_base:string,_method:string,route:string,_query:unknown,body:unknown)=>api.post(_base,route,body)
 const {VoxlinkApp}=await runtime(root,`127.0.0.1:${stun.address().port}`)
 const host=new VoxlinkApp({api,serverURL:'http://127.0.0.1:1',settings:{theme:'light',allowRelay:false}}),guest=new VoxlinkApp({api,serverURL:'http://127.0.0.1:1',settings:{theme:'light',allowRelay:false}})
 t.after(async()=>{await guest.leaveRoom();await host.leaveRoom()})
 await host.createRoom({name:'测试房间',visible:true,hostPort:port});await guest.joinRoom({code:'ABCDEF'})
 await waitFor(()=>guest.engine.lastConnection?.status==='success')
 const addr=guest.engine.lastConnection.address;assert.match(addr,/^127\.0\.0\.1:/)
 const client=net.createConnection(Number(addr.split(':')[1]),'127.0.0.1');t.after(()=>client.destroy())
 const sent=Buffer.alloc(100000,81),chunks:Buffer[]=[];let count=0
 client.on('data',chunk=>{chunks.push(chunk);count+=chunk.length});await new Promise<void>(r=>client.once('connect',r));client.write(sent)
 await waitFor(()=>count===sent.length);assert.deepEqual(Buffer.concat(chunks),sent)
 await guest.leaveRoom();assert.equal(guest.state,'idle');assert.equal(guest.engine.joinedAt,0);assert.equal(guest.engine.session,null);assert(left>=1)
})
test('replacement room engine: late create completion is released and cannot revive cancelled session',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'kamucl-cancel-vox-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}))
 const echo=net.createServer(socket=>socket.end());await new Promise<void>(r=>echo.listen(0,'127.0.0.1',r));t.after(()=>echo.close())
 let finish!:(value:any)=>void,requested=false,left=0
 const api={async post(_base:string,route:string){if(route==='/room/create'){requested=true;return await new Promise(r=>finish=r)}if(route==='/room/leave'){left++;return{}}throw new Error(route)}}
 const {VoxlinkApp}=await runtime(root,'127.0.0.1:1'),app=new VoxlinkApp({api,settings:{theme:'light',allowRelay:false}})
 const create=app.createRoom({name:'测试房间',visible:true,hostPort:(echo.address() as net.AddressInfo).port});await waitFor(()=>requested);await app.leaveRoom();finish({code:'ABCDEF',hostToken:'token'});await assert.rejects(create,/取消/);assert.equal(app.state,'idle');assert.equal(app.engine.session,null);assert.equal(left,1)
})
