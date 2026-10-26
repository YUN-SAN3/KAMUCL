import test from 'node:test'
import assert from 'node:assert/strict'
import dgram from 'node:dgram'
import { once } from 'node:events'
import { createHash } from 'node:crypto'
import { RudpConn, rudpDecode, rudpEncode, RUDP_TYPE_DATA, RUDP_TYPE_FEC_XOR, RUDP_TYPE_ACK } from '../src/main/core/voxlink/rudp'
import { signPunchFrame, verifyPunchFrame } from '../src/main/core/voxlink/punchAuth'

const delay=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms))
const until=async(check:()=>boolean,timeout=8000)=>{const end=Date.now()+timeout;while(!check()){if(Date.now()>end)throw Error('transport fixture timeout');await delay(5)}}
async function socket(){const s=dgram.createSocket('udp4');s.bind(0,'127.0.0.1');await once(s,'listening');s.setRecvBufferSize(4*1024*1024);return s}
const port=(s:dgram.Socket)=>(s.address() as dgram.AddressInfo).port
const close=(s:dgram.Socket)=>{try{s.close()}catch{}}
const frame=(type:number,seq:number,payload=Buffer.alloc(0),lengths:number[]=[],ack=0)=>rudpEncode({type,seq,ack,payload,fecCount:lengths.length,fecLengths:lengths})
async function readBytes(c:RudpConn,total:number,slow=false){const chunks:Buffer[]=[];let count=0;while(count<total){const b=Buffer.alloc(1903),n=await c.read(b);if(!n)throw Error('closed before complete payload');chunks.push(b.subarray(0,n));count+=n;if(slow&&chunks.length%25===0)await delay(3)}return Buffer.concat(chunks)}

test('VoxLink reserves a bounded UDP burst queue while retaining larger existing receive buffers',async t=>{
 const a=dgram.createSocket('udp4');a.bind(0,'127.0.0.1');await once(a,'listening');const b=await socket(),before=a.getRecvBufferSize(),large=b.getRecvBufferSize(),conn=new RudpConn(a,{address:'127.0.0.1',port:port(b)});conn.start();t.after(()=>{conn.close();close(b)})
 if(process.platform==='win32')assert(a.getRecvBufferSize()>=Math.max(before,256*1024))
 assert(conn.addSecondaryPath(b,{address:'127.0.0.1',port:port(a)}));assert.equal(b.getRecvBufferSize(),large)
})

test('VoxLink XOR parity reconstructs a missing variable-size chunk, including parity-before-DATA and authenticated duplicates',async t=>{
 const a=await socket(),b=await socket(),key=Buffer.alloc(32,17),conn=new RudpConn(a,{address:'127.0.0.1',port:port(b)},{authKey:key});conn.start();t.after(()=>{conn.close();close(b)})
 const parts=[Buffer.from('alpha'),Buffer.from('中文测试'),Buffer.from('z'),Buffer.alloc(53,9)],xor=Buffer.alloc(53);for(const p of parts)for(let i=0;i<p.length;i++)xor[i]^=p[i]
 const send=(p:Buffer)=>b.send(signPunchFrame(p,key),port(a),'127.0.0.1')
 send(frame(RUDP_TYPE_FEC_XOR,0,xor,parts.map(p=>p.length)));send(frame(RUDP_TYPE_DATA,0,parts[0]));send(frame(RUDP_TYPE_DATA,2,parts[2]));send(frame(RUDP_TYPE_DATA,2,parts[2]));send(frame(RUDP_TYPE_DATA,3,parts[3]));
 const output=await readBytes(conn,Buffer.concat(parts).length);assert.deepEqual(output,Buffer.concat(parts));assert.equal((conn as any).nextRead,4)
 // Recovery never admits unauthenticated parity or wrong length tables.
 const bad=Buffer.from(signPunchFrame(frame(RUDP_TYPE_FEC_XOR,1,xor,[5,12,1,53]),key));bad[bad.length-1]^=1;b.send(bad,port(a),'127.0.0.1');send(frame(RUDP_TYPE_FEC_XOR,1,xor,[100,12,1,53]));await delay(20);assert.equal((conn as any).nextRead,4)
})

test('VoxLink emits upstream four-chunk XOR framing and TURN parity stays inside the 1400-byte RUDP budget',async t=>{
 const a=await socket(),b=await socket(),key=Buffer.alloc(32,21),packets:Buffer[]=[];b.on('message',p=>packets.push(p))
 const conn=new RudpConn(a,{address:'127.0.0.1',port:port(b)},{authKey:key,codec:{encode:p=>p,decode:p=>p}});conn.start();t.after(()=>{conn.close();close(b)})
 const input=Buffer.alloc(1374*4);for(let i=0;i<input.length;i++)input[i]=i%251;await conn.write(input);await until(()=>packets.some(p=>p[2]===RUDP_TYPE_FEC_XOR))
 const parity=rudpDecode(verifyPunchFrame(packets.find(p=>p[2]===RUDP_TYPE_FEC_XOR)!,key)!)!;assert.equal(parity.seq,0);assert.equal(parity.ack,0);assert.deepEqual(parity.fecLengths,[1374,1374,1374,1374]);assert.equal(packets.find(p=>p[2]===RUDP_TYPE_FEC_XOR)!.length,1400)
 const expected=Buffer.alloc(1374);for(let j=0;j<4;j++)for(let i=0;i<1374;i++)expected[i]^=input[j*1374+i];assert.deepEqual(parity.payload,expected)
})

