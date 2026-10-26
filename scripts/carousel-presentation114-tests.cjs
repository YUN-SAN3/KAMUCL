const test=require('node:test'),assert=require('node:assert/strict')
const {installCarouselPresentationObserver,verifyCarouselEventBatch,verifyRetainedCarousel,verifyCarouselReadiness}=require('./verify-gallery-favorites-ui.cjs')
function fixture(t){
 const original={window:global.window,document:global.document,MutationObserver:global.MutationObserver,performance:global.performance},listeners=new Map(),documentListeners=new Map();let callback,disconnected=false,clock=1,index=0,broken=false,hidden=false
 const hero={addEventListener:(type,fn)=>listeners.set(type,fn),removeEventListener:(type,fn)=>{assert.equal(listeners.get(type),fn);listeners.delete(type)}}
 global.window={};global.document={querySelector:()=>hero,addEventListener:(type,fn)=>documentListeners.set(type,fn),removeEventListener:(type,fn)=>{assert.equal(documentListeners.get(type),fn);documentListeners.delete(type)}};global.performance={timeOrigin:1000,now:()=>clock}
 global.MutationObserver=class{constructor(fn){callback=fn}observe(target,options){assert.equal(target,hero);assert.deepEqual(options.attributeFilter,['class','src'])}disconnect(){disconnected=true}}
 t.after(()=>{for(const [key,value]of Object.entries(original))global[key]=value})
 const banners=Array.from({length:8},(_,i)=>({path:'fixture:'+i,src:'https://fixture.invalid/'+i}))
 const read=()=>{if(broken)throw Error('actual mounted VNode unavailable');const current=index,indices=[(index+7)%8,index,(index+1)%8].sort((a,b)=>a-b);return{banners,current,upcoming:(index+1)%8,outgoing:(index+7)%8,layerIndices:indices,documentHidden:hidden,timers:hidden?0:1,images:indices.map(i=>({key:banners[i].path,src:banners[i].src,active:i===index,complete:true,naturalWidth:16}))}}
 const start=installCarouselPresentationObserver(banners,read),state=window.__carouselPresentation
 return{state,start,banners,advance:next=>{clock+=1000;index=next;callback()},duplicate:()=>callback(),breakRead:()=>{broken=true;callback()},visibility:()=>{hidden=!hidden;documentListeners.get('visibilitychange')()},load:()=>listeners.get('load')({type:'load',target:{classList:{contains:()=>true}}}),batch:(from=0)=>({from,count:state.events.length,timeOrigin:state.timeOrigin,errors:[...state.errors],events:state.events.slice(from)}),closed:()=>disconnected&&listeners.size===0&&documentListeners.size===0}
}
test('original renderer events retain every real image across a slow CDP response without synthesizing intermediate images',t=>{
 const f=fixture(t);for(const index of [1,2,3,4,5,6,7,0])f.advance(index)
 const cursor={offset:0,timeOrigin:f.start.timeOrigin,monotonic:0},events=verifyCarouselEventBatch(f.batch(),cursor)
 assert.deepEqual(events.map(e=>e.snapshot.current),[0,1,2,3,4,5,6,7,0]);assert.deepEqual(events.map(e=>e.monotonic),[1,1001,2001,3001,4001,5001,6001,7001,8001])
 const keys=f.banners.map(b=>b.path);events.forEach(e=>verifyRetainedCarousel(e.snapshot,keys));assert.equal(cursor.offset,9)
 f.duplicate();f.load();assert.equal(f.state.events.length,9,'unchanged observed pixels/state do not manufacture a transition')
 const closure=f.state.stop(8);assert.equal(closure.closed,true);assert.equal(closure.count,9);assert.deepEqual(closure.events.map(e=>e.snapshot.current),[0]);assert(f.closed());f.advance(1);assert.equal(f.state.events.length,9);assert.equal(f.state.stop(0).events.length,9,'idempotent stop still returns the complete original buffer')
})
test('a genuine skipped presentation stays absent in the original events and fails the exact cyclic-order gate',t=>{
 const f=fixture(t);f.advance(2);const cursor={offset:0,timeOrigin:f.start.timeOrigin,monotonic:0},events=verifyCarouselEventBatch(f.batch(),cursor)
 assert.deepEqual(events.map(e=>e.snapshot.current),[0,2]);assert.throws(()=>assert.equal(events[1].snapshot.current,(events[0].snapshot.current+1)%8))
})
test('mounted-state observation errors remain errors rather than being treated as an absent frame',t=>{
 const f=fixture(t);f.breakRead();assert.equal(f.state.errors.length,1)
 assert.throws(()=>verifyCarouselEventBatch(f.batch(),{offset:0,timeOrigin:f.start.timeOrigin,monotonic:0}),/observations must succeed/)
})
test('visibility changes remain original observations even without an image transition',t=>{
 const f=fixture(t);f.visibility();f.visibility();assert.deepEqual(f.state.events.map(e=>e.snapshot.current),[0,0,0]);assert.deepEqual(f.state.events.map(e=>e.snapshot.documentHidden),[false,true,false]);assert.deepEqual(f.state.events.map(e=>e.snapshot.timers),[1,0,1]);assert.equal(f.state.events[1].reason,'actual document visibility')
})
test('event stream rejects dropped/repeated batches, renderer reloads and original clock reversal',t=>{
 const f=fixture(t);f.advance(1);const cursor=()=>({offset:0,timeOrigin:f.start.timeOrigin,monotonic:0}),batch=f.batch()
 assert.throws(()=>verifyCarouselEventBatch({...batch,from:1},cursor()),/drop or repeat/)
 assert.throws(()=>verifyCarouselEventBatch({...batch,count:3},cursor()),/complete original/)
 assert.throws(()=>verifyCarouselEventBatch({...batch,timeOrigin:999},cursor()),/reload/)
 assert.throws(()=>verifyCarouselEventBatch({...batch,events:[batch.events[1],batch.events[0]]},cursor()),/clocks/)
 const position=cursor();verifyCarouselEventBatch(batch,position);assert.throws(()=>verifyCarouselEventBatch(batch,position),/drop or repeat/)
})
test('observer requires the actual mounted carousel and refuses a second simultaneous observer',t=>{
 fixture(t);assert.throws(()=>installCarouselPresentationObserver([],()=>({})),/already installed/)
 global.document.querySelector=()=>null;assert.throws(()=>installCarouselPresentationObserver([],()=>({})),/Mounted carousel missing/)
})
test('event-only collection cannot accept a decode at or after the original four-second boundary',()=>{
 const resource=(src,active,decoded)=>({src,active,complete:decoded,naturalWidth:decoded?16:0}),initial={images:[resource('current',true,false),resource('next',false,true)]}
 for(const at of [4000,5000]){const state={mounted:new Map(),previousRequestStartedAt:0,initialSource:null,initialDecoded:false};verifyCarouselReadiness(initial,state,0,0);assert.throws(()=>verifyCarouselReadiness({images:[resource('current',true,true),resource('next',false,true)]},state,at,at),/original readiness bound/)}
 const state={mounted:new Map(),previousRequestStartedAt:0,initialSource:null,initialDecoded:false};verifyCarouselReadiness(initial,state,0,0);assert.equal(verifyCarouselReadiness({images:[resource('current',true,true),resource('next',false,true)]},state,3999,3999).ready,true);assert.equal(state.mounted.get('current').firstDecodedAt,3999)
})
test('a late resource removal cannot erase an already overdue pending decode, while on-time removal releases the bound',()=>{
 const initial={images:[{src:'current',active:true,complete:true,naturalWidth:16},{src:'next',active:false,complete:false,naturalWidth:0}]},replacement={images:[{src:'current',active:true,complete:true,naturalWidth:16},{src:'new-next',active:false,complete:true,naturalWidth:16}]}
 for(const at of [4000,6000]){const state={mounted:new Map(),previousRequestStartedAt:0,initialSource:null,initialDecoded:false};verifyCarouselReadiness(initial,state,0,0);assert.throws(()=>verifyCarouselReadiness(replacement,state,at,at),/original readiness bound/)}
 const state={mounted:new Map(),previousRequestStartedAt:0,initialSource:null,initialDecoded:false};verifyCarouselReadiness(initial,state,0,0);assert.equal(verifyCarouselReadiness(replacement,state,3000,3000).ready,true);assert.equal(state.mounted.has('next'),false);assert.equal(verifyCarouselReadiness(replacement,state,9000,9000).ready,true)
})
