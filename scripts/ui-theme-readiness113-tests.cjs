// Pure observer-contract tests; no launcher, GUI, product handlers or user data.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{pathToFileURL}=require('node:url')
const {classifyThemeReadiness,waitForThemeReadiness,readActualRendererTheme}=require('./verify-ui-refinement.cjs')
const expected={childPid:42,profile:'/owned/profile',theme:'black-orange',url:'file:///owned/index.html',beforeTimeOrigin:100}
function sample(patch={}){
  const value={main:{pid:42,ppid:10,profile:'/owned/profile',persistedReadError:null,persistedTheme:'black-orange'},renderer:{before:{timeOrigin:200},timeOrigin:200,url:expected.url,readyState:'complete',settingsTheme:'black-orange',storeFound:true,initialized:true,storeTheme:'black-orange',domTheme:'black-orange'}}
  if(patch.main)Object.assign(value.main,patch.main)
  if(patch.renderer)Object.assign(value.renderer,patch.renderer)
  return value
}
function clock(){let time=0;return{now:()=>time,advance:ms=>{time+=ms},sleep:async ms=>{time+=ms}}}

test('old document and uninitialized default theme cannot supply reload success; actual new initialized state can',async()=>{
  const old=sample({renderer:{before:{timeOrigin:100},timeOrigin:100}}),pending=sample({renderer:{initialized:false,storeTheme:undefined,domTheme:'transparent'}}),ready=sample(),original=structuredClone([old,pending,ready]),rows=[],time=clock();let index=0
  const result=await waitForThemeReadiness({expected,observe:async()=>[old,pending,ready][index++],now:time.now,sleep:time.sleep,onSample:row=>rows.push(row)})
  assert.equal(index,3);assert.equal(rows.length,3);assert.equal(result.sample,ready);assert.deepEqual([old,pending,ready],original)
})

test('initialized persisted-correct DOM mismatch fails immediately and retains the exact sample',async()=>{
  const wrong=sample({renderer:{domTheme:'transparent'}}),rows=[],time=clock();let sleeps=0
  await assert.rejects(waitForThemeReadiness({expected,observe:async()=>wrong,now:time.now,sleep:async()=>{sleeps++},onSample:row=>rows.push(row)}),/requested theme must actually apply after initialization/)
  assert.equal(sleeps,0);assert.equal(rows.length,1);assert.equal(rows[0].sample,wrong)
})

test('wrong profile, foreign process, unreadable disk and real settings mismatch are rejected rather than waited away',()=>{
  assert.throws(()=>classifyThemeReadiness(sample({main:{profile:'/foreign/profile'}}),expected),/actual owned profile/)
  assert.throws(()=>classifyThemeReadiness(sample({main:{pid:7,ppid:8}}),expected),/another process/)
  assert.throws(()=>classifyThemeReadiness(sample({main:{persistedReadError:{code:'ENOENT'}}}),expected),/settings file could not be read/)
  assert.throws(()=>classifyThemeReadiness(sample({main:{persistedTheme:'transparent'}}),expected),/persisted theme must match/)
  assert.throws(()=>classifyThemeReadiness(sample({renderer:{settingsTheme:'transparent'}}),expected),/real settings:get/)
})

test('missing actual store, initialized store mismatch and changed document are hard failures',()=>{
  assert.throws(()=>classifyThemeReadiness(sample({renderer:{storeFound:false}}),expected),/actual App store/)
  assert.throws(()=>classifyThemeReadiness(sample({renderer:{storeTheme:'transparent'}}),expected),/initialized App store/)
  assert.throws(()=>classifyThemeReadiness(sample({renderer:{before:{timeOrigin:201}}}),expected),/changed document/)
  assert.throws(()=>classifyThemeReadiness(sample({renderer:{url:'file:///other/index.html'}}),expected),/left the actual renderer/)
})

test('a late correct response is recorded but never accepted beyond the existing inspection budget',async()=>{
  const time=clock(),rows=[],ready=sample()
  await assert.rejects(waitForThemeReadiness({expected,observe:async remaining=>{assert.equal(remaining(),12000);time.advance(12001);return ready},now:time.now,sleep:time.sleep,onSample:row=>rows.push(row)}),/exceeded the existing 12-second/)
  assert.equal(rows.length,1);assert.equal(rows[0].elapsedMs,12001);assert.equal(rows[0].sample,ready)
})

test('persistent pending state times out with every original sample; observer errors keep the original failure',async()=>{
  const time=clock(),rows=[],pending=sample({renderer:{initialized:false,domTheme:'transparent'}})
  await assert.rejects(waitForThemeReadiness({expected,observe:async()=>pending,now:time.now,sleep:time.sleep,onSample:row=>rows.push(row)}),/did not become ready within the existing 12-second/)
  assert.equal(rows.length,150);assert(rows.every(row=>row.sample===pending));assert.equal(time.now(),12000)
  const original=Error('actual main inspection timeout'),errors=[]
  await assert.rejects(waitForThemeReadiness({expected,observe:async()=>{throw original},onSample:row=>errors.push(row)}),error=>error===original)
  assert.deepEqual(errors[0].error,{name:original.name,message:original.message})
})

async function rendererRead({origin=200,readyState='complete',storeCount=1}={}){
  const store='{initialized:true,currentView:"home",accounts:[{username:"private-placeholder"}],installed:[],tasks:[],settings:{theme:"black-orange"}}'
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'kamucl-theme-reader113-')),file=path.join(directory,'entry.mjs'),moduleURL=pathToFileURL(file).href
  fs.writeFileSync(file,`export const minifiedAlias=${store};${storeCount===2?`export const second=${store};`:''}`,{flag:'wx'})
  let requests=0
  const run=new Function('performance','document','window',`return (${readActualRendererTheme.toString()})(100)`)
  try{
    const result=await run({timeOrigin:origin},{URL:expected.url,readyState,documentElement:{dataset:{theme:'black-orange'}},querySelectorAll:()=>[{src:moduleURL}]},{kamucl:{invoke:async channel=>{assert.equal(channel,'settings:get');requests++;return{theme:'black-orange'}}}})
    return{result,requests,moduleURL}
  }finally{fs.unlinkSync(file);fs.rmdirSync(directory)}
}

test('serialized production reader observes the already loaded entry export, not nonexistent Vue setupState',async()=>{
  const {result,requests,moduleURL}=await rendererRead()
  assert.equal(requests,1);assert.equal(result.storeExportKey,'minifiedAlias');assert.equal(result.moduleURL,moduleURL);assert.equal(result.initialized,true);assert.equal(result.storeTheme,'black-orange');assert.equal(result.storeFound,true)
  assert.equal(classifyThemeReadiness({main:sample().main,renderer:result},expected),true)
  assert(!JSON.stringify(result).includes('private-placeholder'),'observer must not copy account records')
})

test('serialized reader skips old/loading documents and refuses ambiguous store exports',async()=>{
  for(const options of [{origin:100},{readyState:'loading'}]){const {result,requests}=await rendererRead(options);assert.equal(requests,0);assert.equal(classifyThemeReadiness({main:sample().main,renderer:result},expected),false)}
  const {result}=await rendererRead({storeCount:2});assert.equal(result.storeCandidates,2);assert.equal(result.storeFound,false)
  assert.throws(()=>classifyThemeReadiness({main:sample().main,renderer:result},expected),/actual App store/)
})
