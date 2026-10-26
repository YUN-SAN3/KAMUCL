// Explicitly requested self-owned application validation. No existing player profile.
// Private device codes/tokens never enter the public receipt or console.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto')
const {app}=require('electron'),{buildSync}=require('esbuild')
const root=path.resolve('out'), resume=process.argv.indexOf('--resume'), directory=resume>=0?path.resolve(process.argv[resume+1]||''):fs.mkdtempSync(path.join(root,'microsoft122-private-'))
assert(directory.startsWith(root+path.sep+'microsoft122-private-'),'Only the separately created test profile is permitted')
const profile=path.join(directory,'profile'),data=path.join(directory,'app-data');fs.mkdirSync(profile,{recursive:true});fs.mkdirSync(data,{recursive:true})
app.setPath('userData',profile);app.setPath('appData',data)
const sha=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
const sourceFiles=['src/main/core/accounts.ts','src/main/core/microsoftIdentity.ts','src/main/core/microsoftTls.ts','src/main/core/settings.ts','src/shared/types.ts'].map(file=>({file,sha256:sha(file)}))
const receipt={classification:'Self-owned Microsoft application real-service integration; fresh isolated encrypted profile; no pre-existing credentials',version:require('../package.json').version,startedAt:new Date().toISOString(),complete:false,sourceFiles,deviceAuthorization:false,fullServiceChain:false,restartRefresh:false}
const publicReceipt=path.join(directory,resume>=0?'restart-receipt.json':'receipt.json'),save=()=>fs.writeFileSync(publicReceipt,JSON.stringify(receipt,null,2)+'\n')
buildSync({entryPoints:['src/main/core/accounts.ts'],bundle:true,platform:'node',format:'cjs',external:['electron','koffi'],outfile:path.join(directory,'accounts.cjs')})
let accounts,timer
app.whenReady().then(async()=>{
  accounts=require(path.join(directory,'accounts.cjs'));save()
  // The reviewed setting only enables system CONNECT; end-to-end official TLS remains.
  const settingsBundle=path.join(directory,'settings.cjs')
  buildSync({entryPoints:['src/main/core/settings.ts'],bundle:true,platform:'node',format:'cjs',external:['electron','koffi'],outfile:settingsBundle})
  require(settingsBundle).saveSettings({msUseProxy:true})
  if(resume>=0){
    const account=accounts.selectedAccount();assert(account&&account.type==='microsoft')
    const refreshed=await accounts.refreshMicrosoft(account)
    receipt.restartRefresh=refreshed.msOAuthClientId==='06cc8cf6-4b8f-4631-8459-b2bd828808f8'&&!refreshed.msReauthRequired
    assert(receipt.restartRefresh);receipt.complete=true;receipt.status=accounts.microsoftAuthStatus();receipt.finishedAt=new Date().toISOString();save();console.log(JSON.stringify({complete:true,restartRefresh:true,receipt:publicReceipt}));app.quit();return
  }
  const info=await accounts.beginMsDeviceCode(async(account,error)=>{
    clearTimeout(timer);receipt.finishedAt=new Date().toISOString();receipt.status=accounts.microsoftAuthStatus()
    if(account){receipt.fullServiceChain=account.msOAuthClientId==='06cc8cf6-4b8f-4631-8459-b2bd828808f8'&&!account.msReauthRequired;receipt.complete=receipt.fullServiceChain;receipt.encryptedPersisted=fs.existsSync(path.join(profile,'accounts.json'));console.log(JSON.stringify({complete:receipt.complete,fullServiceChain:receipt.fullServiceChain,receipt:publicReceipt,profileDirectory:directory}))}
    else{receipt.error=error||'Login cancelled';console.log(JSON.stringify({complete:false,status:receipt.status,error:receipt.error,receipt:publicReceipt}))}
    save();app.exit(receipt.complete?0:1)
  })
  receipt.deviceAuthorization=true;receipt.status=accounts.microsoftAuthStatus();save()
  console.log(JSON.stringify({verificationUri:info.verificationUri,userCode:info.userCode,application:'KAMUCL',receipt:publicReceipt}))
  timer=setTimeout(()=>{accounts.cancelMsLogin();receipt.error='No completed user authorization within the test window';receipt.finishedAt=new Date().toISOString();save();app.exit(1)},16*60*1000)
}).catch(error=>{receipt.error=String(error.message||error);receipt.status=accounts?.microsoftAuthStatus();receipt.finishedAt=new Date().toISOString();save();console.error(JSON.stringify({complete:false,error:receipt.error,status:receipt.status,receipt:publicReceipt}));app.exit(1)})
