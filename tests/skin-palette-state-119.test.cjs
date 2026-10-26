// Pure QA gate/ledger tests; these do not substitute for native acceptance.
const assert=require('node:assert/strict'),test=require('node:test')
const{paletteSaveReady,paletteRgbaDelta}=require('../scripts/verify-skin-palette-ui.cjs')
const ready=()=>({request:{returned:true,result:true},document:{header:'64 × 64 像素 · 已保存',viewer:{editDisabled:false}},controls:{editorExists:true,viewerCanvasVisible:true,contentInert:false,saveDisabled:false,drawDisabled:false,error:''},fileExists:true})
test('existing PNG and clean header cannot disguise pending, canceled or failed actual save',()=>{
  const state=ready();state.request={returned:false};assert.equal(paletteSaveReady(state),false)
  state.request={returned:true,result:false};assert.equal(paletteSaveReady(state),false)
  state.request={returned:true,result:true,error:'write failed'};assert.equal(paletteSaveReady(state),false)
  state.request=null;assert.equal(paletteSaveReady(state),false)
})
test('actual successful save must also finish renderer editing and clear inert/disabled/error state',()=>{
  for(const [scope,key,value]of [['document','header','有未保存更改'],['controls','contentInert',true],['controls','saveDisabled',true],['controls','drawDisabled',true],['controls','editorExists',false],['controls','viewerCanvasVisible',false],['controls','error','保存失败']]){const state=ready();state[scope][key]=value;assert.equal(paletteSaveReady(state),false,scope+'.'+key)}
  const state=ready();state.document.viewer.editDisabled=true;assert.equal(paletteSaveReady(state),false)
})
test('clean returned save with actual enabled viewer/edit/save controls is ready',()=>{
  const state=ready();assert.equal(paletteSaveReady(state),true);state.document.header='64 × 64 像素 · 已保存';assert.equal(paletteSaveReady(state),true)
})
test('RGBA ledger preserves exact alpha/rounding texel changes without tolerance or hidden mutation',()=>{
  const before=new Uint8ClampedArray(16384),offset=(15*64+47)*4;before.set([17,119,238,128],offset)
  const identical=new Uint8ClampedArray(before);assert.deepEqual(paletteRgbaDelta(before,identical),{changedBytes:0,changedTexels:[]})
  const after=new Uint8ClampedArray(before);after.set([16,119,239,127],offset);const delta=paletteRgbaDelta(before,after)
  assert.equal(delta.changedBytes,3);assert.deepEqual(delta.changedTexels,[{x:47,y:15,before:[17,119,238,128],after:[16,119,239,127]}]);assert.deepEqual(before,identical,'observing differences cannot mutate the document')
})
