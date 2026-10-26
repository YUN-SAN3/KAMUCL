// Create a reviewable source distribution from Git-tracked build inputs, with per-file hashes.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),Zip=require('adm-zip')
const root=path.resolve(__dirname,'..'),version=require('../package.json').version
const committed=require('./committed-source.cjs').readCommittedSource(root),names=committed.files.map(f=>f.path)
const zip=new Zip(),manifest=[]
for(const {path:name,bytes} of committed.files){zip.addFile(name,bytes);manifest.push({path:name,size:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex')})}
for(const required of ['package-lock.json','src/main/core/voxlink/engine.ts','src/renderer/src/vendor/skinview3d/model.ts','scripts/build-bridge.cjs','THIRD_PARTY_NOTICES.md','licenses/LGPL-3.0.txt'])if(!names.includes(required))throw new Error('Stage source inputs first: '+required)
zip.addFile('SOURCE-MANIFEST.json',Buffer.from(JSON.stringify({version,commit:committed.commit,representation:'raw-git-blobs',files:manifest},null,2)))
const output=path.join(root,'release',`KAMUCL-${version}-source.zip`);fs.mkdirSync(path.dirname(output),{recursive:true});zip.writeZip(output)
const verify=new Zip(output);for(const entry of manifest){const bytes=verify.readFile(entry.path);if(!bytes||crypto.createHash('sha256').update(bytes).digest('hex')!==entry.sha256)throw new Error('Source archive mismatch: '+entry.path)}
console.log(JSON.stringify({output,files:manifest.length,size:fs.statSync(output).size,sha256:crypto.createHash('sha256').update(fs.readFileSync(output)).digest('hex')}))
