// Pure observer qualification; actual native gallery playback is separate CI evidence.
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm')
const{installMacParityObserver}=require('./verify-mac-parity-ui.cjs')
const{readMountedEnabledPlaylist,readMountedCarousel,verifyRetainedCarousel,verifyCarouselReadiness}=require('./verify-gallery-favorites-ui.cjs')
function fixture(){
 const playlist=Array.from({length:8},(_,i)=>({path:'builtin:actual-'+i,src:'https://fixture.invalid/image-'+i+'.png'})),rows=[],nodes=[],images=[],hero={querySelectorAll:()=>images}
 for(const item of playlist){const image={src:item.src},checkbox={checked:true},row={querySelector:s=>s==='img'?image:s==='.carousel-enabled input'?checkbox:null},imageVNode={el:image,props:{src:item.src}};rows.push(row);nodes.push({el:row,key:item.path,children:[imageVNode]})}
 const disabled={querySelector:s=>s==='.carousel-enabled input'?{checked:false}:null};rows.push(disabled)
 const home={uid:12,type:{__name:'HomeView'},setupState:{},subTree:{children:[]}},editor={uid:13,type:{__name:'HomeLayoutEditor'},setupState:{},subTree:{children:nodes}},root={children:[{component:home},{component:editor}]}
 const document={baseURI:'https://fixture.invalid/',hidden:false,querySelector:s=>s==='#app'?{__vue_app__:{_container:{_vnode:root}}}:s==='.hero-card'?hero:null,querySelectorAll:s=>s==='.launch-carousel-list>li'?rows:[]},window={__galleryTimers:new Set([1])},context=vm.createContext({window,document,URL})
 vm.runInContext('('+installMacParityObserver.toString()+')()',context)
 const readPlaylist=()=>JSON.parse(JSON.stringify(vm.runInContext('('+readMountedEnabledPlaylist.toString()+')()',context)))
 const read=()=>JSON.parse(JSON.stringify(vm.runInContext('('+readMountedCarousel.toString()+')('+JSON.stringify(readPlaylist())+')',context)))
 const show=current=>{images.length=0;home.subTree.children=[];for(const index of[(current+7)%8,current,(current+1)%8]){const active=index===current,image={src:playlist[index].src,complete:true,naturalWidth:16,classList:{contains:name=>name==='active'&&active}};images.push(image);home.subTree.children.push({el:image,key:playlist[index].path,props:{src:image.src,class:'hero-image'+(active?' active':'')}})}}
 return{playlist,rows,nodes,images,home,editor,window,readPlaylist,read,show}
}
test('Mounted production VNodes with empty setupState and no DOM component expandos expose all eight actual cyclic images read-only',()=>{
 const f=fixture(),before=JSON.stringify(f.nodes);assert.deepEqual(f.readPlaylist(),f.playlist)
 const rotation=[];for(let i=0;i<=8;i++){f.show(i%8);const s=f.read();rotation.push(verifyRetainedCarousel(s,f.playlist.map(p=>p.path)));assert.equal(s.current,i%8);assert.equal(s.upcoming,(i+1)%8);assert.equal(s.outgoing,(i+7)%8);assert.equal(s.images.length,3);assert.equal(s.observer.indexSource,'Original mounted image VNode path key mapped to exact saved playlist');assert.deepEqual(f.home.setupState,{})}
 assert.equal(new Set(rotation.slice(0,8).map(r=>r.current)).size,8);assert.equal(rotation[8].current,rotation[0].current);assert.equal(JSON.stringify(f.nodes),before);assert(!Object.hasOwn(f.images[0],'__vueParentComponent'))
})
test('A wrong mounted key, saved playlist source, active class, missing next or fourth retained layer cannot become carousel proof',()=>{
 for(const change of[f=>{f.home.subTree.children[1].key=7},f=>{f.home.subTree.children[1].key=f.playlist[7].path},f=>{f.home.subTree.children[1].props.src='https://fixture.invalid/wrong.png'},f=>{f.home.subTree.children[1].props.class='hero-image'},f=>{f.images.pop();f.home.subTree.children.pop()},f=>{const image={src:f.playlist[4].src,classList:{contains:()=>false},complete:true,naturalWidth:16};f.images.push(image);f.home.subTree.children.push({el:image,key:f.playlist[4].path,props:{src:image.src,class:'hero-image'}})},f=>{f.nodes[0].children[0].props.src='https://fixture.invalid/wrong.png'}]){const f=fixture();f.show(1);change(f);assert.throws(()=>f.read())}
})
test('Original decoding and complete ordered playlist assertions remain mandatory',()=>{
 const f=fixture();f.show(2);let s=f.read();s.images[0].complete=false;assert.throws(()=>verifyRetainedCarousel(s,f.playlist.map(p=>p.path)),/decode/)
 s=f.read();s.images[0].naturalWidth=0;assert.throws(()=>verifyRetainedCarousel(s,f.playlist.map(p=>p.path)),/decode/)
 assert.throws(()=>verifyRetainedCarousel(f.read(),[...f.playlist.map(p=>p.path)].reverse()),/exact saved order/)
 const source=require('node:fs').readFileSync(require.resolve('./verify-gallery-favorites-ui.cjs'),'utf8');assert(source.includes('rotationStarted<15000'));assert(source.includes('all eight logical images must rotate'));assert(!source.includes('hero.__vueParentComponent'))
})

