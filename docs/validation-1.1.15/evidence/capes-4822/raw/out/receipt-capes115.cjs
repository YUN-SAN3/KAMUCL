// Private evidence binder. This never launches an app, changes a profile, or fills missing observations.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict')
const qa=require('../scripts/qa-capes115.cjs'),geometry=require('../scripts/qa-coordinate-geometry114.cjs')
const digest=bytes=>crypto.createHash('sha256').update(bytes).digest('hex')
const record=file=>{const full=fs.realpathSync.native(file),stat=fs.lstatSync(file);assert(stat.isFile()&&!stat.isSymbolicLink());const bytes=fs.readFileSync(full);return{file:full,bytes:bytes.length,sha256:digest(bytes)}}
function bind(directory,{requiredSuccess=false}={}){
 const root=fs.realpathSync.native(directory),proofFile=path.join(root,'proof.json'),raw=fs.readFileSync(proofFile),proof=JSON.parse(raw),allowed=[record(proofFile)]
 assert.equal(proof.schema,'kamucl-capes115-real-ui');assert.equal(proof.version,'1.1.15');assert(['transparent','black-orange','blue-white','custom'].includes(proof.theme))
 const add=(name,expected)=>{assert.equal(path.basename(name),name,'Only explicit local evidence filenames allowed');const row=record(path.join(root,name));assert.equal(path.dirname(row.file),root);if(expected){assert.equal(row.sha256,expected.sha256);if(expected.bytes!==undefined)assert.equal(row.bytes,expected.bytes)}allowed.push(row);return row}
 const result={schema:'kamucl-capes115-immutable-binding',generatedAt:new Date().toISOString(),proof:allowed[0],theme:proof.theme,
  success:proof.complete===true,classification:proof.classification,root:proof.root,profile:proof.profile,application:proof.application??null,identity:proof.identity??null,
  observedFixtureType:'Synthetic Microsoft account/profile IPC; SHA-pinned public PNG originals. No actual Microsoft login, original user aliases, game launch, human hearing or motion FPS qualification claimed',
  sourceProvenanceAvailable:Array.isArray(proof.qaSources)&&Array.isArray(proof.observerSources),checks:[],historicalError:proof.error??null}
 for(const source of proof.fixtures?.sources??[])add(source.name+'.png',source)
 for(const cape of proof.fixtures?.capes??[]){const bytes=add(cape.id+'.png',{sha256:cape.pngSha256});assert.equal(digest(Buffer.from(cape.dataUrl)),cape.dataUrlSha256);assert.equal(Buffer.from(cape.dataUrl.split(',')[1],'base64').length,bytes.bytes)}
 for(const capture of proof.captures??[])add(capture.file,capture)
 result.counts={publicOriginals:proof.fixtures?.sources?.length??0,derivedCapes:proof.fixtures?.capes?.length??0,screenshots:proof.captures?.length??0,
  operations:proof.operations?.length??0,originalInputs:proof.inputs?.length??0,gpuRows:proof.cleanup?.find(item=>item.observer)?.observer?.final?.rows?.length??0}
 const check=(label,run)=>{try{run();result.checks.push({label,passed:true})}catch(error){result.checks.push({label,passed:false,name:error.name,message:error.message})}}
 if(result.success){
  check('Original required evidence and source provenance are present',()=>{assert(result.sourceProvenanceAvailable);assert.equal(proof.qaSources.length,7);assert.equal(proof.observerSources.length,8);assert.equal(result.counts.publicOriginals,3);assert.equal(result.counts.derivedCapes,5);assert(proof.inputs.length>0);assert.equal(proof.focusEmulationDisabled,true)
   for(const source of proof.qaSources){const actual=record(source.file);assert.equal(actual.sha256,source.sha256);assert.equal(actual.bytes,source.bytes);allowed.push(actual)}
   for(const source of proof.observerSources){const fn=qa[source.name]??require('../scripts/qa-native-window115.cjs')[source.name];assert.equal(typeof fn,'function');assert.equal(digest(Buffer.from(fn.toString())),source.sourceSha256)}
  })
  check('Every actual input, snapshot and native capture is bound to the real foreground HWND/PID',()=>{
   assert.equal(proof.initialForegroundFocus.after,proof.initialForegroundFocus.hwnd);assert.equal(proof.initialForegroundFocus.pid,proof.identity.pid);assert(proof.nativeForegroundObservations.length>0)
   for(const observation of proof.nativeForegroundObservations)qa.assertCapeForeground(observation.value,proof.identity)
   for(const input of proof.inputs)qa.assertCapeForeground(input.nativeBefore.nativeForeground,proof.identity)
   for(const capture of proof.captures){qa.assertCapeForeground(capture.before.native.nativeForeground,proof.identity);qa.assertCapeForeground(capture.afterNative.nativeForeground,proof.identity)}
  })
  check('Final executable remains the exact actually observed archive',()=>{const actual=record(proof.application.path);assert.equal(actual.sha256,proof.application.sha256);assert.equal(actual.bytes,proof.application.bytes)})
  check('Observed main PID and disposable profile bind to the original owned child',()=>{assert.equal(proof.binding.profile,fs.realpathSync.native(proof.profile));assert.equal(proof.binding.pid,proof.identity.pid);assert(proof.binding.pid===proof.ownedProcess.pid||proof.binding.ppid===proof.ownedProcess.pid);assert.equal(proof.install.profile,proof.binding.profile)})
  check('Two actual clamped minimum windows preserve original strict mapping',()=>qa.assertCapeMinimum(proof.minimum,proof.theme))
  check('Every actual input has original trusted target observations and stable geometry',()=>{
   const expected={...proof.identity,timeOrigin:proof.references[0].timeOrigin,url:proof.references[0].url,zoom:1.25}
   for(const operation of proof.operations){assert.equal(operation.complete,true);const samples=operation.samples;assert(samples?.length>=2);assert(samples.at(-1).at<operation.deadline);assert.equal(geometry.coordinateGeometryReady(samples.at(-1).value,samples.at(-2).value,expected),true)
    if(operation.token){assert(operation.targets);if(operation.label?.includes('native drag'))qa.assertCapeDrag(operation.targets,expectedWithSelector(operation),operation.actual.coordinate.bounds);else geometry.assertTrustedTargetObservation(operation.targets,expectedWithSelector(operation))}
   }
   function expectedWithSelector(operation){return{selector:operation.selector,timeOrigin:expected.timeOrigin,url:expected.url}}
  })
  check('All five thumbnail and back-view captures bind to selected independent pixels',()=>{
   for(const cape of proof.fixtures.capes){for(const kind of ['thumbnail','3d']){const capture=proof.captures.find(row=>row.label==='03-active-'+cape.id+'-'+kind);assert(capture);if(capture.deadline!==undefined)assert(capture.returnedAt<capture.deadline);qa.assertCapePresentation(capture.before.renderer,{theme:proof.theme,timeOrigin:proof.references[0].timeOrigin,url:proof.references[0].url,username:proof.accounts[0].username,activeId:cape.id,capes:proof.fixtures.capes});qa.assertCapeViewport(capture.before.native,capture.before.renderer,proof.theme,proof.originalNative.minimumSize)}}
   const drag=proof.operations.find(row=>row.label?.includes('native drag'));assert(drag?.complete);const clean=proof.operations.filter(row=>row.clearToasts===true);assert(clean.length>=5);for(const operation of clean)assert.equal(operation.actual.coordinate.absent,true)
  })
  check('Late old account response returns after current account selection without replacing its pixels',()=>{
   const final=proof.finalMain,old=final.changes.at(-1),selected=final.selections.at(-1);assert.equal(final.selected,proof.accounts[1].id);assert(old.order<selected.order&&old.returnedOrder>selected.order);assert.equal(old.accountId,proof.accounts[0].id);assert.equal(old.returned,true);assert.equal(final.pending,false);assert.equal(final.uploads.length,0)
   for(const label of ['06-account-B-before-old-response','07-account-B-after-old-response']){const capture=proof.captures.find(row=>row.label===label);assert(capture);qa.assertCapePresentation(capture.before.renderer,{theme:proof.theme,timeOrigin:proof.references[0].timeOrigin,url:proof.references[0].url,username:proof.accounts[1].username,activeId:'cape-common',capes:proof.fixtures.capes.filter(row=>row.id==='cape-common')})}
  })
  check('Original fixture, GL hooks, trusted observer, focus setting and native geometry are restored',()=>{
   assert.equal(proof.cleanup.find(item=>item.observer)?.observer.complete,true);assert.equal(proof.cleanup.find(item=>item.fixture)?.fixture.complete,true);assert.equal(proof.cleanup.find(item=>item.trustedTargets)?.trustedTargets.complete,true);assert.equal(proof.cleanup.find(item=>item.harnessFocusEmulationRestored)?.harnessFocusEmulationRestored,true)
   const restoration=proof.cleanup.find(item=>item.nativeRestore)?.nativeRestore;assert.equal(restoration?.complete,true);qa.assertCapeRestoration(restoration.after,proof.originalNative,proof.originalRenderer,proof.originalWin32)
  })
 }else result.checks.push({label:'Historical run remains failed; no missing visual, input, cleanup or source proof is filled',passed:true})
 result.allowlist=allowed;result.qualifiedFunctionalEvidence=result.success&&result.checks.every(check=>check.passed)
 result.privateNativeAllowlist=[];for(const capture of proof.captures??[])if(capture.privateNative){for(const crop of capture.privateNative.crops){const full=path.join(root,crop.file),row=record(full);assert.equal(path.dirname(row.file),root);assert.equal(row.sha256,crop.sha256);assert.equal(row.bytes,crop.bytes);result.privateNativeAllowlist.push(row)}}
 result.visualScore=null;result.visualClassification='Clear original screenshots require independent visual review; functional binding does not assign an appearance score or infer correct back pose.'
 result.processExitQualification='The proof is saved before runner close; exact owned child close packet and after inventory must be linked separately. No process release is inferred from hook restoration.'
 if(requiredSuccess)assert.equal(result.qualifiedFunctionalEvidence,true,JSON.stringify(result.checks.filter(row=>!row.passed)))
 return result
}
module.exports={bind}
if(require.main===module){
 const args=process.argv.slice(2),requiredSuccess=args[0]==='--require-success';if(requiredSuccess)args.shift();assert(args.length>=2,'Usage: node out/receipt-capes115.cjs [--require-success] output.json proof-directory [...proof-directory]')
 const output=path.resolve(args.shift());assert(!fs.existsSync(output),'Never overwrite an existing evidence receipt');const runs=args.map(directory=>bind(directory,{requiredSuccess})),themes=runs.filter(run=>run.qualifiedFunctionalEvidence).map(run=>run.theme)
 const receipt={schema:'kamucl-capes115-final-or-history-receipt',generatedAt:new Date().toISOString(),requiredSuccess,runs,
  allFourThemesQualified:['transparent','black-orange','blue-white','custom'].every(theme=>themes.includes(theme)),classification:'Original per-run evidence, file hashes and actual owned inputs; historical failures remain separate. No visual score or public account behavior inferred.'}
 fs.writeFileSync(output,JSON.stringify(receipt,null,2),{flag:'wx'});console.log(JSON.stringify({output,runs:runs.length,allFourThemesQualified:receipt.allFourThemesQualified,receipt:record(output)}))
}
