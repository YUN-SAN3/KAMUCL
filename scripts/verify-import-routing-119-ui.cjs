// Synthetic archives through real production classifier and general import UI. No installation/network fixture.
const fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib'),assert=require('node:assert/strict'),Zip=require('adm-zip')
module.exports=async({call,evaluate,main,nav,wait,root,screenshot,version})=>{
 const theme=process.env.KAMUCL_TEST_THEME||'black-orange',proof={version,theme,complete:false,checks:[]},save=()=>fs.writeFileSync(`out/import-routing-119-ui-${theme}.json`,JSON.stringify(proof,null,2))
 const nbtFile=path.join(root,'import-nbt.cjs');require('esbuild').buildSync({entryPoints:['src/main/core/nbt.ts'],outfile:nbtFile,bundle:true,platform:'node',format:'cjs'});
 const level=zlib.gzipSync(require(nbtFile).writeNbt({Data:{LevelName:'Import routing fixture',DataVersion:3465,Version:{Name:'1.20.1',Id:3465}}}));
 const make=(name,index)=>{const z=new Zip();z.addFile('overrides/saves/world/level.dat',level);if(index!==undefined)z.addFile('modrinth.index.json',Buffer.from(index));const p=path.join(root,name);z.writeZip(p);return p}
 const pack=make('PCL-export-fixture.zip',JSON.stringify({game:'minecraft',formatVersion:1,name:'Fixture only',versionId:'1',dependencies:{minecraft:'1.20.1',forge:'47.4.23'},files:[]})),world=make('ordinary-world.zip'),bad=make('bad-pack-with-world.zip','{broken');
 const ready=async(label,expression)=>{let state;for(let i=0;i<75;i++){state=await evaluate(expression);if(state?.ready){proof.checks.push({label,state});save();return state}await wait(80)}proof.failure={label,state};save();throw Error(label+': '+JSON.stringify(state))}
 const coordinate=async selector=>{const p=await ready('visible '+selector,`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)return{ready:false};e.scrollIntoView({block:'nearest'});const r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;return{ready:!e.disabled&&e.contains(document.elementFromPoint(x,y)),x,y}})()`);for(const type of ['mousePressed','mouseReleased'])await call('Input.dispatchMouseEvent',{type,x:p.x,y:p.y,button:'left',buttons:type==='mousePressed'?1:0,clickCount:1})}
 const choose=async file=>{await main(`testElectron.dialog.showOpenDialog=async()=>({canceled:false,filePaths:[${JSON.stringify(file)}]})`);await coordinate('[data-ui="App:0995359279d1"]')}
 await nav('skins');await choose(pack);
 await ready('topbar selects entire pack before its world',`(()=>({ready:!!document.querySelector('.mp-modal .mp-summary')&&!document.querySelector('.world-modal'),text:document.querySelector('.mp-modal')?.innerText}))()`);
 assert((await evaluate("document.querySelector('.mp-modal').innerText")).includes('47.4.23'));await screenshot('import-119-pack-priority');await coordinate('.mp-actions .btn-ghost');
 await choose(world);await ready('ordinary ZIP still opens world importer',`(()=>({ready:!!document.querySelector('.world-modal')&&!document.querySelector('.mp-modal')}))()`);await screenshot('import-119-ordinary-world');await coordinate('.world-modal .btn-ghost');
 await choose(bad);await ready('malformed recognized pack produces an error and no world dialog',`(()=>({ready:document.body.innerText.includes('modrinth.index.json 已损坏')&&!document.querySelector('.world-modal')&&!document.querySelector('.mp-modal')}))()`);await screenshot('import-119-malformed-pack');
 // CDP supplies the actual file path through Chromium's native drag machinery.
 const point=await evaluate(`(()=>{const r=document.querySelector('.content').getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);
 for(const type of ['dragEnter','dragOver','drop'])await call('Input.dispatchDragEvent',{type,...point,data:{items:[],files:[pack],dragOperationsMask:1}});
 await ready('native file drag uses the same whole-pack route',`(()=>({ready:!!document.querySelector('.mp-modal .mp-summary')&&!document.querySelector('.world-modal')}))()`);await screenshot('import-119-drag-pack');await coordinate('.mp-actions .btn-ghost');
 proof.complete=true;save();console.log('PASS 1.1.9 import routing real UI with synthetic archives')
}
