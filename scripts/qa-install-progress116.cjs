const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict')
module.exports=async function(h,binding){
 const file=path.resolve(process.env.KAMUCL_INSTALLER_EVENTS116||''),allowed=path.resolve('out')+path.sep
 assert(file.startsWith(allowed)&&/^installer-pipeline116-events-[a-f0-9-]+\.json$/.test(path.basename(file)))
 const bytes=fs.readFileSync(file),capture=JSON.parse(bytes)
 assert(capture.committedConfig&&capture.spawned===1&&capture.closed===1)
 for(const row of capture.sourceHashes)assert.equal(crypto.createHash('sha256').update(fs.readFileSync(row.file)).digest('hex'),row.sha256)
 const lane=e=>e.parallelStages?.find(l=>l.id.endsWith('/processor'))
 const cases=[['waiting',capture.events.findLast(e=>lane(e)?.state==='waiting')],['java',capture.events.find(e=>lane(e)?.stage==='java'&&lane(e)?.state==='running')],['generating',capture.events.find(e=>lane(e)?.stage==='loader-process'&&lane(e)?.state==='running')],['generated',capture.events.find(e=>lane(e)?.stage==='loader-process'&&lane(e)?.state==='done')]]
 assert(cases.every(([,e])=>e),'Original production phase receipts must exist, never fabricate an absent phase')
 const id='ui-replay116-'+crypto.randomUUID(),proof={complete:false,sourceFile:file,sourceSHA256:crypto.createHash('sha256').update(bytes).digest('hex'),classification:'Original production Forge orchestration fixture events replayed through the owned EXE event:progress receiver for original download-center UI appearance. Java/child are synthetic; no live installation, real JVM or game claim. Failure terminal below is separate UI fault injection.',cases:[]}
 const send=async(channel,event)=>h.main(`(()=>{const w=testElectron.BrowserWindow.fromId(${binding.windowId});if(process.pid!==${binding.pid}||!w||w.webContents.id!==${binding.webContentsId})throw Error('Cannot send replay to unowned process');w.webContents.send(${JSON.stringify(channel)},${JSON.stringify(event)});return true})()`)
 const until=async(test)=>{for(let i=0;i<100;i++){const value=await h.evaluate(test);if(value)return;await h.wait(80)}const actual=await h.evaluate("[...document.querySelectorAll('.dl-stage')].map(e=>({id:e.dataset.ui,text:e.querySelector('.dl-stage-detail')?.textContent}))");throw Error('Original download center did not show required replay state: '+JSON.stringify({test,actual}))}
 await h.nav('game')
 await send('event:progress',{...cases[0][1],taskId:id,taskTitle:'Forge 运行文件状态（合成回放）'})
 await h.click('.dl-toggle')
 const target="[...document.querySelectorAll('.dl-stage')].filter(e=>e.querySelector('.dl-stage-heading span')?.textContent==='生成运行文件')";
 for(const [label,event]of cases){
  await send('event:progress',{...event,taskId:id,taskTitle:'Forge 运行文件状态（合成回放）'});const expected=lane(event);
  await until('(('+target+').length===1&&('+target+')[0].querySelector(".dl-stage-detail")?.textContent==='+JSON.stringify(expected.text)+')');
  await h.evaluate('('+target+')[0].scrollIntoView({block:"center",behavior:"instant"})');await h.wait(100);
  const observation=await h.evaluate('(()=>{const e=('+target+')[0],r=e?.getBoundingClientRect(),p=e?.closest(".dl-panel")?.getBoundingClientRect();return{text:e?.textContent,within:r&&r.top>=0&&r.bottom<=innerHeight,panelBounds:p,status:e?.querySelector(".dl-stage-heading .muted")?.textContent,indeterminateBar:e&&!e.querySelector(".dl-bar")}})()');
  assert(observation.within);assert.equal(observation.status,expected.state==='done'?'已就绪':expected.state==='waiting'?'准备中':'处理中');assert.equal(observation.indeterminateBar,!!expected.indeterminate);
  proof.cases.push({label,event,observation,screenshot:await h.screenshot('installer116-'+label)})
 }
 await send('event:progress',{...capture.events.at(-1),taskId:id,taskTitle:'Forge 运行文件状态（合成回放）'})
 await send('event:taskDone',{taskId:id,ok:true})
 await until("!!document.querySelector('.dl-item.dl-done')")
 proof.completed=await h.screenshot('installer116-completed')
 const failureId=id+'-failure';await send('event:progress',{...cases[2][1],taskId:failureId,taskTitle:'Forge 失败状态（界面故障注入）'})
 await send('event:taskDone',{taskId:failureId,ok:false,stage:'loader-process',error:'合成：安装器未生成运行文件；没有执行真实 Java'})
 await until("document.querySelector('.dl-item.dl-error')?.textContent.includes('未生成运行文件')")
 proof.failure=await h.screenshot('installer116-failure-injected')
 for(let i=0;i<2;i++){await h.click('.dl-item .dl-dismiss');await h.wait(150)}
 await until("!document.querySelector('.dl-item')")
 await h.click('.dl-panel .notice-head button');await until("!document.querySelector('.dl-panel')");await h.nav('home');proof.complete=true;return proof
}