test('VoxLink ignores forged future ACKs and FEC reserved ACKs, fast retransmits a real gap and bounds retry backoff',async t=>{
 const a=await socket(),b=await socket(),seen:number[]=[],conn=new RudpConn(a,{address:'127.0.0.1',port:port(b)});b.on('message',p=>{const f=rudpDecode(p);if(f?.type===RUDP_TYPE_DATA)seen.push(f.seq)});conn.start();t.after(()=>{conn.close();close(b)})
 await conn.write(Buffer.alloc(7000,3));await until(()=>seen.length===5);await delay(55)
 b.send(frame(RUDP_TYPE_ACK,0,Buffer.alloc(0),[],1000),port(a),'127.0.0.1');b.send(frame(RUDP_TYPE_FEC_XOR,0,Buffer.alloc(1),[1,1,1,1],5),port(a),'127.0.0.1');await delay(10);assert.equal((conn as any).pending.size,5)
 for(let i=0;i<4;i++)b.send(frame(RUDP_TYPE_ACK,0),port(a),'127.0.0.1');await until(()=>seen.filter(s=>s===0).length===2);assert.equal((conn as any).pending.get(0).retries,1)
 b.send(frame(RUDP_TYPE_ACK,0,Buffer.alloc(0),[],5),port(a),'127.0.0.1');await until(()=>(conn as any).pending.size===0);assert((conn as any).rto>=100&&(conn as any).rto<=800)
})

test('VoxLink transfers 4 MiB bidirectionally through real UDP with 25% first-send loss, latency, reordering, duplicate ACKs and a paused reader', {timeout:20000},async t=>{
 const a=await socket(),b=await socket(),left=await socket(),right=await socket(),key=Buffer.alloc(32,31),timers=new Set<ReturnType<typeof setTimeout>>(),seen=[new Map<number,number>(),new Map<number,number>()],loss=[0,0],fec=[0,0]
 const forward=(direction:number,p:Buffer)=>{const f=rudpDecode(verifyPunchFrame(p,key)!);if(!f)return;if(f.type===RUDP_TYPE_DATA){const count=seen[direction].get(f.seq)??0;seen[direction].set(f.seq,count+1);if(f.seq%4===1&&!count){loss[direction]++;return}}if(f.type===RUDP_TYPE_FEC_XOR)fec[direction]++
  const timer=setTimeout(()=>{timers.delete(timer);(direction?left:right).send(p,direction?port(a):port(b),'127.0.0.1');if(f.type===RUDP_TYPE_ACK&&(f.ack%13===0))(direction?left:right).send(p,direction?port(a):port(b),'127.0.0.1')},15+(f.seq%3)*7);timers.add(timer)}
 left.on('message',p=>forward(0,p));right.on('message',p=>forward(1,p));const x=new RudpConn(a,{address:'127.0.0.1',port:port(left)},{authKey:key}),y=new RudpConn(b,{address:'127.0.0.1',port:port(right)},{authKey:key});x.start();y.start();t.after(()=>{x.close();y.close();for(const timer of timers)clearTimeout(timer);for(const s of[left,right])close(s)})
 const first=Buffer.alloc(2*1024*1024),second=Buffer.alloc(first.length);for(let i=0;i<first.length;i++){first[i]=i%251;second[i]=(i*17)%253}
 const upload=x.write(first),download=y.write(second);await delay(350);assert(x.isConnected()&&y.isConnected());assert((x as any).incoming.length<=512&&(y as any).incoming.length<=512)
 const [rx,ry]=await Promise.all([readBytes(x,second.length,true),readBytes(y,first.length,true),upload,download]);assert.deepEqual(rx,second);assert.deepEqual(ry,first);assert.equal(createHash('sha256').update(rx).digest('hex'),createHash('sha256').update(second).digest('hex'));assert(loss.every(n=>n>300),`dropped DATA per direction: ${loss}`);assert(fec.every(n=>n>300),`FEC per direction: ${fec}`);await until(()=>(x as any).pending.size===0&&(y as any).pending.size===0);assert((x as any).fecReceive.size<=128&&(y as any).fecReceive.size<=128)
 const blocked=x.read(Buffer.alloc(1));x.close();assert.equal(await blocked,0);assert.equal((x as any).fecReceive.size,0);assert.equal((x as any).queuedBytes,0)
})

test('VoxLink falls back to retransmission when both DATA and parity are lost', {timeout:5000},async t=>{
 const a=await socket(),b=await socket(),relay=await socket(),seen=new Map<number,number>(),conn=new RudpConn(a,{address:'127.0.0.1',port:port(relay)}),peer=new RudpConn(b,{address:'127.0.0.1',port:port(relay)});relay.on('message',(p,from)=>{const f=rudpDecode(p);if(!f)return;const target=from.port===port(a)?port(b):port(a);if(from.port===port(a)){if(f.type===RUDP_TYPE_FEC_XOR)return;if(f.type===RUDP_TYPE_DATA){const n=seen.get(f.seq)??0;seen.set(f.seq,n+1);if(f.seq===1&&!n)return}}relay.send(p,target,'127.0.0.1')});conn.start();peer.start();t.after(()=>{conn.close();peer.close();close(relay)});const input=Buffer.alloc(7000,73);await conn.write(input);assert.deepEqual(await readBytes(peer,input.length),input);assert((seen.get(1)??0)>=2)
})
