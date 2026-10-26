const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const prior=JSON.parse(fs.readFileSync('out/production-inputs115-final-prebuild.json'));
const files=new Set(prior.files.map(r=>r.file));
function walk(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true})){const p=dir+'/'+e.name;if(e.isDirectory())walk(p);else files.add(p)}}walk('src');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const rows=[...files].sort().map(file=>{const b=fs.readFileSync(file);return{file,bytes:b.length,sha256:sha(b)}});
const target='out/production-inputs116-prebuild.json';
if(process.argv[2]==='verify'){const original=JSON.parse(fs.readFileSync(target));assert.deepEqual(rows,original.files);console.log(JSON.stringify({unchanged:true,files:rows.length}));}
else {assert(!fs.existsSync(target));fs.writeFileSync(target,JSON.stringify({at:new Date().toISOString(),node:process.version,electron:require('electron/package.json').version,qualification:'Working byte inventory frozen before final product build; subsequent QA and documents bound separately',files:rows},null,2));console.log(JSON.stringify({files:rows.length,target}));}
