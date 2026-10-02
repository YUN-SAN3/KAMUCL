import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
interface DirectoryState { aliases:Record<string,string>; locks:Record<string,boolean> }
export function exportModState(dir:string){return read(dir)}
export function importModState(dir:string,value:unknown){const s=value as DirectoryState;if(!s||typeof s!=='object'||!s.aliases||!s.locks)throw new Error('模组状态记录无效');write(dir,{aliases:{...s.aliases},locks:{...s.locks}})}
function stateFile(dir:string){const real=fs.existsSync(dir)?fs.realpathSync(dir):path.resolve(dir);return path.join(app.getPath('userData'),'mod-state',crypto.createHash('sha256').update(process.platform==='win32'?real.toLowerCase():real).digest('hex')+'.json')}
function read(dir:string):DirectoryState{try{const v=JSON.parse(fs.readFileSync(stateFile(dir),'utf8'));return {aliases:v.aliases||{},locks:v.locks||{}}}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw new Error('模组锁定记录无法读取，请先恢复记录后重试');return {aliases:{},locks:{}}}}
function write(dir:string,s:DirectoryState){const f=stateFile(dir);fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f+'.tmp',JSON.stringify(s));fs.renameSync(f+'.tmp',f)}
export function modIdentity(dir:string,sha1:string){return read(dir).aliases[sha1]||'sha1:'+sha1}
export function isModLocked(dir:string,sha1:string){const s=read(dir);return s.locks[s.aliases[sha1]||'sha1:'+sha1]===true||s.locks['sha1:'+sha1]===true}
export function setModLocked(dir:string,sha1:string,locked:boolean){const s=read(dir);const identity=s.aliases[sha1];s.locks[identity||'sha1:'+sha1]=locked;s.locks['sha1:'+sha1]=locked;if(identity)for(const [hash,id] of Object.entries(s.aliases))if(id===identity)s.locks['sha1:'+hash]=locked;write(dir,s)}
export function rememberModIdentity(dir:string,sha1:string,identity:string){if(!/^(modrinth|curseforge):[a-zA-Z0-9_-]+$/.test(identity)||!/^[a-f0-9]{40}$/i.test(sha1))return;const s=read(dir);if(s.aliases[sha1]===identity)return;if(s.locks['sha1:'+sha1])s.locks[identity]=true;s.aliases[sha1]=identity;write(dir,s)}
export function transferModLock(dir:string,oldSha:string,newSha:string){const identity=modIdentity(dir,oldSha),locked=isModLocked(dir,oldSha);if(!identity.startsWith('sha1:'))rememberModIdentity(dir,newSha,identity);if(locked)setModLocked(dir,newSha,true)}
