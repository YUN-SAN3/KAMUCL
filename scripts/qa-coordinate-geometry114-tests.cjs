const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm')
const qa=require('./qa-coordinate-geometry114.cjs')
const expected={pid:25,windowId:2,webContentsId:7,timeOrigin:1234000,url:'file:///owned/index.html',zoom:1}
const row=()=>({native:{pid:25,windowId:2,webContentsId:7,bounds:{x:0,y:25,width:1280,height:678},contentBounds:{x:0,y:25,width:1280,height:678},zoom:1,focused:true,visible:true,minimized:false,appHidden:false},coordinate:{hit:true,x:100,y:210,bounds:{x:10,y:186,width:180,height:48},ancestorsVisible:true,runningAnimations:0,absent:true,renderer:{width:1280,height:678,hasFocus:true,hidden:false,pixelRatio:2,timeOrigin:1234000,url:'file:///owned/index.html',ready:'complete'}}})
test('actual clamped geometry can be stable without substituting requested dimensions',()=>{
 const a=row(),b=row();a.requested=b.requested={width:1280,height:900};assert.equal(qa.coordinateGeometryReady(a,null,expected),false);assert.equal(qa.coordinateGeometryReady(b,a,expected),true)
 a.native.zoom=b.native.zoom=1.25;a.coordinate.renderer.width=b.coordinate.renderer.width=1024;a.coordinate.renderer.height=b.coordinate.renderer.height=Math.round(678/1.25)
 assert.equal(qa.coordinateGeometryReady(b,a,{...expected,zoom:1.25}),true);assert.equal(qa.coordinateGeometryReady(b,a,expected),false)
})
test('foreign identities, reload, old viewport, hidden document and obscured targets cannot qualify',()=>{
 const mutations=[r=>r.native.pid++,r=>r.native.windowId++,r=>r.native.webContentsId++,r=>r.native.focused=false,r=>r.native.visible=false,r=>r.native.minimized=true,r=>r.native.appHidden=true,r=>r.coordinate.renderer.timeOrigin++,r=>r.coordinate.renderer.url='file:///foreign/index.html',r=>r.coordinate.renderer.width=768,r=>r.coordinate.renderer.height=496,r=>r.coordinate.renderer.hasFocus=false,r=>r.coordinate.renderer.hidden=true,r=>r.coordinate.renderer.ready='loading',r=>r.coordinate.hit=false,r=>r.coordinate.ancestorsVisible=false,r=>r.coordinate.runningAnimations=1,r=>r.coordinate.absent=false,r=>r.coordinate.x=NaN,r=>r.coordinate.bounds.x=-1,r=>r.coordinate.bounds.width=0]
 for(const mutate of mutations){const bad=row();mutate(bad);assert.equal(qa.coordinateGeometryReady(bad,row(),expected),false);assert.equal(qa.coordinateGeometryReady(row(),bad,expected),false)}
})
test('two individually valid but changing real bounds, zoom or target coordinates cannot qualify',()=>{
 const mutations=[r=>r.native.bounds.x++,r=>r.native.contentBounds.y++,r=>{r.coordinate.bounds.y++;r.coordinate.y++},r=>r.coordinate.renderer.pixelRatio=1]
 for(const mutate of mutations){const changed=row();mutate(changed);assert.equal(qa.coordinateGeometryReady(changed,row(),expected),false)}
 const a=row(),b=row();a.native.zoom=1.25;a.coordinate.renderer.width=1024;a.coordinate.renderer.height=Math.round(678/1.25);assert.equal(qa.coordinateGeometryReady(b,a,{...expected,zoom:undefined}),false)
})
test('poll preserves every original read and needs two consecutive valid observations',async()=>{
 let clock=0,reads=0;const samples=[],changing=row();changing.native.contentBounds.y++
 const rows=[row(),changing,row(),row()];const actual=await qa.waitForStableCoordinate({expected,deadline:30000,now:()=>clock,wait:async ms=>{clock+=ms},read:async budget=>{assert.equal(budget,30000-clock);clock++;return rows[reads++]},onSample:s=>samples.push(s)})
 assert.strictEqual(actual,rows[3]);assert.equal(reads,4);assert.deepEqual(samples.map(s=>s.value),rows);assert.equal(clock,229)
})
test('an observation error breaks continuity and cannot be filled with an earlier hit',async()=>{
 let clock=0,reads=0;const samples=[];await qa.waitForStableCoordinate({expected,deadline:30000,now:()=>clock,wait:async ms=>{clock+=ms},read:async()=>{reads++;if(reads===2)throw Error('Original native read failed');return row()},onSample:s=>samples.push(s)})
 assert.equal(reads,4);assert.equal(samples[1].value.observationError.message,'Original native read failed')
})
test('original absolute deadline rejects a late second match and caps poll waits',async()=>{
 let clock=0,reads=0;const samples=[]
 await assert.rejects(qa.waitForStableCoordinate({expected,deadline:100,now:()=>clock,wait:async ms=>{assert(ms<=100-clock);clock+=ms},read:async()=>{reads++;clock+=reads===1?1:24;return row()},onSample:s=>samples.push(s)}),{code:'QA_COORDINATE_DEADLINE'})
 assert.equal(reads,2);assert.equal(samples.at(-1).at,100)
})
test('an already exhausted deadline performs no original reads or polling',async()=>{
 let reads=0;await assert.rejects(qa.waitForStableCoordinate({expected,deadline:10,now:()=>10,read:async()=>{reads++;return row()},wait:async()=>assert.fail('late wait')}),{code:'QA_COORDINATE_DEADLINE'});assert.equal(reads,0)
})
test('a stalled read cannot hold the coordinator beyond the original deadline',async()=>{
 const deadline=performance.now()+20,samples=[];await assert.rejects(qa.waitForStableCoordinate({expected,deadline,read:()=>new Promise(()=>{}),onSample:s=>samples.push(s)}),{code:'QA_COORDINATE_DEADLINE'});assert.equal(samples.length,1);assert.match(samples[0].value.observationError.message,/deadline/)
})
function browserFixture(){
 const listeners=new Map(),events=[],rect={x:10,y:186,width:180,height:48,left:10,top:186,right:190,bottom:234,toJSON(){return{x:this.x,y:this.y,width:this.width,height:this.height,left:this.left,top:this.top,right:this.right,bottom:this.bottom}}}
 class Element{constructor(tag='BUTTON'){this.tagName=tag;this.id='';this.textContent='游戏版本';this.isConnected=true;this.parentElement=null;this.disabled=false;this.animations=[]}getAttribute(name){return name==='data-nav'&&this.tagName==='BUTTON'?'game':null}closest(s){return this.tagName==='BUTTON'&&(s==='[data-nav=game]'||s==='[data-nav]')?this:null}contains(e){return e===this}getBoundingClientRect(){return rect}getAnimations(){return this.animations}}
 const element=new Element(),state={masked:false,hidden:false,focused:true,opacity:'1',modal:false}
 const document={readyState:'complete',get hidden(){return state.hidden},hasFocus:()=>state.focused,querySelector:s=>s==='[data-nav=game]'?element:s==='.game-install-modal'&&state.modal?new Element('DIV'):null,elementFromPoint:()=>state.masked?new Element('DIV'):element,addEventListener(type,fn,options){assert.deepEqual({...options},{capture:true,passive:true});listeners.set(type,fn)},removeEventListener(type,fn,capture){assert.equal(capture,true);assert.strictEqual(listeners.get(type),fn);listeners.delete(type)}}
 const context=vm.createContext({window:{},document,Element,performance:{timeOrigin:1234000,now:()=>55},location:{href:expected.url},innerWidth:1280,innerHeight:678,devicePixelRatio:2,getComputedStyle:()=>({opacity:state.opacity,visibility:'visible',display:'block'})})
 return{context,element,state,listeners,events,emit(type,changes={}){const event={type,isTrusted:false,target:element,clientX:100,clientY:210,button:0,buttons:type.endsWith('down')?1:0,...changes};listeners.get(type)?.(event);events.push(event)}}
}
test('actual generated coordinate expression reads absence, ancestor animation and hit state',()=>{
 const f=browserFixture(),read=()=>vm.runInContext(qa.coordinateExpression('[data-nav=game]',{absentSelectors:['.game-install-modal']}),f.context)
 const observed=JSON.parse(JSON.stringify(read()));assert.equal(qa.coordinateGeometryReady({native:row().native,coordinate:observed},row(),expected),true)
 f.state.modal=true;assert.equal(read().absent,false);f.state.masked=true;assert.equal(read().hit,false);f.element.animations=[{playState:'running'}];assert.equal(read().runningAnimations,1);f.state.opacity='.5';assert.equal(read().ancestorsVisible,false)
})
test('trusted target observer preserves actual trust, target and token without manufacturing input',()=>{
 const f=browserFixture(),token=vm.runInContext(qa.trustedTargetStartExpression('[data-nav=game]'),f.context);assert.equal(f.events.length,0);assert.equal(f.listeners.size,5)
 f.emit('pointerdown');f.emit('mousedown');f.emit('mouseup',{isTrusted:true});f.emit('pointerup',{isTrusted:true});f.emit('click',{isTrusted:true,target:new f.context.Element('DIV')})
 assert.throws(()=>vm.runInContext(qa.trustedTargetStopExpression('foreign-token'),f.context),/token mismatch/)
 const result=JSON.parse(JSON.stringify(vm.runInContext(qa.trustedTargetStopExpression(token),f.context)));assert.equal(result.records.length,5);assert.equal(result.records[0].isTrusted,false);assert.equal(result.records[2].isTrusted,true);assert.equal(result.records[4].target.tag,'DIV');assert.equal(result.records[4].matchesSelector,false);assert.equal(result.timeOrigin,expected.timeOrigin);assert.equal(result.overflow,false)
 f.emit('click');assert.equal(result.records.length,5);assert.equal(vm.runInContext(qa.trustedTargetRestoreExpression(),f.context).complete,true);assert.equal(f.listeners.size,0);assert.equal(f.context.window.__qaCoordinateTargets114,undefined)
})
test('active ownership, document changes and overflowing original input ledgers are retained',()=>{
 const f=browserFixture(),token=vm.runInContext(qa.trustedTargetStartExpression('[data-nav=game]'),f.context)
 assert.throws(()=>vm.runInContext(qa.trustedTargetStartExpression('[data-nav=game]'),f.context),/active/);assert.throws(()=>vm.runInContext(qa.trustedTargetRestoreExpression(),f.context),/active/)
 for(let i=0;i<65;i++)f.emit('click');const result=vm.runInContext(qa.trustedTargetStopExpression(token),f.context);assert.equal(result.records.length,64);assert.equal(result.overflow,true)
 f.context.performance.timeOrigin++;assert.throws(()=>vm.runInContext(qa.trustedTargetStartExpression('[data-nav=game]'),f.context),/document changed/)
})
test('pure trusted-sequence contract rejects forged trust, wrong target, missing event and context change',()=>{
 const f=browserFixture(),token=vm.runInContext(qa.trustedTargetStartExpression('[data-nav=game]'),f.context)
 for(const type of ['pointerdown','mousedown','pointerup','mouseup','click'])f.emit(type,{isTrusted:true})
 const original=JSON.parse(JSON.stringify(vm.runInContext(qa.trustedTargetStopExpression(token),f.context))),binding={selector:'[data-nav=game]',timeOrigin:expected.timeOrigin,url:expected.url};assert.equal(qa.assertTrustedTargetObservation(original,binding),true)
 const mutations=[o=>o.overflow=true,o=>o.selector='[data-nav=home]',o=>o.records[0].isTrusted=false,o=>o.records[0].matchesSelector=false,o=>o.records.pop(),o=>o.records[0].timeOrigin++,o=>o.records[0].url='file:///foreign/index.html',o=>o.records[0].renderer.hasFocus=false,o=>o.records[0].renderer.hidden=true]
 for(const mutate of mutations){const bad=structuredClone(original);mutate(bad);assert.throws(()=>qa.assertTrustedTargetObservation(bad,binding))}
})
