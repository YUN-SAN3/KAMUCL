import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import dgram from 'node:dgram'
import net from 'node:net'
import crypto from 'node:crypto'
import { createRequire } from 'node:module'
import { build } from 'esbuild'
import AdmZip from 'adm-zip'
import { TurnSession, TurnCodec, probeTurnNodes } from '../src/main/core/voxlink/turn'
import { derivePunchKey, signPunchFrame, verifyPunchFrame } from '../src/main/core/voxlink/punchAuth'
import { RudpConn } from '../src/main/core/voxlink/rudp'
import { TcpBridge, startHostLazyBridge } from '../src/main/core/voxlink/bridge'
import { TurnRelay } from '../src/main/core/voxlink/turnRelay'

const req=createRequire(path.resolve('package.json'))
async function isolated(entry:string, root:string, plugins:any[]=[]) {
  const output=await build({entryPoints:[entry],bundle:true,write:false,platform:'node',format:'cjs',packages:'external',plugins})
  const mod={exports:{} as any}
  new Function('require','module','exports','__dirname',output.outputFiles[0].text)((id:string)=>id==='electron'?{app:{getPath:()=>root,isPackaged:false},BrowserWindow:{getAllWindows:()=>[]}}:req(id),mod,mod.exports,path.join(root,'worker'))
  return mod.exports
}
test('资源扫描：空版本友好错误、同名版本按文件夹隔离、3000 项非递归读取且后台解析不阻塞',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'kamucl-resource-1046-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}))
  const api=await isolated('src/main/core/resourceDirectory.ts',root)
  await assert.rejects(api.resolveResourceDirectory(root,'','mods'),/请先安装或选择/)
  await assert.rejects(api.resolveResourceDirectory(root,'missing','mods'),/已移除或版本描述损坏/)
  for(const folder of ['a','b']){
    const dir=path.join(root,folder,'versions','same');fs.mkdirSync(path.join(dir,'mods'),{recursive:true})
    fs.writeFileSync(path.join(dir,'same.json'),JSON.stringify({id:'same',_gameDir:true}))
    fs.writeFileSync(path.join(dir,'mods',folder+'.jar'),'x')
  }
  const dir=await api.resolveResourceDirectory(path.join(root,'a'),'same','mods')
  assert.equal(dir,path.join(root,'a','versions','same','mods'))
  assert.deepEqual((await api.listResourceEntries(await api.resolveResourceDirectory(path.join(root,'b'),'same','mods'))).map((x:any)=>x.name),['b.jar'])
  const zip=new AdmZip();zip.addFile('fabric.mod.json',Buffer.from('{"id":"test","version":"1","name":"测试模组"}'));const bytes=zip.toBuffer()
  for(let i=0;i<3000;i++)fs.writeFileSync(path.join(dir,`${i}.jar`),bytes)
  fs.mkdirSync(path.join(dir,'nested'));fs.writeFileSync(path.join(dir,'nested','invisible.jar'),bytes)
  const started=performance.now();const entries=await api.listResourceEntries(dir)
  assert.equal(entries.length,3002);assert(!entries.some((x:any)=>x.name==='invisible.jar'));assert(performance.now()-started<5000)
  await build({entryPoints:['src/main/core/modScanWorker.ts'],outfile:path.join(root,'worker','modScanWorker.cjs'),bundle:true,platform:'node',format:'cjs'})
  const scanner=await isolated('src/main/core/modScan.ts',root)
  let ticks=0;const timer=setInterval(()=>ticks++,5)
  try{const result=await scanner.scanModDirectory(dir,true);assert.equal(result.length,3001);assert(result.some((x:any)=>x.name==='测试模组'&&x.sha1===crypto.createHash('sha1').update(bytes).digest('hex')));assert(ticks>5,'工作线程解析时主线程应继续响应')}
  finally{clearInterval(timer)}
})

