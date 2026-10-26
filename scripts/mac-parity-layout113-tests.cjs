// Pure readiness contracts only; no native App or original failed-route pass.
const test=require('node:test'),assert=require('node:assert/strict')
const{nativeNavigationLayoutReady,LAYOUTS}=require('./verify-mac-parity-ui.cjs')
const expected=([width,height,zoom]=LAYOUTS[1])=>({width,height,zoom,pid:20,windowId:2,webContentsId:2})
const observed=e=>({native:{pid:20,windowId:2,webContentsId:2,visible:true,minimized:false,focused:true,appHidden:false,zoom:e.zoom,bounds:{x:10,y:25,width:e.width,height:e.height},contentBounds:{x:10,y:25,width:e.width,height:e.height}},coordinate:{hit:true,x:100.5,y:155,bounds:{x:26,y:138,width:149,height:34},renderer:{width:Math.round(e.width/e.zoom),height:Math.round(e.height/e.zoom),hasFocus:true,hidden:false,pixelRatio:2*e.zoom}}})
test('Navigation waits for two actual owned observations with coherent native and renderer geometry',()=>{for(const layout of LAYOUTS){const e=expected(layout),previous=observed(e);assert.equal(nativeNavigationLayoutReady(observed(e),undefined,e),false);assert.equal(nativeNavigationLayoutReady(observed(e),previous,e),true)}const e=expected(),clamped={...e,height:678},row=observed(clamped);assert.equal(nativeNavigationLayoutReady(row,structuredClone(row),e),true,'Stable actual clamped geometry permits observation but cannot prove the requested layout was covered')})
test('Missing actual zoom, inconsistent viewport, missing focus or blocked hit cannot permit the pending navigation click',()=>{
 const e=expected(),previous=observed(e)
 for(const mutate of[r=>r.native.bounds.width=960,r=>r.native.bounds.height=620,r=>r.native.zoom=1,r=>r.native.zoom=NaN,r=>r.native.visible=false,r=>r.native.minimized=true,r=>r.native.focused=false,r=>r.native.appHidden=true,r=>r.coordinate.hit=false,r=>r.coordinate.renderer.hasFocus=false,r=>r.coordinate.renderer.hidden=true,r=>r.coordinate.renderer.width++,r=>r.coordinate.renderer.height++,r=>r.native.contentBounds.width=NaN]){const row=observed(e);mutate(row);assert.equal(nativeNavigationLayoutReady(row,previous,e),false);assert.equal(nativeNavigationLayoutReady(observed(e),row,e),false)}
})
test('Moving geometry, target coordinates or native identities remain unready instead of using stale coordinates',()=>{
 const e=expected(),previous=observed(e)
 for(const key of['pid','windowId','webContentsId']){const row=observed(e);row.native[key]++;assert.equal(nativeNavigationLayoutReady(row,previous,e),false)}
 for(const name of['bounds','contentBounds'])for(const key of['x','y','width','height']){const row=observed(e);row.native[name][key]++;assert.equal(nativeNavigationLayoutReady(row,previous,e),false)}
 for(const key of['x','y','width','height']){const row=observed(e);row.coordinate.bounds[key]++;assert.equal(nativeNavigationLayoutReady(row,previous,e),false)}
 for(const key of['x','y']){const row=observed(e);row.coordinate[key]++;assert.equal(nativeNavigationLayoutReady(row,previous,e),false)}
 const row=observed(e);row.coordinate.renderer.pixelRatio++;assert.equal(nativeNavigationLayoutReady(row,previous,e),false)
})
