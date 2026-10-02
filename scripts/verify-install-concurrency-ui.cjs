// Reuse the isolated production-renderer harness, replacing its scenarios only.
const fs=require('node:fs'),path=require('node:path');
let source=fs.readFileSync(path.resolve('scripts/verify-resource-network-ui.cjs'),'utf8');
source=source.replace("case 'versions:manifest': return [{ id: '26.2', type: 'release', releaseTime: '2026-09-10' }]","case 'versions:manifest': return ['1.21.9','1.21.11'].map(id=>({id,type:'release',releaseTime:'2026-09-10'}))");
const start=source.indexOf(" await nav('mods');"),end=source.indexOf('\n}).catch',start);
source=source.slice(0,start)+`
 await nav('game');await click('版本下载');
 const install=async id=>{await run(\`(()=>{const row=[...document.querySelectorAll('.version-row')].find(r=>r.querySelector('.version-id').textContent===\${JSON.stringify(id)});if(!row)throw Error('missing row');const b=row.querySelector('button');if(b.disabled)throw Error('Other download locked '+\${JSON.stringify(id)});b.click()})()\`);await wait(200);await click('确认安装')};
 await install('1.21.9');await install('1.21.11');
 assert.deepEqual(requests.filter(r=>r.channel==='versions:install').map(r=>r.args[0]),['1.21.9','1.21.11']);
 const progress=(id,n)=>win.webContents.send('event:progress',{versionId:id,taskId:'task-'+id,taskTitle:'安装 '+id,stage:'client',progress:n,overall:n,text:'下载游戏本体',speed:1048576});
 progress('1.21.9',.23);progress('1.21.11',.71);await wait(200);
 const rows=()=>run(\`[...document.querySelectorAll('.version-row')].map(r=>({id:r.querySelector('.version-id').textContent,text:r.querySelector('.row-progress-text')?.textContent,disabled:r.querySelector('button').disabled}))\`);
 let state=await rows();assert(state.find(x=>x.id==='1.21.9').text.includes('23%'));assert(state.find(x=>x.id==='1.21.11').text.includes('71%'));await shot('two-active-downloads');
 win.webContents.send('event:taskDone',{taskId:'task-1.21.9',ok:false,cancelled:true});win.webContents.send('event:installDone',{versionId:'1.21.9',taskId:'task-1.21.9',ok:false,cancelled:true});await wait(250);
 state=await rows();assert(!state.find(x=>x.id==='1.21.9').disabled);assert(state.find(x=>x.id==='1.21.11').disabled);assert(state.find(x=>x.id==='1.21.11').text.includes('71%'));
 progress('1.21.11',.88);await wait(200);state=await rows();assert(state.find(x=>x.id==='1.21.11').text.includes('88%'));await shot('one-cancelled-other-continues');assert.deepEqual(errors,[]);
 fs.writeFileSync(path.join(root,'result.json'),JSON.stringify({pass:true,checks:['second version accepted during first download','independent progress','cancelled version unlocks','other task keeps updating'],errors},null,2));console.log('PASS production concurrent installation UI: '+root);win.destroy();app.quit();
`+source.slice(end);
const generated=path.resolve('out/verify-install-concurrency-ui.generated.cjs');fs.writeFileSync(generated,source);require(generated);
