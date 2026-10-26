// Pure QA contracts and an owned Node inspector; no launcher or desktop control.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),inspector=require('node:inspector')
const {readSettingsScopeState,assertSettingsScopeState,readSettingsCoordinate,settingsCoordinateReady,MAC_QUIT_INSPECTION}=require('./verify-ui-refinement.cjs')
function state(kind){
 const game=kind==='game'
 return{scope:game?'游戏设置':'启动器设置',category:game?'目录与隔离':'下载',categories:game?['运行环境','游戏窗口','目录与隔离']:['外观','行为与登录','下载','功能与插件','关于与更新'],visibleSections:game?['isolation']:['installation','downloads','mirror'],isolation:{visible:game,type:'checkbox',disabled:false,checked:true,hint:'开启后独立保存存档、模组与配置；已有实例在游戏版本页调整。'},download:{card:!game,path:!game,readOnly:true,value:'/owned/games',change:!game,manage:!game}}
}
test('game directories verifies the actual isolation input and keeps download controls hidden',()=>{
 const original=state('game'),before=structuredClone(original)
 assertSettingsScopeState(original,'game');assert.deepEqual(original,before)
 for(const mutate of [s=>s.visibleSections.push('installation'),s=>s.isolation.visible=false,s=>s.isolation.disabled=true,s=>s.isolation.type='text',s=>s.download.card=true,s=>s.categories.push('下载')]){
  const value=state('game');mutate(value);assert.throws(()=>assertSettingsScopeState(value,'game'))
 }
})
test('launcher downloads requires the default path and both real entry buttons with every other section hidden',()=>{
 const original=state('launcher'),before=structuredClone(original)
 assertSettingsScopeState(original,'launcher');assert.deepEqual(original,before)
 for(const mutate of [s=>s.visibleSections.push('isolation'),s=>s.visibleSections.push('memory'),s=>s.download.readOnly=false,s=>s.download.path=false,s=>s.download.change=false,s=>s.download.manage=false,s=>s.download.value='',s=>s.isolation.visible=true,s=>s.scope='游戏设置',s=>s.category='目录与隔离']){
  const value=state('launcher');mutate(value);assert.throws(()=>assertSettingsScopeState(value,'launcher'))
 }
})
test('serialized section observer reads real input attributes and visibility without changing the DOM',()=>{
 const raw=state('launcher'),make=(visible,extra={})=>({getClientRects:()=>visible?[{}]:[],...extra})
 const isolation=make(false,{type:'checkbox',disabled:false,checked:true}),location=make(true,{readOnly:true,value:raw.download.value})
 const nodes={'[data-section=isolation] input[type=checkbox]':isolation,'[data-ui="download-location:path"]':location,'.settings-scopes [aria-current=page]':{textContent:raw.scope},'.settings-categories [aria-current=page]':{textContent:raw.category},'[data-section=isolation] .group-hint':{textContent:raw.isolation.hint},'[data-ui="download-location:settings"]':make(true),'[data-ui="download-location:change"]':make(true),'[data-ui="download-location:manage"]':make(true)}
 const document={querySelector:selector=>nodes[selector],querySelectorAll:selector=>selector==='.settings-categories button'?raw.categories.map(textContent=>({textContent})):['installation','downloads','mirror','isolation','memory'].map(section=>make(raw.visibleSections.includes(section),{dataset:{section}}))}
 const result=new Function('document',`return (${readSettingsScopeState.toString()})()`)(document)
 assert.deepEqual(result,raw);assertSettingsScopeState(result,'launcher');assert.equal(isolation.checked,true);assert.equal(location.value,'/owned/games')
})
test('trusted settings coordinates reject occlusion, pending transitions, disabled inputs and offscreen targets',()=>{
 const valid={matches:1,x:25,y:35,width:40,height:20,viewport:{width:960,height:620},disabled:false,inert:false,hit:true,ancestorsVisible:true,runningFiniteAnimations:0}
 assert.equal(settingsCoordinateReady(valid),true)
 for(const patch of [{matches:0},{matches:2},{disabled:true},{inert:true},{hit:false},{ancestorsVisible:false},{runningFiniteAnimations:1},{x:960},{y:-1},{width:0},{x:NaN}])assert.equal(settingsCoordinateReady({...valid,...patch}),false,JSON.stringify(patch))
})
test('serialized coordinate observer reads the original hit and ongoing finite animations',()=>{
 const element={textContent:'下载',disabled:false,parentElement:null,getBoundingClientRect:()=>({x:10,y:20,width:60,height:30}),contains:()=>false,closest:()=>null}
 let running=true
 const document={querySelectorAll:()=>[element],elementFromPoint:()=>element,getAnimations:()=>running?[{playState:'running',effect:{getComputedTiming:()=>({iterations:1})}}]:[]}
 const observe=new Function('document','getComputedStyle','innerWidth','innerHeight',`return (${readSettingsCoordinate.toString()})('.settings-categories','下载')`)
 const style=()=>({display:'block',visibility:'visible',opacity:'1'})
 assert.equal(settingsCoordinateReady(observe(document,style,960,620)),false)
 running=false;const ready=observe(document,style,960,620);assert.equal(settingsCoordinateReady(ready),true);assert.deepEqual([ready.x,ready.y],[40,35])
})
test('settings classification matches the actual product catalog and section conditions',()=>{
 const view=fs.readFileSync(path.join(__dirname,'../src/renderer/src/views/SettingsView.vue'),'utf8'),catalog=fs.readFileSync(path.join(__dirname,'../src/shared/settingsCatalog.ts'),'utf8')
 assert.match(view,/<div v-show="category === 'downloads'" data-section="installation" data-ui="download-location:settings"/)
 assert.match(view,/v-show="category === 'directories'" data-section="isolation"/)
 assert.match(catalog,/id: 'installation', category: 'downloads'/)
 assert.match(catalog,/id: 'isolation', category: 'directories'/)
 assert(!view.match(/v-show="category === 'directories'"[^>]*data-section="installation"/),'QA must not require the obsolete location of the product card')
})
test('actual Node inspector reproduces Timer serialization failure while the original quit action still runs with a primitive result',async()=>{
 const session=new inspector.Session();session.connect()
 const inspect=expression=>new Promise(resolve=>session.post('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true},(error,result)=>resolve({error,result})))
 let quitCalls=0
 try{
  const original=await inspect('globalThis.__qaScopeTimer=setTimeout(()=>{},5000)')
  assert(original.error);assert.match(original.error.message,/-32000.*Object reference chain is too long/)
  clearTimeout(globalThis.__qaScopeTimer);delete globalThis.__qaScopeTimer
  assert.equal(MAC_QUIT_INSPECTION,'setTimeout(()=>testElectron.app.quit(),500);true')
  globalThis.testElectron={app:{quit:()=>{quitCalls++}}}
  const safe=await inspect(MAC_QUIT_INSPECTION)
  assert.equal(safe.error,null);assert.equal(safe.result.result.type,'boolean');assert.equal(safe.result.result.value,true)
  await new Promise(resolve=>setTimeout(resolve,550));assert.equal(quitCalls,1,'the original scheduled quit is neither removed nor duplicated')
 }finally{clearTimeout(globalThis.__qaScopeTimer);delete globalThis.__qaScopeTimer;delete globalThis.testElectron;session.disconnect()}
})
