// Verify the exact shipped source archive, then build from a fresh extraction.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{execFileSync,spawnSync}=require('node:child_process'),Zip=require('adm-zip')
const root=path.resolve(__dirname,'..'),version=require('../package.json').version
const archive=path.resolve(process.argv[2]||path.join(root,`release/KAMUCL-${version}-source.zip`))
const directory=path.join(root,'out','source-audit-'+version+'-'+crypto.randomUUID())
const proofFile=path.join(root,'out',`source-audit-${version}.json`),sha=b=>crypto.createHash('sha256').update(b).digest('hex')
const proof={version,archive,directory,verified:false,commands:[]}
const save=()=>fs.writeFileSync(proofFile,JSON.stringify(proof,null,2)+'\n')
function run(command,args){
 const env={...process.env},log=path.join(root,'out',`source-audit-${version}-${proof.commands.length}.log`)
 if(!env.JAVA_HOME&&process.platform==='win32'&&fs.existsSync('C:/Program Files/Java/jdk-17/bin/javac.exe'))env.JAVA_HOME='C:/Program Files/Java/jdk-17'
 // Only fixed npm/npx verification commands use Windows' command shim.
 const result=process.platform==='win32'&&['npm','npx'].includes(command)
  ?spawnSync(process.env.ComSpec||'cmd.exe',['/d','/s','/c',[command,...args].join(' ')],{cwd:directory,env,encoding:'utf8',maxBuffer:20*1024*1024})
  :spawnSync(command,args,{cwd:directory,env,encoding:'utf8',maxBuffer:20*1024*1024})
 fs.writeFileSync(log,(result.stdout||'')+(result.stderr||''));proof.commands.push({command:[command,...args],exitCode:result.status,error:result.error?.message,log});save()
 console.log([command,...args].join(' ')+' => '+result.status)
 if(result.error||result.status!==0)throw Error('Clean source check failed; see '+log)
}
try{
 const zip=new Zip(archive),entries=zip.getEntries().filter(e=>!e.isDirectory),names=entries.map(e=>e.entryName)
 const manifest=JSON.parse(zip.readAsText('SOURCE-MANIFEST.json'))
 if(manifest.version!==version||!Array.isArray(manifest.files)||new Set(names).size!==names.length)throw Error('Invalid or duplicate source manifest')
 const listed=new Set(manifest.files.map(e=>e.path))
 if(listed.size!==manifest.files.length||names.length!==listed.size+1||names.some(n=>n!=='SOURCE-MANIFEST.json'&&!listed.has(n)))throw Error('Unexpected source members')
 const forbiddenDirs=new Set(['.git','node_modules','out','release','.cache','.ssh','素材'])
 const forbiddenNames=new Set(['pelican-bicycle.html','.git-credentials','.netrc','accounts.json','settings.json','credentials.json','token.json','secrets.json','id_rsa','id_ed25519'])
 const secrets=[/-----BEGIN [A-Z ]*PRIVATE KEY-----/,/\bsk-[A-Za-z0-9_-]{20,}\b/,/\bgh[pousr]_[A-Za-z0-9]{20,}\b/,/\bAKIA[0-9A-Z]{16}\b/]
 for(const item of manifest.files){
  const parts=typeof item.path==='string'?item.path.split('/'):[],name=parts.at(-1)||'',ext=path.extname(name).toLowerCase(),entry=zip.getEntry(item.path)
  if(!parts.length||item.path.includes('\\')||item.path.includes('\0')||item.path.startsWith('/')||parts.some(p=>!p||p==='.'||p==='..')||parts[0].includes(':'))throw Error('Unsafe source path')
  if(parts.slice(0,-1).some(p=>forbiddenDirs.has(p.toLowerCase()))||forbiddenNames.has(name.toLowerCase())||name.startsWith('.env')&&!['.env.example','.env.sample','.env.template'].includes(name)||['.pem','.key','.keystore','.jks','.p12','.pfx'].includes(ext))throw Error('Forbidden source file: '+item.path)
  const bytes=zip.readFile(item.path)
  if(!entry||((entry.attr>>>16)&0o170000)===0o120000||!bytes||bytes.length!==item.size||sha(bytes)!==item.sha256)throw Error('Source checksum or member type mismatch: '+item.path)
  if(['','.ts','.js','.cjs','.mjs','.json','.md','.java','.vue','.py','.yml','.yaml','.txt','.sh'].includes(ext)&&bytes.length<2000000&&secrets.some(pattern=>pattern.test(bytes.toString('utf8'))))throw Error('Potential secret: '+item.path)
 }
 const tracked=execFileSync('git',['ls-files','-z'],{cwd:root,encoding:'utf8'}).split('\0').filter(Boolean)
 if(tracked.length!==listed.size||tracked.some(n=>!listed.has(n)))throw Error('Source archive does not match tracked build inputs')
 if(execFileSync('git',['diff','--name-only','-z','HEAD','--'],{cwd:root,encoding:'utf8'}))throw Error('Commit tracked source before auditing delivery')
 for(const item of manifest.files)if(sha(fs.readFileSync(path.join(root,item.path)))!==item.sha256)throw Error('Archive differs from the committed worktree: '+item.path)
 Object.assign(proof,{archiveSHA256:sha(fs.readFileSync(archive)),commit:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),files:listed.size,membershipAndHashes:true})
 fs.mkdirSync(directory,{recursive:true});zip.extractAllTo(directory,false);save()
 run('npm',['ci']);run('node',['scripts/build-bridge.cjs']);run('npx',['tsc','--noEmit']);run('npm',['run','build']);run('node',['scripts/check-licenses.cjs'])
 for(const item of manifest.files)if(sha(fs.readFileSync(path.join(directory,item.path)))!==item.sha256)throw Error('Build modified source: '+item.path)
 Object.assign(proof,{verified:true,sourceUnchanged:true,recordedAt:new Date().toISOString()});save();console.log(JSON.stringify({proofFile,verified:true,files:proof.files,archiveSHA256:proof.archiveSHA256}))
}catch(error){proof.error=error.message;try{save()}catch{};console.error(error.message);process.exitCode=1}
