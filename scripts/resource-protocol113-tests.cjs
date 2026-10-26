// Transport qualification only. These owned loopback sockets are synthetic;
// they do not certify a launcher, game, frame rate, or performance benefit.
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto')
const WS=require('ws'),{protocol}=require('./resource-baseline113.cjs')
const until=async read=>{const start=performance.now();while(!read()){if(performance.now()-start>3000)throw Error('Owned socket cleanup/readiness timeout');await new Promise(r=>setTimeout(r,5))}}
async function fixture(onConnection,run){
 const server=new WS.WebSocketServer({host:'127.0.0.1',port:0,perMessageDeflate:{threshold:0}}),clients=[]
 await new Promise((resolve,reject)=>{server.once('listening',resolve);server.once('error',reject)})
 server.on('connection',socket=>{clients.push(socket);socket.on('error',()=>{});onConnection(socket)})
 let peer
 try{peer=await protocol('ws://127.0.0.1:'+server.address().port);return await run(peer,clients)}
 finally{if(peer&&peer.socket.readyState!==WS.CLOSED){peer.socket.close(1000);await until(()=>peer.socket.readyState===WS.CLOSED)}for(const socket of clients)if(socket.readyState===WS.OPEN)socket.close(1000);await new Promise(resolve=>server.close(resolve))}
}
test('uncompressed owned transport returns every byte beyond the built-in four MiB inflater cap',async()=>{
 const payload='original-synthetic-value-'.repeat(230000),hash=value=>crypto.createHash('sha256').update(value).digest('hex')
 assert(Buffer.byteLength(payload)>4*1024*1024)
 await fixture(socket=>socket.on('message',text=>{const request=JSON.parse(text);socket.send(JSON.stringify({id:request.id,result:{payload}}),{compress:true})}),async(peer,clients)=>{
  const result=await peer.call('Runtime.evaluate',{expression:'synthetic owned response'})
  assert.equal(hash(result.payload),hash(payload));assert.equal(result.payload,payload)
  assert.equal(clients[0].extensions,'');assert.equal(peer.transport.compressionNegotiated,'')
  assert.equal(peer.transport.maximumPayloadBytes,100*1024*1024,'The installed ws default remains bounded, never unlimited')
  assert.equal(peer.transport.timeoutMs,30000);assert(peer.transport.largestReply.bytes>4*1024*1024)
  assert(peer.transport.events.some(event=>event.event==='large-message'&&event.id===1&&event.method==='Runtime.evaluate'))
  assert(!peer.transport.events.some(event=>['error','timeout','parse-error'].includes(event.event)))
 })
})
test('actual socket close rejects every original pending request and clears its timers',async()=>{
 await fixture(socket=>{let count=0;socket.on('message',()=>{if(++count===2)socket.close(1008,'synthetic rejection')})},async peer=>{
  const original=setTimeout,timers=[];let requests
  try{global.setTimeout=(callback,ms,...args)=>{const timer=original(callback,ms,...args);if(ms===30000)timers.push(timer);return timer};requests=[peer.call('First.original'),peer.call('Second.original')]}
  finally{global.setTimeout=original}
  const results=await Promise.allSettled(requests)
  assert(results.every(result=>result.status==='rejected'&&/transport closed: 1008 synthetic rejection/.test(result.reason.message)))
  assert.equal(timers.length,2);assert(timers.every(timer=>timer._destroyed===true),'Closed requests cannot leave a thirty-second pending timer')
  const close=peer.transport.events.find(event=>event.event==='close')
  assert.deepEqual(close.pending,[{id:1,method:'First.original'},{id:2,method:'Second.original'}]);assert.equal(close.wasClean,true)
  assert(!peer.transport.events.some(event=>event.event==='timeout'))
 })
})
test('malformed JSON or an invalid original message is preserved and rejects pending work',async()=>{
 for(const text of ['{malformed','null','[]'])await fixture(socket=>socket.on('message',()=>socket.send(text)),async peer=>{
  await assert.rejects(peer.call('Original.pending'),/transport JSON parse failure/)
  const error=peer.transport.events.find(event=>event.event==='parse-error')
  assert.equal(error.bytes,Buffer.byteLength(text));assert.equal(error.error.name,text==='{malformed'?'SyntaxError':'Error')
  assert.deepEqual(error.pending,[{id:1,method:'Original.pending'}])
  await until(()=>peer.socket.readyState===WS.CLOSED);assert(peer.transport.events.some(event=>event.event==='close'&&event.code===1002))
 })
})
test('a real protocol error is rejected with its original code and message',async()=>{
 const error={code:-32601,message:'Synthetic method unavailable'}
 await fixture(socket=>socket.on('message',text=>{const request=JSON.parse(text);socket.send(JSON.stringify({id:request.id,error}))}),async peer=>{
  await assert.rejects(peer.call('Original.missing'),cause=>cause.message===JSON.stringify(error))
  const event=peer.transport.events.find(event=>event.event==='protocol-error')
  assert.equal(event.method,'Original.missing');assert.deepEqual(event.error,error)
 })
})
test('a call on a genuinely closed socket fails explicitly without creating a fake response',async()=>{
 await fixture(()=>{},async peer=>{
  peer.socket.close(1000);await until(()=>peer.socket.readyState===WS.CLOSED)
  await assert.rejects(peer.call('Never.sent'),/transport is not open: 3/)
  assert.equal(peer.transport.messageCount,0)
  assert(peer.transport.events.some(event=>event.event==='call-while-closed'&&event.method==='Never.sent'))
 })
})
test('actual context events remain original messages independently of request replies',async()=>{
 const message={method:'Runtime.executionContextCreated',params:{context:{id:7,uniqueId:'original-owned-context',auxData:{isDefault:true,frameId:'synthetic-main'}}}}
 await fixture(socket=>socket.on('message',text=>{const request=JSON.parse(text);socket.send(JSON.stringify(message));socket.send(JSON.stringify({id:request.id,result:{}}))}),async peer=>{
  await peer.call('Runtime.enable');assert.equal(peer.contexts.live.size,1)
  assert.deepEqual(peer.contexts.events[0].params,message.params);assert.equal(peer.contexts.events[0].method,message.method)
  assert.deepEqual(peer.contexts.errors,[])
 })
})
test('controlled test clock invokes the unchanged thirty-second deadline without a timing threshold change',async()=>{
 await fixture(socket=>socket.on('message',()=>{}),async peer=>{
  const original=setTimeout,captured=[];let request
  try{global.setTimeout=(callback,ms,...args)=>{if(ms===30000){captured.push({callback,ms});return{syntheticClockHandle:true}}return original(callback,ms,...args)};request=peer.call('Original.unanswered')}
  finally{global.setTimeout=original}
  assert.equal(captured.length,1);assert.equal(captured[0].ms,30000);captured[0].callback()
  await assert.rejects(request,cause=>cause.message==='Original.unanswered timeout')
  assert(peer.transport.events.some(event=>event.event==='timeout'&&event.method==='Original.unanswered'))
  assert.equal(peer.socket.readyState,WS.OPEN,'An unanswered but live transport is distinguished from a closed transport')
 })
})
test('a real connection failure retains original lifecycle evidence before an owned protocol opens',async()=>{
 const server=new WS.WebSocketServer({host:'127.0.0.1',port:0});await new Promise(resolve=>server.once('listening',resolve));const port=server.address().port;await new Promise(resolve=>server.close(resolve))
 let evidence;await assert.rejects(protocol('ws://127.0.0.1:'+port,transport=>{evidence=transport}),/ECONNREFUSED/)
 await until(()=>evidence.events.some(event=>event.event==='close'))
 assert(evidence.events.some(event=>event.event==='error'&&event.error.code==='ECONNREFUSED'))
 assert.equal(evidence.messageCount,0)
})