test('TURN：官方帧结构、绑定重试、票据错误、带认证可靠 UDP 经真实 TCP 双向传输 512KB 并退出', {timeout:20000},async t=>{
  const server=dgram.createSocket('udp4');await new Promise<void>(r=>server.bind(0,'127.0.0.1',r));t.after(()=>server.close())
  const port=server.address().port,sid='00112233445566778899aabbccddeeff',peers=new Map<number,dgram.RemoteInfo>();let binds=0,unbinds=0
  server.on('message',(p,from)=>{
    if(p[3]===1){const pong=Buffer.alloc(24);p.copy(pong);pong[3]=2;server.send(pong,from.port,from.address)}
    if(p[3]===3){binds++;if(binds===1)return;const answer=Buffer.alloc(22);p.copy(answer,0,0,21);answer[3]=4;answer[21]=p.subarray(23).toString()==='ticket'?0:1;if(!answer[21])peers.set(p[20],from);server.send(answer,from.port,from.address)}
    if(p[3]===5){const peer=peers.get(p[21]);if(peer)server.send(p,peer.port,peer.address)}
    if(p[3]===8){unbinds++;peers.delete(p[20])}
  })
  const controller=new AbortController();t.after(()=>controller.abort())
  const nodes=await probeTurnNodes([{id:'local',host:'127.0.0.1',port}],controller.signal);assert(nodes[0].rtt>=0)
  const data={sessionId:sid,host:'127.0.0.1',port,ticket:'ticket'}
  const host=await TurnSession.bind(data,1,controller.signal),guest=await TurnSession.bind(data,2,controller.signal)
  t.after(()=>{host.close();guest.close()});assert(binds>=3)
  await assert.rejects(TurnSession.bind({...data,ticket:'wrong'},2,controller.signal),/凭据无效/)
  const frame=Buffer.from('564c0300000001000000020003616263','hex'),key=derivePunchKey('ABCDEF','guest')
  const signed=signPunchFrame(frame,key);assert(verifyPunchFrame(signed,key));const corrupt=Buffer.from(signed);corrupt[4]^=1;assert.equal(verifyPunchFrame(corrupt,key),null)
  const encoded=host.codec.encode(signed);assert.equal(encoded.subarray(0,24).toString('hex'),'564c0105'+sid+'0102'+signed.length.toString(16).padStart(4,'0'))
  assert.deepEqual(guest.codec.decode(encoded),signed);assert.equal(new TurnCodec('f'.repeat(32),2).decode(encoded),null)
  const hr=new RudpConn(host.socket,host.target,{codec:host.codec,authKey:key,ownsSocket:false}),gr=new RudpConn(guest.socket,guest.target,{codec:guest.codec,authKey:key,ownsSocket:false});hr.start();gr.start();t.after(()=>{hr.close();gr.close()})
  const sockets=new Set<net.Socket>();const echo=net.createServer(s=>{sockets.add(s);s.on('error',()=>{});s.on('data',b=>s.write(b));s.on('close',()=>sockets.delete(s))});await new Promise<void>(r=>echo.listen(0,'127.0.0.1',r));t.after(()=>{for(const s of sockets)s.destroy();echo.close()})
  void startHostLazyBridge(hr,(echo.address() as net.AddressInfo).port,(_l,s)=>t.diagnostic(s))
  const {addr,bridge}=await TcpBridge.startGuest(gr,()=>{});t.after(()=>bridge.stop())
  const client=net.connect(Number(addr.split(':')[1]),'127.0.0.1');t.after(()=>client.destroy());client.on('error',()=>{})
  const payload=crypto.randomBytes(512*1024)
  const received=await new Promise<Buffer>((resolve,reject)=>{let size=0;const chunks:Buffer[]=[];client.on('error',e=>{t.diagnostic(JSON.stringify({size,hr:(hr as any).closeMsg,gr:(gr as any).closeMsg,host:(hr as any).nextExpected,guest:(gr as any).nextExpected}));reject(e)});client.on('data',b=>{chunks.push(b);size+=b.length;if(size>=payload.length)resolve(Buffer.concat(chunks))});client.on('connect',()=>client.write(payload))})
  assert.deepEqual(received,payload)
  bridge.stop();hr.close();gr.close();host.close();guest.close();await new Promise(r=>setTimeout(r,50));assert.equal(unbinds,2)
  assert(bridge.isStopped());assert(!bridge.ln?.listening)
})

test('TURN：退出期间晚到的分配结果必须释放且不能复活房间',async()=>{
  let room:any={code:'ABCDEF',token:'secret',clientId:'guest',isHost:false,hostPort:0,hostAuth:true},allocated:(v:any)=>void=()=>{},releases=0,connected=0
  const pending=new Promise(r=>allocated=r)
  const relay=new TurnRelay({api:{get:async(_b:string,p:string)=>p==='/relay/status'?{enabled:true}:{nodes:[{id:'node',host:'127.0.0.1',port:9}]},post:async(_b:string,p:string)=>{if(p==='/relay/allocate')return pending;if(p==='/relay/release')releases++;return {}}} as any,baseURL:()=>'',room:()=>room,directConnected:()=>false,connected:()=>connected++,stage:()=>{},state:()=>{},signal:async()=>{},log:()=>{}})
  const running=relay.startGuest();await new Promise(r=>setTimeout(r,4300));room=null;relay.stop();allocated({sessionId:'1'.repeat(32),host:'127.0.0.1',port:9,hostTicket:'a',guestTicket:'b'});await running
  assert.equal(connected,0);assert.equal(releases,1);assert.equal(relay.busy(),false)
})

test('FRP：创建使用 Bearer 与实际本地端口；运行只允许当前账号可用 TCP 隧道',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'kamucl-frp-1046-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}))
  const requests:any[]=[];let banned=false
  ;(globalThis as any).__frpTestFetch=async(url:string,options:any)=>{requests.push({url,...options});const p=new URL(url).pathname
    const body=p.endsWith('/nodes')?{'7':{name:'节点',flag:4,vip:0}}:p.endsWith('/node/stats')?{nodes:[{id:7,online:0,load:1}]}:options.method==='POST'?{id:123,name:'MC',remote:'40001'}:[{id:123,name:'MC',type:'tcp',node:7,local_ip:'127.0.0.1',local_port:25566,status:banned?2:0}]
    return new Response(JSON.stringify(body),{status:options.method==='POST'?201:200})}
  t.after(()=>delete (globalThis as any).__frpTestFetch)
  const api=await isolated('src/main/core/frpNodes.ts',root,[{name:'mock-http',setup(b:any){b.onResolve({filter:/^\.\/httpClient$/},()=>({path:'mock',namespace:'mock'}));b.onLoad({filter:/.*/,namespace:'mock'},()=>({contents:'export const httpFetch=(...args)=>globalThis.__frpTestFetch(...args)'}))}}])
  const created=await api.createFrpTunnel('test-key',{name:'MC',node:7,localPort:25566});assert.equal(created.id,123)
  const post=requests.find(r=>r.method==='POST');assert.deepEqual(JSON.parse(post.body),{name:'MC',type:'tcp',node:7,local_ip:'127.0.0.1',local_port:25566});assert.equal(post.headers.Authorization,'Bearer test-key');assert(!post.url.includes('test-key'))
  assert.equal((await api.getRunnableFrpTunnel('test-key','123')).localPort,25566)
  banned=true;await assert.rejects(api.getRunnableFrpTunnel('test-key','123'),/不可用|禁用|封禁/)
  await assert.rejects(api.createFrpTunnel('test-key',{name:'MC',node:7,localPort:0}),/端口/)
})
