import test from 'node:test'
import assert from 'node:assert/strict'
import dgram from 'node:dgram'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { once } from 'node:events'
import { TurnMessage,parseTurnMessage,encodeXorAddress,decodeXorAddress,turnLongTermKey,StdTurnCodec,StdTurnSession } from '../src/main/core/voxlink/stdTurn'
import { RudpConn,rudpEncode,RUDP_TYPE_DATA } from '../src/main/core/voxlink/rudp'
import { signPunchFrame } from '../src/main/core/voxlink/punchAuth'
import { punchListen } from '../src/main/core/voxlink/punch'
import { TicketService,TicketError } from '../src/main/core/voxlink/tickets'
import { decodeNbtString,encodeNbtString } from '../src/main/core/typedNbt'
import {WebSocketServer} from 'ws'
import {VoxlinkSession} from '../src/main/core/voxlink/session'
const wait=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms))
test('Modified UTF-8 retains NUL, non-BMP characters and unpaired Java surrogates',()=>{const value='投影\0😀\ud800';assert.equal(decodeNbtString(encodeNbtString(value)),value);assert.equal(encodeNbtString('\0😀').toString('hex'),'c080eda0bdedb880');assert.throws(()=>decodeNbtString(Buffer.from([0xe1,0x80])))})
test('standard TURN packets have RFC MI/FP lengths; XOR IPv4/IPv6 and ChannelData reject damaged packets',()=>{
 const id=Buffer.from('0102030405060708090a0b0c','hex'),key=turnLongTermKey('u','r','p'),packet=new TurnMessage(3,id).put(6,'u').put(20,'r').put(21,'n').number(25,17<<24).build(key)
 const parsed=parseTurnMessage(packet)!;assert.equal(parsed.type,3);assert.equal(packet.readUInt16BE(2),packet.length-20)
 const miOffset=packet.length-32,header=Buffer.from(packet.subarray(0,20));header.writeUInt16BE(miOffset+24-20,2)
 assert.deepEqual(parsed.attrs.get(8),crypto.createHmac('sha1',key).update(header).update(packet.subarray(20,miOffset)).digest())
 for(const address of ['192.0.2.1','2001:db8:0:0:0:0:0:1'])assert.deepEqual(decodeXorAddress(encodeXorAddress({address,port:65535},id),id),{address,port:65535})
 const codec=new StdTurnCodec();assert.deepEqual(codec.encode(Buffer.from([1,2,3])),Buffer.from([0x40,0,0,3,1,2,3]));assert.equal(codec.decode(Buffer.from([0x40,0,0,4,1])),null);assert.equal(codec.decode(packet),null);assert.equal(parseTurnMessage(packet.subarray(0,-1)),null)
})
test('standard TURN performs challenge/auth, permission, channel bind and lifetime-zero teardown over real UDP',async t=>{
 const server=dgram.createSocket('udp4');server.bind(0,'127.0.0.1');await once(server,'listening');t.after(()=>server.close())
 const port=(server.address() as dgram.AddressInfo).port,seen:number[]=[],lifetimes:number[]=[]
 server.on('message',(packet,from)=>{const request=parseTurnMessage(packet);if(!request)return;seen.push(request.type)
   let response:TurnMessage
   if(request.type===3&&!request.attrs.has(6))response=new TurnMessage(0x113,request.id).put(9,Buffer.from([0,0,4,1])).put(20,'fixture').put(21,'nonce')
   else if(request.type===3){assert(request.attrs.has(8));response=new TurnMessage(0x103,request.id).address(22,{address:'127.0.0.1',port}).number(13,600)}
   else if(request.type===8){assert.equal(decodeXorAddress(request.attrs.get(18),request.id)?.port,0);response=new TurnMessage(0x108,request.id)}
   else if(request.type===9){assert.deepEqual(request.attrs.get(12),Buffer.from([0x40,0,0,0]));response=new TurnMessage(0x109,request.id)}
   else if(request.type===4){lifetimes.push(request.attrs.get(13)!.readUInt32BE(0));return}else return
   server.send(response.build(),from.port,from.address)
 })
 const controller=new AbortController(),session=await StdTurnSession.allocate({host:'127.0.0.1',port,username:'fixture-user',password:'fixture-pass',expire:600},controller.signal);t.after(()=>session.close())
 await session.bind({address:'127.0.0.1',port:33333},controller.signal);assert.deepEqual(seen.slice(0,4),[3,3,8,9]);session.startKeepalive();session.close();await wait(30);assert.deepEqual(lifetimes,[0])
 const aborted=new AbortController();aborted.abort();await assert.rejects(StdTurnSession.allocate({host:'127.0.0.1',port,username:'u',password:'p',expire:600},aborted.signal))
})
test('RUDP uses 1374-byte TURN chunks, authenticates drift before malformed DATA length, and receives a secondary path without closing its primary',async t=>{
 const receiver=await punchListen(0),old=await punchListen(0),next=await punchListen(0),key=Buffer.alloc(32,7);t.after(()=>{for(const s of [receiver,old,next])try{s.close()}catch{}})
 const oldPort=old.address().port,targetPort=receiver.address().port,conn=new RudpConn(receiver,{address:'127.0.0.1',port:oldPort},{authKey:key,ownsSocket:false});conn.start();t.after(()=>conn.close())
 const short=signPunchFrame(Buffer.from([86,76,3,0,0,0,0,0,0,0,0]),key)
 next.send(Buffer.from([86,76,3,0,0,0,0,0,0,0,0]),targetPort,'127.0.0.1');await wait(15);assert.equal(conn.getRemote()?.port,oldPort)
 next.send(short,targetPort,'127.0.0.1');await wait(15);assert.equal(conn.getRemote()?.port,oldPort);next.send(short,targetPort,'127.0.0.1');await wait(15);assert.equal(conn.getRemote()?.port,next.address().port)
 const alt=await punchListen(0),peer=await punchListen(0);t.after(()=>{try{peer.close()}catch{}});assert(conn.addSecondaryPath(alt,{address:'127.0.0.1',port:peer.address().port}))
 peer.send(signPunchFrame(rudpEncode({type:8,seq:0,ack:0,payload:Buffer.alloc(0),fecCount:0,fecLengths:[]}),key),alt.address().port,'127.0.0.1');await wait(25);assert.equal(conn.secondaryHealth()?.rx,1);conn.dropSecondaryPath();assert(conn.isConnected())
 const tx=await punchListen(0),rx=await punchListen(0);t.after(()=>{for(const s of [tx,rx])try{s.close()}catch{}});const sizes:number[]=[];rx.on('message',p=>{if(p[2]===RUDP_TYPE_DATA)sizes.push(p.readUInt16BE(11))});const turn=new RudpConn(tx,{address:'127.0.0.1',port:rx.address().port},{codec:{encode:p=>p,decode:p=>p},ownsSocket:false});turn.start();t.after(()=>turn.close());await turn.write(Buffer.alloc(2800));await wait(30);assert.deepEqual(sizes,[1374,1374,52])
})
test('tickets keep secrets out of snapshots, stream chosen attachments, encode detail query correctly, mark viewed and remove orphaned secrets',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'kamucl-tickets-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const file=path.join(root,'attachment.txt');fs.writeFileSync(file,'chosen attachment');const stat=fs.statSync(file),requests:any[]=[]
 const request=async(url:any,init:any)=>{const u=new URL(url),route=u.searchParams.get('route');let body='';if(typeof init.body==='string')body=init.body;else if(init.body)for await(const bytes of init.body)body+=Buffer.from(bytes).toString();requests.push({url:u,route,body});let data:any={}
   if(route==='/ticket/submit')data={id:'fixture-1',ticketSecret:'s+/&=fixture'}
   if(route==='/ticket/detail')data={id:'fixture-1',time:1,description:'problem',attachments:[],messages:[{id:'m1',from:'player',time:2,text:'reply',attachments:[]},{id:'m2',from:'admin',time:3,text:'answer',attachments:[]}]}
   if(route==='/ticket/poll')data={tickets:[],removed:['fixture-1']}
   return new Response(JSON.stringify({success:true,data}))
 }
 const service=new TicketService(path.join(root,'tickets.json'),()=> 'https://fixture.invalid/',{seal:s=>'sealed:'+Buffer.from(s).toString('base64'),open:s=>Buffer.from(s.slice(7),'base64').toString()},request as typeof fetch),signal=new AbortController().signal
 await service.submit('problem',[{path:file,name:'attachment.txt',size:stat.size,mtime:stat.mtimeMs}],signal)
 assert(!JSON.stringify(service.list()).includes('secret'));assert(!fs.readFileSync(path.join(root,'tickets.json'),'utf8').includes('s+/&=fixture'));assert(requests[0].body.includes('chosen attachment'));assert(requests[0].body.includes('name="client"'));assert(requests[0].body.includes('\r\napp\r\n'))
 await service.detail('fixture-1',signal);const detail=requests.find(r=>r.route==='/ticket/detail');assert.equal(detail.url.searchParams.get('route'),'/ticket/detail');assert.equal(detail.url.searchParams.get('secret'),'s+/&=fixture');assert(requests.some(r=>r.route==='/ticket/viewed'))
 await assert.rejects(service.retract('fixture-1','m2',signal),/上一条/);await service.retract('fixture-1','m1',signal)
 await service.reply('fixture-1','follow-up',[],signal);await assert.rejects(service.reply('fixture-1','follow-up',[],signal),/15 秒/)
 await service.pollOnce(signal);assert.equal(service.list().length,0);assert(!fs.readFileSync(path.join(root,'tickets.json'),'utf8').includes('sealed:'))
})
test('ticket rate limits honor retryAfter; cancellation and changed files do not send attachments',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'kamucl-ticket-errors-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));let calls=0
 const service=new TicketService(path.join(root,'index'),()=> 'https://fixture.invalid/',undefined,(async()=>{calls++;return new Response(JSON.stringify({success:false,error:'RATE_LIMITED',details:{retryAfter:12}}),{status:429})}) as typeof fetch),signal=new AbortController().signal
 await assert.rejects(service.submit('x',[],signal),(e:TicketError)=>e.code==='RATE_LIMITED'&&e.retryAt!>Date.now()+11000);await assert.rejects(service.submit('x',[],signal),/稍后/);assert.equal(calls,1)
 const file=path.join(root,'f');fs.writeFileSync(file,'changed');await assert.rejects(new TicketService(path.join(root,'other'),()=> 'https://fixture.invalid/',undefined,(async()=>{throw Error('must not send')}) as typeof fetch).submit('x',[{path:file,name:'f',size:1,mtime:0}],signal),/变化/)
 const aborted=new AbortController();aborted.abort();await assert.rejects(service.submit('x',[],aborted.signal));assert.equal(calls,1)
 let unsafeCalls=0;const unsafe=new TicketService(path.join(root,'unsafe'),()=> 'https://fixture.invalid/',{seal:()=>{throw new TicketError('SECRET_UNAVAILABLE','系统凭证保护不可用')},open:s=>s},(async()=>{unsafeCalls++;throw Error('must not upload')}) as typeof fetch);await assert.rejects(unsafe.submit('x',[],signal),/凭证保护/);assert.equal(unsafeCalls,0)
})
test('native WebSocket emits control ping, detects half-open connections and cancels socket resources',async t=>{
 const server=new WebSocketServer({port:0,host:'127.0.0.1'});await once(server,'listening');let ping=0;const messages:string[]=[]
 server.on('connection',socket=>{socket.on('ping',()=>ping++);socket.on('message',buffer=>{const text=buffer.toString();messages.push(text);const request=JSON.parse(text);socket.send(JSON.stringify({id:request.id,success:true,data:{s:[],ts:1}}))})})
 const app={api:{do:async()=>({s:[]})} as any,baseURL:()=>`http://127.0.0.1:${(server.address() as any).port}/`,emit:()=>{},netLog:()=>{}}
 const session=new VoxlinkSession(app,{code:'ABCDEF',token:'fixture',isHost:false});t.after(async()=>{session.stop();for(const socket of server.clients)socket.terminate();await new Promise<void>(resolve=>server.close(()=>resolve()))})
 await session.request('/signal/poll',{since:0});assert.equal((session as any).pingTimer._idleTimeout,15000);assert.equal((session as any).watchdog._idleTimeout,10000)
 ;(session as any).pingTimer._onTimeout();await wait(30);assert.equal(ping,1);assert(messages.every(text=>JSON.parse(text).route==='/signal/poll'),'ping is never a text request')
 const previous=(session as any).socket;(session as any).lastFrame=Date.now()-36000;(session as any).watchdog._onTimeout();await wait(20);assert.notEqual((session as any).socket,previous);session.stop();assert(session.isDone());assert.equal((session as any).pending.size,0)
})
test('cancelling an in-flight standard TURN allocation closes UDP without a late session',async t=>{
 const server=dgram.createSocket('udp4');server.bind(0,'127.0.0.1');await once(server,'listening');t.after(()=>server.close());let received=0;server.on('message',()=>received++)
 const controller=new AbortController(),job=StdTurnSession.allocate({host:'127.0.0.1',port:(server.address() as any).port,username:'u',password:'p',expire:600},controller.signal);await wait(25);controller.abort();await assert.rejects(job);const count=received;await wait(250);assert.equal(received,count)
})
import {TurnBackground} from '../src/main/core/voxlink/turnBackground'
import {DEFAULT} from '../src/main/core/voxlink/punchProfiles'
test('TURN background advertises live socket mappings, authenticates both peers, promotes only after stable observations and releases resources',async t=>{
 const a=await punchListen(0),b=await punchListen(0),key=Buffer.alloc(32,11),hostTransport=new RudpConn(a,{address:'127.0.0.1',port:b.address().port},{authKey:key}),guestTransport=new RudpConn(b,{address:'127.0.0.1',port:a.address().port},{authKey:key});hostTransport.start();guestTransport.start();let promoted=0,released=0;const advertised:number[]=[];let host:TurnBackground,guest:TurnBackground;
 const common={valid:()=>true,template:()=>({profile:DEFAULT}),auth:key,probe:async(socket:any)=>({ip:'127.0.0.1',port:socket.address().port}),promoted:()=>promoted++,release:()=>released++,log:()=>{}};
 host=new TurnBackground({...common,host:true,peer:'guest',transport:hostTransport,mapping:()=>undefined,signal:async(type,data)=>{advertised.push(Number(data.port));void guest.direct({address:String(data.ip),port:Number(data.port)})}});
 guest=new TurnBackground({...common,host:false,peer:'host',transport:guestTransport,mapping:()=>({local:{address:'127.0.0.1',port:9},remote:{address:'127.0.0.1',port:9}}),signal:async(type,data)=>{if(type==='turn_bg_punch'){advertised.push(Number(data.port));void host.direct({address:String(data.ip),port:Number(data.port)})}}});
 t.after(()=>{host.stop();guest.stop();hostTransport.close();guestTransport.close()});await (guest as any).run();await wait(1200);assert.equal(advertised.length,2);assert(advertised.every(p=>p>0&&p!==9));assert(hostTransport.secondaryHealth()?.lastRx);assert(guestTransport.secondaryHealth()?.lastRx);assert.equal(promoted,0);(host as any).streak=0;(guest as any).streak=0;const hostObserve=(host as any).observe._onTimeout,guestObserve=(guest as any).observe._onTimeout;for(let i=0;i<20;i++){hostObserve();guestObserve()}assert.equal(promoted,2);(host as any).grace._onTimeout();(guest as any).grace._onTimeout();assert.equal(released,2);host.stop();guest.stop();assert.equal((host as any).sockets.size,0);assert.equal((guest as any).punchers.size,0)
})
import {Puncher} from '../src/main/core/voxlink/punch'
test('player relay standby uses the socket advertised in its request, handles duplicate notify and transfers a healthy transport on TURN death',async t=>{
 const primary=await punchListen(0),primaryPeer=await punchListen(0),relaySocket=await punchListen(0),key=Buffer.alloc(32,9),transport=new RudpConn(primary,{address:'127.0.0.1',port:primaryPeer.address().port});transport.start();let notified=0;let bg:TurnBackground,relayPunch:Puncher|undefined,relayTransport:RudpConn|undefined;
 bg=new TurnBackground({valid:()=>true,host:false,peer:'host',transport,mapping:()=>undefined,template:()=>({profile:DEFAULT}),auth:key,probe:async socket=>({ip:'127.0.0.1',port:socket.address().port}),signal:async(type,data)=>{if(type==='turn_stby'){notified++;return}if(type!=='relay_request')return;relayPunch=new Puncher({conn:relaySocket,authKey:key,profile:DEFAULT,timeoutMs:1000});relayPunch.setTarget({address:String(data.mappedIp),port:Number(data.mappedPort)});relayPunch.start();void bg.establishStandby({address:'127.0.0.1',port:relaySocket.address().port});void bg.establishStandby({address:'127.0.0.1',port:relaySocket.address().port});const peer=await relayPunch.wait();relayTransport=new RudpConn(relaySocket,peer);relayTransport.start()},promoted:()=>{},release:()=>{},log:()=>{}});
 t.after(()=>{bg.stop();relayPunch?.stop();relayTransport?.close();transport.close();for(const socket of [primaryPeer,relaySocket])try{socket.close()}catch{}});await (bg as any).requestStandby();await wait(80);assert.equal(notified,1);assert.equal((bg as any).standbyPending,undefined);assert.equal((bg as any).punchers.size,0);const standby=bg.takeStandby();assert(standby?.isConnected());t.after(()=>standby?.close());bg.stop();assert(standby.isConnected(),'ownership is transferred before TURN resources stop');await relayTransport!.write(Buffer.from('standby fixture'));const data=Buffer.alloc(64),size=await standby.read(data);assert.equal(data.subarray(0,size).toString(),'standby fixture')
})
