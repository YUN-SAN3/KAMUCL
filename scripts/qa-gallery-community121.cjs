// Real packaged renderer/queue; only this explicit plan/commit service fixture is
// controlled. Public network and original installer qualification lives in parity.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const AdmZip = require('adm-zip')
const hash = (bytes, algorithm) => crypto.createHash(algorithm).update(bytes).digest('hex')

function assertQueueProof(proof) {
  assert.equal(proof.classification, 'Real packaged renderer/queue with controlled IPC plan and commit, isolated JAR bytes and disk; no public service or original installer qualification')
  assert.equal(proof.cancelledPreview.committed, false)
  assert.equal(proof.cancelledPreview.discarded, true)
  assert.equal(proof.backgroundNavigation, true)
  assert.equal(proof.dependencyBlocksCommit, true)
  assert.equal(proof.failedCommitLeavesFilesAbsent, true)
  assert.equal(proof.commits.length, 2, 'One explicit failed attempt and one explicit successful retry')
  assert.equal(proof.commits.filter(row => row.completed).length, 1, 'Exactly one successful commit')
  assert(proof.commits[0].error.includes('隔离验证：队列写入失败'))
  assert(proof.commits.every(row => row.includeDependencies === true && typeof row.operationId === 'string' && row.operationId.length > 0))
  assert.notEqual(proof.commits[0].operationId, proof.commits[1].operationId, 'Retry owns a new operation')
  for (const commit of proof.commits) assert(proof.progress.some(row => row.operationId === commit.operationId && row.stage === 'download' && row.overall === .25), 'Retain actual delivered controlled operation progress for each explicit commit')
  assert.equal(proof.observedProgress.ready, true)
  assert(proof.observedProgress.text.includes('25%'), 'Actual queue renderer must observe the controlled progress')
  assert.equal(proof.files.length, 2)
  assert.deepEqual([...proof.commits[1].files].sort(), proof.files.map(file => file.file).sort(), 'Only the actual successful commit owns the verified files')
  for (const file of proof.files) { assert.equal(file.sha1, file.expectedSHA1); assert.equal(file.bytes, file.expectedBytes); assert.match(file.sha256, /^[a-f\d]{64}$/) }
}

