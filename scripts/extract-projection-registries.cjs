/** Freeze exact minecraft-data block state schemas, with source package version, no runtime download. */
const fs=require('fs'),data=require('minecraft-data');
const versions=data.versions.pc.filter(v=>v.releaseType==='release'&&/^(1\.20(?:\.\d+)?|1\.21(?:\.\d+)?|26\.\d+(?:\.\d+)?)$/.test(v.minecraftVersion));
const schemas={},registry={},supported=[];
for(const v of versions){const m=data(v.minecraftVersion);supported.push({version:v.minecraftVersion,dataVersion:v.dataVersion,supported:!!m?.blocksArray});if(!m?.blocksArray)continue;const blocks=Object.fromEntries(m.blocksArray.map(b=>[b.name,{states:b.states||[]}]));const fingerprint=require('crypto').createHash('sha256').update(JSON.stringify(blocks)).digest('hex');if(!schemas[fingerprint])schemas[fingerprint]=blocks;registry[v.minecraftVersion]=fingerprint;}
const official=require('../src/main/core/projectionOfficialSchemas.json');
for(const record of official){const fingerprint=require('crypto').createHash('sha256').update(JSON.stringify(record.blocks)).digest('hex');schemas[fingerprint]=record.blocks;registry[record.version]=fingerprint;const old=supported.find(v=>v.version===record.version);if(old&&old.dataVersion!==record.dataVersion)throw Error('DataVersion mismatch: '+record.version);if(old)old.supported=true;else supported.push({version:record.version,dataVersion:record.dataVersion,supported:true});}
const result={source:'PrismarineJS/minecraft-data and Mojang server data generator',packageVersion:require('minecraft-data/package.json').version,officialSources:official.map(({blocks,...source})=>source),supported,schemas,registry,legacy:data.legacy.pc.blocks};
fs.writeFileSync('src/main/core/projectionRegistries.json',JSON.stringify(result));
for(const file of ['src/main/core/projectionFormats.ts','src/main/core/projectionConversion.ts']){let s=fs.readFileSync(file,'utf8');s=s.replace("import minecraftData from 'minecraft-data'","import { minecraftData } from './projectionRegistry'");fs.writeFileSync(file,s);}
console.log('Registry snapshot:',supported.filter(v=>v.supported).map(v=>v.version).join(', '));
