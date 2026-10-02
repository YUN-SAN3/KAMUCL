const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{Worker}=require('node:worker_threads'),{app}=require('electron'),Zip=require('adm-zip')
const root=fs.mkdtempSync(path.resolve('out/packaged-mod-worker-'));app.setPath('userData',path.join(root,'profile'))
app.whenReady().then(async()=>{
 const dir=path.join(root,'mods');fs.mkdirSync(dir);const zip=new Zip();zip.addFile('fabric.mod.json',Buffer.from('{"id":"package_test","name":"打包扫描测试","version":"1"}'));zip.writeZip(path.join(dir,'test.jar'))
 const result=await new Promise((resolve,reject)=>{const worker=new Worker(path.resolve('release/win-unpacked/resources/app.asar/out/main/modScanWorker.cjs'),{workerData:{dir,hash:true}});const timer=setTimeout(()=>{worker.terminate();reject(Error('packaged worker timeout'))},15000);worker.once('message',x=>{clearTimeout(timer);worker.terminate();resolve(x)});worker.once('error',e=>{clearTimeout(timer);reject(e)})})
 assert(!result.error,result.error);assert.equal(result.result.length,1);assert.equal(result.result[0].id,'package_test');assert.equal(result.result[0].sha1.length,40)
 fs.writeFileSync(path.join(root,'result.json'),JSON.stringify({pass:true,result},null,2));console.log('PASS worker inside production ASAR: '+root);app.quit()
}).catch(e=>{console.error(e);app.exit(1)})
