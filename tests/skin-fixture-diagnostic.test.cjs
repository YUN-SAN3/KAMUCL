// Tests the QA observer only; these mocks are not native product acceptance.
const assert=require('node:assert/strict'),test=require('node:test'),vm=require('node:vm')
const{installSkinFixtureDiagnostic}=require('../scripts/verify-skin-editor-ui.cjs')
function fixture(){
  const rgba=new Uint8ClampedArray(64*64*4),listeners=new Map(),forwarded=[]
  let dirty=false,clock=0
  class Canvas{constructor(){this.width=this.height=64}getContext(){return{getImageData:()=>({data:new Uint8ClampedArray(rgba)})}}}
  const documentCanvas=new Canvas(),pixel=function(x,y){forwarded.push({thisValue:this,args:[x,y]});const index=(y*64+x)*4;if(rgba[index]!==17)dirty=true;rgba[index]=17;return 'original result'}
  const viewer={uid:1,props:{editCanvas:documentCanvas,variant:'classic',layer:'inner',editMode:'draw',editDisabled:false,revision:0,hiddenParts:[],paused:true},vnode:{props:{onPixel:pixel,onGap:()=>forwarded.push('gap'),onStroke:active=>forwarded.push(active),onRotate:()=>forwarded.push('rotate')}},subTree:{children:[]}}
  const palette={uid:2,props:{color:'#1177ee',alpha:1,alphaEnabled:false,custom:[],recent:[]},subTree:{children:[]}}
  // Production-style entry point, including Teleport-like children and a cycle.
  const root={component:{subTree:{children:[{children:[{component:viewer},{component:palette}]}]}}};root.component.subTree.children.push(root)
  const target={closest:()=>({})},rendered={getBoundingClientRect:()=>({x:99,y:69,width:491,height:170})}
  const document={hidden:false,hasFocus:()=>true,activeElement:{getAttribute:()=>null,className:'viewer3d'},
    querySelector(selector){return selector==='#app'?{__vue_app__:{_container:{_vnode:root}}}:selector==='.editor-header p'?{get textContent(){return dirty?'有未保存更改':'已保存'}}:selector.includes('.editor-tool[')?{textContent:'绘制'}:selector.includes('.view-tools')?{textContent:'正面'}:selector.includes('.viewer3d canvas')?rendered:null},
    querySelectorAll:()=>[],addEventListener(type,fn){listeners.set(type,fn)},removeEventListener(type,fn){if(listeners.get(type)===fn)listeners.delete(type)}}
  const window={},context={document,window,HTMLCanvasElement:Canvas,performance:{now:()=>++clock}}
  vm.runInNewContext(`(${installSkinFixtureDiagnostic.toString()})()`,context)
  const pointer=(type='pointerdown',trusted=true)=>listeners.get(type)?.({type,isTrusted:trusted,target,clientX:340,clientY:102,button:0,buttons:type==='pointerup'?0:1})
  return{diagnostic:window.__skinFixtureDiagnostic,viewer,pixel,pointer,forwarded,listeners,rgba}
}
test('production VNode traversal reads real document; wrapped listener forwards context, arguments and return',()=>{
  const f=fixture(),before=f.diagnostic.snapshot();assert.equal(before.rgba.length,16384);assert.equal(before.palette.color,'#1177ee');assert.equal(before.header,'已保存')
  f.pointer();const receiver={},result=f.viewer.vnode.props.onPixel.call(receiver,10,12)
  assert.equal(result,'original result');assert.equal(f.forwarded[0].thisValue,receiver);assert.deepEqual(f.forwarded[0].args,[10,12])
  const event=f.diagnostic.events[0];assert.equal(event.kind,'pixel');assert.equal(event.pointer.type,'pointerdown');assert.equal(event.texelBefore[0],0);assert.equal(event.texelAfter[0],17);assert.equal(event.changedBytes,1)
  f.pointer('pointermove');f.viewer.vnode.props.onGap();assert.equal(f.diagnostic.events[1].pointer.type,'pointermove','current pointer is observed even when props object stays the same')
  assert.equal(f.diagnostic.snapshot().header,'有未保存更改');const trace=f.diagnostic.finish();assert.equal(trace.restoredListeners,4);assert.equal(f.viewer.vnode.props.onPixel,f.pixel);assert.equal(f.listeners.size,0)
})
test('each real pointer observes replaced VNode; original listeners restored after failure',()=>{
  const f=fixture(),firstProps=f.viewer.vnode.props;f.pointer();f.viewer.vnode.props.onPixel(10,12)
  const failure=Error('original listener failed'),original=()=>{throw failure},newProps={onPixel:original,onStroke:[()=>f.forwarded.push('first'),()=>f.forwarded.push('second')]}
  f.viewer.vnode={props:newProps};f.pointer('pointermove');assert.throws(()=>newProps.onPixel(15,13),error=>error===failure)
  for(const fn of newProps.onStroke)fn(false)
  assert.deepEqual(f.forwarded.slice(-2),['first','second']);assert.equal(f.diagnostic.events[1].texelAfter[0],0);assert.equal(f.diagnostic.events[1].changedBytes,0)
  f.diagnostic.finish();assert.equal(firstProps.onPixel,f.pixel);assert.equal(newProps.onPixel,original);assert.equal(f.listeners.size,0)
})
test('untrusted pointer does not wrap listeners or modify document',()=>{
  const f=fixture();f.pointer('pointerdown',false);assert.equal(f.viewer.vnode.props.onPixel,f.pixel);assert.equal(f.diagnostic.events.length,0);assert(f.rgba.every(v=>v===0));f.diagnostic.finish()
})
test('no-op real pixel callback stays distinguishable from a changed document and a ray gap',()=>{
  const f=fixture();f.rgba[(12*64+10)*4]=17;const before=f.diagnostic.snapshot();f.pointer();f.viewer.vnode.props.onPixel(10,12);f.viewer.vnode.props.onGap()
  const after=f.diagnostic.snapshot();assert.deepEqual(after.rgba,before.rgba);assert.equal(after.header,'已保存');assert.equal(f.diagnostic.events[0].kind,'pixel');assert.equal(f.diagnostic.events[0].changedBytes,0);assert.equal(f.diagnostic.events[0].texelBefore[0],17);assert.equal(f.diagnostic.events[1].kind,'gap');f.diagnostic.finish()
})
