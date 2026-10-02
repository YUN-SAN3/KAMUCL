// Validate the built release without opening the user's profile or stopping any process.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process'),Zip=require('adm-zip'),asar=require('asar')
const version=require('../package.json').version,sha=b=>crypto.createHash('sha256').update(b).digest('hex')
const production=fs.readFileSync('release/win-unpacked/resources/app.asar')
assert.equal(JSON.parse(asar.extractFile('release/win-unpacked/resources/app.asar','package.json').toString()).version,version)
const startup=spawnSync(process.execPath,['scripts/verify-portable-startup.cjs'],{windowsHide:true,encoding:'utf8',timeout:180000})
assert.ifError(startup.error);assert.equal(startup.status,0,startup.stderr)
const proof=JSON.parse(startup.stdout),cache=path.dirname(proof.results[0].cache)
assert(fs.readFileSync(path.join(cache,'resources','app.asar')).equals(production),'portable ASAR mismatch')
const zipPath=`release/KAMUCL-${version}-windows-x64.zip`,zip=new Zip(zipPath),root=fs.mkdtempSync(path.join(os.tmpdir(),'KAMUCL ZIP 中文 '))
for(const e of zip.getEntries()){const target=path.resolve(root,e.entryName);assert(target.startsWith(path.resolve(root)+path.sep),'ZIP outside extraction directory')}
zip.extractAllTo(root,false)
assert(fs.readFileSync(path.join(root,'resources','app.asar')).equals(production),'ZIP ASAR mismatch')
const marker=path.join(root,'entry-proof.json'),p=spawnSync(path.join(root,'KAMUCL.exe'),['-e',`require('fs').writeFileSync(${JSON.stringify(marker)},JSON.stringify({electron:process.versions.electron,exe:process.execPath}))`],{env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},windowsHide:true,encoding:'utf8',timeout:30000})
assert.ifError(p.error);assert.equal(p.status,0,p.stderr);assert(JSON.parse(fs.readFileSync(marker)).electron)
const names=[`KAMUCL-${version}.exe`,`KAMUCL-${version}-windows-x64.zip`],hashes=names.map(n=>`${sha(fs.readFileSync('release/'+n))}  ${n}`).join('\n')+'\n'
fs.writeFileSync('release/SHA256SUMS.txt',hashes)
const report={version,portable:proof,zipRoot:root,asarSHA256:sha(production),hashes}
fs.writeFileSync(`out/release-${version}-proof.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2))