module.exports = async function verifyGalleryQueue(h, proof) {
  const { evaluate, main, click, nav, screenshot, ready, textClick } = h
  const jars = ['central-fixture.jar', 'central-required.jar'].map((fileName, index) => {
    const zip = new AdmZip()
    zip.addFile('fabric.mod.json', Buffer.from(JSON.stringify({ schemaVersion: 1, id: index ? 'gallery_required' : 'gallery_selected', version: '1.0.0', name: fileName, environment: '*', depends: index ? {} : { gallery_required: '*' } })))
    const bytes = zip.toBuffer()
    return { fileName, base64: bytes.toString('base64'), expectedSHA1: hash(bytes, 'sha1'), expectedBytes: bytes.length, dependency: !!index }
  })
  const queue = { classification: 'Real packaged renderer/queue with controlled IPC plan and commit, isolated JAR bytes and disk; no public service or original installer qualification', commits: [], progress: [], files: [] }
  proof.queuedInstall121 = queue
  // Added handlers are restored by the original extension's finally map.
  await main(`(()=>{
    gallery118Handlers.set('mods:commit',testElectron.ipcMain._invokeHandlers.get('mods:commit'));
    for(const channel of ['mods:prepare','mods:commit','mods:discard'])testElectron.ipcMain.removeHandler(channel);
    globalThis.gallery121Plans=new Map();globalThis.gallery121PlanIndex=0;globalThis.gallery121Commits=[];globalThis.gallery121Progress=[];globalThis.gallery121FailCommit=true;globalThis.gallery121Jars=${JSON.stringify(jars)};
    globalThis.gallery121Emit=(operationId,stage,value)=>{const row={operationId,taskId:'gallery121-'+operationId,stage,progress:value,overall:value,text:'受控队列操作进度'};gallery121Progress.push(row);for(const w of testElectron.BrowserWindow.getAllWindows())if(w.webContents.getURL().includes('/renderer/index.html'))w.webContents.send('event:progress',row)};
    testElectron.ipcMain.handle('mods:prepare',async(_e,target,input,operationId)=>{
      const id='gallery118-dry-preview-'+(++gallery121PlanIndex);gallery118PrepareRequests.push({target,input,operationId,id});gallery121Emit(operationId,'download',.4);await new Promise(r=>setTimeout(r,900));
      const plan={id,target,files:gallery121Jars.map(j=>({fileName:j.fileName,version:'1.0.0',dependency:j.dependency})),missing:[],warnings:[]};gallery121Plans.set(id,{target,plan});return plan;
    });
    testElectron.ipcMain.handle('mods:discard',(_e,id)=>{gallery118Discarded.push(id);gallery121Plans.delete(id)});
    testElectron.ipcMain.handle('mods:commit',async(_e,id,includeDependencies,operationId)=>{
      const row={id,includeDependencies,operationId,completed:false};gallery121Commits.push(row);gallery121Emit(operationId,'download',.25);await new Promise(r=>setTimeout(r,700));
      if(gallery121FailCommit){gallery121FailCommit=false;row.error='隔离验证：队列写入失败';throw Error(row.error)}
      const prepared=gallery121Plans.get(id);if(!prepared||includeDependencies!==true)throw Error('Missing explicitly included fixture plan');
      const fs=process.mainModule.require('node:fs'),path=process.mainModule.require('node:path'),destination=path.join(prepared.target.folder,'versions',prepared.target.id,'mods');fs.mkdirSync(destination,{recursive:true});
      row.files=gallery121Jars.map(j=>{const file=path.join(destination,j.fileName);if(fs.existsSync(file))throw Error('Fixture must not replace existing MOD');fs.writeFileSync(file,Buffer.from(j.base64,'base64'));return file});row.completed=true;gallery121Plans.delete(id);return'受控队列文件已写入';
    });
  })()`)
  const openFilePicker = async () => {
    await click('[data-favorite-key="modrinth:centralA"] .favorite-download')
    await ready('single MOD queries matching mod files',"(()=>{const m=document.querySelector('.download-modal'),rows=[...m?.querySelectorAll('.file-row')||[]];return{ready:!!m&&rows.length===1&&!m.querySelector('.content-skeleton'),text:m?.innerText}})()")
    assert.equal((await main('gallery118FileRequests')).at(-1).filter.kind, 'mod')
    await click('.download-modal .modal-actions .btn-gold')
    await ready('enqueue dismisses picker and visibly prepares in background',"({ready:!document.querySelector('.download-modal')&&!document.querySelector('.community-confirm')&&!!document.querySelector('.queue-item[data-state=preparing]'),text:document.querySelector('.community-queue')?.innerText})")
  }
  const confirmation = async () => {
    await ready('queued MOD awaits explicit confirmation without installing',"({ready:!!document.querySelector('.queue-item[data-state=confirmation]')&&!document.querySelector('.community-confirm')})")
    await textClick('.queue-item[data-state=confirmation]', '确认前置与安装')
    await ready('necessary front dependency rows are visible',"(()=>{const p=document.querySelector('.community-confirm'),b=p?.querySelector('.btn-gold');return{ready:!!p&&p.querySelectorAll('.dependency-row').length===2&&!!p.querySelector('.dependency-choice input:checked')&&!!b&&!b.disabled}})()")
  }
  await openFilePicker()
  assert.equal((await main('gallery121Commits')).length, 0)
  await nav('settings');assert(!await evaluate("!!document.querySelector('.community-confirm')"))
  await nav('community');await click('[data-ui="community:favorites"]');queue.backgroundNavigation = true
  await confirmation()
  const preview = await main('gallery118PrepareRequests');assert.equal(preview.length, 1);assert.equal(preview[0].input.file.projectId, 'centralA');assert(preview[0].target.id && preview[0].target.folder)
  proof.singleInstallPreview = { mockedPlanOnly: true, committed: false, target: preview[0].target, projectId: preview[0].input.file.projectId }
  await click('.dependency-choice input');assert(await evaluate("document.querySelector('.community-confirm .btn-gold').disabled"));assert.equal((await main('gallery121Commits')).length, 0);queue.dependencyBlocksCommit = true
  await click('.dependency-choice input');await screenshot('community-118-single-install')
  await textClick('.community-confirm .modal-actions', '稍后确认')
  await textClick('.queue-item[data-state=confirmation]', '取消')
  await ready('cancelled preview releases its plan',"({ready:!document.querySelector('.community-confirm')&&!!document.querySelector('.queue-item[data-state=cancelled]')})","({ready:gallery118Discarded.length===1&&gallery118Discarded[0]==='gallery118-dry-preview-1'&&!gallery121Plans.has('gallery118-dry-preview-1')})")
  assert.equal((await main('gallery121Commits')).length, 0);queue.cancelledPreview = { committed: false, discarded: true }
  await textClick('.queue-item[data-state=cancelled]', '清除记录')
  await openFilePicker();await confirmation();await textClick('.community-confirm .modal-actions', '下载前置并安装')
  queue.observedProgress=await ready('controlled queue install exposes operation progress',"(()=>{const e=document.querySelector('.queue-item[data-state=installing]');return{ready:!!e&&e.innerText.includes('25%'),text:e?.innerText}})()")
  await ready('controlled write failure remains visible and retryable',"(()=>{const e=document.querySelector('.queue-item[data-state=failed]');return{ready:!!e&&e.innerText.includes('隔离验证：队列写入失败'),text:e?.innerText}})()")
  const target = (await main('gallery118PrepareRequests')).at(-1).target
  const paths = jars.map(j => path.join(target.folder, 'versions', target.id, 'mods', j.fileName))
  assert(paths.every(file => !fs.existsSync(file)));queue.failedCommitLeavesFilesAbsent = true;await screenshot('community-121-queue-controlled-error')
  await textClick('.queue-item[data-state=failed]', '重试');await confirmation();await textClick('.community-confirm .modal-actions', '下载前置并安装')
  await ready('one explicitly confirmed retry writes both controlled JARs',"({ready:document.querySelectorAll('.queue-item[data-state=completed]').length===1&&!document.querySelector('.community-confirm')})","({ready:gallery121Commits.length===2&&gallery121Commits.filter(r=>r.completed).length===1})")
  queue.commits = await main('gallery121Commits');queue.progress = await main('gallery121Progress')
  queue.files = jars.map((j, i) => { const bytes = fs.readFileSync(paths[i]);return { file: paths[i], bytes: bytes.length, sha1: hash(bytes,'sha1'), sha256: hash(bytes,'sha256'), expectedSHA1: j.expectedSHA1, expectedBytes: j.expectedBytes } })
  assertQueueProof(queue);await screenshot('community-121-queue-controlled-complete')
  // Only files just created from these exact fixture bytes are removed.
  for (const file of queue.files) { assert.equal(hash(fs.readFileSync(file.file),'sha1'),file.expectedSHA1);fs.unlinkSync(file.file) }
  proof.checks.push('Real queued favorite MOD: background route navigation, necessary dependency blocking, later/cancel plan discard without commit, controlled error/progress, explicit retry with exactly one successful controlled commit and two isolated JAR hashes; no public transfer or original installer claim')
}
module.exports.assertQueueProof = assertQueueProof
