const {test}=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),Zip=require('adm-zip')
const {THEMES,LAYOUTS,assertDownloadRoot,fixturePack,assertActualLayout}=require('../scripts/verify-download-location-112.cjs')
test('native download QA requires active, compatibility and shared roots to agree',()=>{
 const root=path.resolve('out','synthetic-native-qa-root'),value={gameDir:root,activeFolder:root,folders:[{path:root,isDefault:true},{path:path.resolve('out','old'),isDefault:false}]}
 assertDownloadRoot(value,root)
 for(const bad of [{...value,activeFolder:path.resolve('out','old')},{...value,gameDir:path.resolve('out','old')},{...value,folders:value.folders.map(row=>({...row,isDefault:!row.isDefault}))},{...value,folders:value.folders.map(row=>({...row,isDefault:true}))}])assert.throws(()=>assertDownloadRoot(bad,root))
})
function scene(){return{theme:'custom',expectedTheme:'custom',native:{visible:true,focused:true},renderer:{focused:true,hidden:false},layout:{horizontalOverflow:false},path:{readOnly:true,value:'synthetic/path'},expectedPath:'synthetic/path',controls:{change:{hit:true},manage:{hit:true}},body:'默认下载位置；已有游戏保留原位置',screenshot:{bytes:123,sha256:'a'.repeat(64)}}}
test('native scene gate rejects obscured controls, stale paths and actual focus/overflow failure',()=>{
 assertActualLayout(scene())
 for(const mutate of [v=>v.controls.change.hit=false,v=>v.controls.manage.hit=false,v=>v.path.value='old/root',v=>v.native.focused=false,v=>v.renderer.hidden=true,v=>v.layout.horizontalOverflow=true,v=>v.screenshot.bytes=0,v=>v.theme='black-orange']){const value=scene();mutate(value);assert.throws(()=>assertActualLayout(value))}
})
test('native fixture is explicitly a small fullpack with Chinese section-sign names and no public player content',()=>{
 const bytes=fixturePack(),zip=new Zip(bytes),entries=zip.getEntries().map(row=>row.entryName)
 assert.equal(entries.length,7);assert(entries.some(row=>/versions\/112-合成安装-§\/.*\.json$/.test(row)));assert(entries.some(row=>row.endsWith('mods/§ 中文模组.jar')));assert(entries.some(row=>row.endsWith('resourcepacks/中文 材质.zip')));assert(entries.some(row=>row.endsWith('shaderpacks/§ 光影.zip')));assert(bytes.length<10000)
 const jar=zip.getEntries().find(row=>row.entryName.endsWith('.jar')&&row.entryName.includes('/versions/'));assert.match(jar.getData().toString(),/synthetic runtime; never launched/)
 assert.deepEqual(THEMES,['black-orange','blue-white','transparent','custom']);assert.deepEqual(LAYOUTS,[[960,620,1],[1280,900,1.25],[960,620,1.25]])
})