const readinessState=(at=0)=>({mounted:new Map(),previousRequestStartedAt:at,previousObservedAt:at,initialSource:null,initialDecoded:false})
const resource=(src,active=false,decoded=true)=>({src,active,complete:decoded,naturalWidth:decoded?16:0})
const mounted=(...images)=>({images})
test('A genuinely new next after global four seconds gets only its retained-mount bound from the previous request',()=>{
 const state=readinessState(),first=mounted(resource('current',true),resource('old-next'))
 assert.equal(verifyCarouselReadiness(first,state,80,100).ready,true)
 verifyCarouselReadiness(first,state,4000,4080)
 const late=mounted(resource('current',true),resource('new-next',false,false)),before=structuredClone(late)
 const observed=verifyCarouselReadiness(late,state,4200,4294),row=observed.rows.find(r=>r.src==='new-next')
 assert.equal(observed.ready,false);assert.equal(row.decoded,false);assert.equal(row.earliestMountAt,4000);assert.equal(row.firstObservedAt,4294);assert.equal(row.deadline,8000);assert.notEqual(row.earliestMountAt,4200);assert.notEqual(row.earliestMountAt,4294);assert.deepEqual(late,before)
 assert.equal(verifyCarouselReadiness(late,state,7900,7999).ready,false)
 assert.throws(()=>verifyCarouselReadiness(late,state,8000,8000),/original readiness bound/)
})
test('Initial current may wait strictly less than four seconds, with natural width required and no boundary extension',()=>{
 for(const invalid of[resource('initial',true,false),{...resource('initial',true),naturalWidth:0},{...resource('initial',true),complete:false}]){
  const state=readinessState(),snapshot=mounted(invalid,resource('next'))
  const observed=verifyCarouselReadiness(snapshot,state,3998,3999);assert.equal(observed.ready,false);assert.equal(observed.rows.find(r=>r.active).deadline,4000)
  assert.throws(()=>verifyCarouselReadiness(snapshot,state,4000,4000),/original readiness bound/)
 }
})
test('Disappearing retained sources reset their mount epoch; continuous presence never resets a deadline',()=>{
 const state=readinessState(),first=mounted(resource('current',true),resource('next',false,false))
 verifyCarouselReadiness(first,state,80,100);assert.equal(state.mounted.get('next').earliestMountAt,0)
 verifyCarouselReadiness(mounted(resource('current',true),resource('replacement')),state,1000,1100);assert.equal(state.mounted.has('next'),false)
 const returned=mounted(resource('current',true),resource('next',false,false)),observed=verifyCarouselReadiness(returned,state,4200,4294),row=observed.rows.find(r=>r.src==='next')
 assert.equal(row.earliestMountAt,1000);assert.equal(row.firstObservedAt,4294);assert.equal(row.deadline,5000);assert.equal(observed.ready,false)
 verifyCarouselReadiness(returned,state,4900,4999);assert.equal(state.mounted.get('next').earliestMountAt,1000)
 assert.throws(()=>verifyCarouselReadiness(returned,state,5000,5000),/original readiness bound/)
 const continuouslyMounted=readinessState();verifyCarouselReadiness(first,continuouslyMounted,80,100)
 assert.throws(()=>verifyCarouselReadiness(first,continuouslyMounted,4200,4294),/original readiness bound/)
})
test('A newly active or previously ready active image cannot flash undecoded even inside a next-resource deadline',()=>{
 const nextState=readinessState();verifyCarouselReadiness(mounted(resource('first',true),resource('next',false,false)),nextState,80,100)
 assert.throws(()=>verifyCarouselReadiness(mounted(resource('next',true,false),resource('later')),nextState,180,200),/decode before presentation/)
 const firstState=readinessState();verifyCarouselReadiness(mounted(resource('first',true),resource('next')),firstState,80,100)
 assert.throws(()=>verifyCarouselReadiness(mounted(resource('first',true,false),resource('next')),firstState,180,200),/decode before presentation/)
 const initialPending=readinessState();verifyCarouselReadiness(mounted(resource('first',true,false),resource('next')),initialPending,80,100)
 assert.throws(()=>verifyCarouselReadiness(mounted(resource('next',true,false),resource('later')),initialPending,180,200),/decode before presentation/)
})
test('Mount-readiness observations reject nonfinite, intra-request and previous-request clock regressions',()=>{
 const snapshot=mounted(resource('first',true),resource('next'))
 for(const[request,observed]of[[NaN,100],[80,NaN],[Infinity,Infinity],[100,99]])assert.throws(()=>verifyCarouselReadiness(snapshot,readinessState(),request,observed))
 const state=readinessState();verifyCarouselReadiness(snapshot,state,100,150);assert.throws(()=>verifyCarouselReadiness(snapshot,state,99,160),/ordered/)
})
test('A later serial request cannot precede the previous returned observation or move its returned clock backwards',()=>{
 const snapshot=mounted(resource('first',true),resource('next'))
 for(const[request,observed]of[[900,950],[900,1050]]){
  const state=readinessState();verifyCarouselReadiness(snapshot,state,100,1000)
  assert.throws(()=>verifyCarouselReadiness(snapshot,state,request,observed),/ordered|previous|serial|clock/i)
 }
})
test('Duplicate retained layers, missing current/next, fourth layers and absent or duplicate active states never enter readiness proof',()=>{
 for(const change of[f=>{const image=f.images[0],vnode=f.home.subTree.children[0];f.images.push({...image});f.home.subTree.children.push({...vnode,el:f.images.at(-1)})},f=>{f.images.splice(1,1);f.home.subTree.children.splice(1,1)},f=>{f.images.pop();f.home.subTree.children.pop()}]){const f=fixture();f.show(1);change(f);assert.throws(()=>f.read())}
 const f=fixture();f.show(1);const snapshot=f.read();snapshot.layerIndices.push(snapshot.layerIndices[0]);assert.throws(()=>verifyRetainedCarousel(snapshot,f.playlist.map(p=>p.path)))
 assert.throws(()=>verifyCarouselReadiness(mounted(resource('a'),resource('b')),readinessState(),80,100))
 assert.throws(()=>verifyCarouselReadiness(mounted(resource('a',true),resource('b',true)),readinessState(),80,100))
})
