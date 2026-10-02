import { app, ipcMain } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import type { CommunityFile, InstallOptions, LoaderName } from '../../shared/types'
import { favoriteKey, linkFavoriteRecords, removeFavoriteRecords, type ModFavorite } from '../../shared/modFavorites'
import { communityFiles, communityModProject, withCommunitySignal } from './community'
import { modCatalog, identify } from './modManagement'
import { resolveResourceDirectory } from './resourceDirectory'
import { modIdentity, rememberModIdentity } from './modState'
import { validateModFile } from './modTransaction'
import { dependencyGraph, dependencyRepository } from './modInstallPlan'
import { compatibleRecordingMod, RECORDING_PROJECTS } from '../../shared/recordingMods'
const file = () => path.join(app.getPath('userData'),'mod-favorites.json')
export function modFavorites(): ModFavorite[] { try { const value=JSON.parse(fs.readFileSync(file(),'utf8')); if(!Array.isArray(value))throw new Error();return value.map(v=>({...v,key:favoriteKey(v)})) } catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return [];throw new Error('收藏记录读取失败，未覆盖原记录')} }
function write(list:ModFavorite[]) { fs.mkdirSync(path.dirname(file()),{recursive:true});fs.writeFileSync(file()+'.tmp',JSON.stringify(list));fs.renameSync(file()+'.tmp',file());return list }
export function setFavorite(value:ModFavorite,on:boolean) { const key=favoriteKey(value),hash=typeof value.sha1==='string'?value.sha1.toLowerCase():undefined,list=modFavorites().filter(f=>f.key!==key&&!(hash&&f.key==='sha1:'+hash));if(on)list.push({key,name:String(value.name||value.projectId||'本地模组').slice(0,200),source:value.source,projectId:value.projectId,sha1:hash,added:Date.now()});return write(list) }
export async function favoriteVersions(source:string,project:string,mc:string,loader:string):Promise<CommunityFile[]> { favoriteKey({source,projectId:project});if(!['fabric','quilt','forge','neoforge'].includes(loader)||typeof mc!=='string'||mc.length>100)throw new Error('请选择游戏与加载器');return (await communityFiles(source as 'modrinth'|'curseforge',project,{kind:'mod',mcVersion:mc,loader:loader as LoaderName})).filter(f=>f.projectId===project&&compatibleRecordingMod(f,mc,loader)) }
export async function prepareInstallMods(mc:string,opts:InstallOptions,signal?:AbortSignal):Promise<CommunityFile[]> {
 return withCommunitySignal(signal,async()=>{
  signal?.throwIfAborted()
  const selections=[...(opts.favoriteMods||[])];if(selections.length>100)throw new Error('收藏模组过多')
  if(opts.recordingMod)selections.push({source:'modrinth',projectId:RECORDING_PROJECTS[opts.recordingMod.kind],fileId:opts.recordingMod.fileId})
  if(!selections.length)return []
  if(!opts.loader)throw new Error('收藏模组需要模组加载器')
  const roots:CommunityFile[]=[]
  for(const selected of selections){const files=await favoriteVersions(selected.source,selected.projectId,mc,opts.loader);const exact=files.find(f=>f.fileId===selected.fileId);if(!exact)throw new Error('所选模组版本已不可用或不兼容：'+selected.projectId);roots.push(exact)}
  if(opts.loader==='fabric'&&opts.fabricApi){const api=(await favoriteVersions('modrinth','P7dR8mSH',mc,opts.loader)).find(f=>f.version===opts.fabricApi);if(!api)throw new Error('Fabric API 已不可用');roots.push(api)}
  const target={mcVersion:mc,loader:opts.loader} as Parameters<typeof dependencyGraph>[1]
  const graph=await dependencyGraph(roots,target,dependencyRepository)
  for(const f of graph)if(!compatibleRecordingMod(f,mc,opts.loader))throw new Error('模组缺少可校验下载文件：'+f.fileName)
  const names=new Map<string,string>();for(const f of graph){const old=names.get(f.fileName);if(old&&old!==f.sha1)throw new Error('模组文件名冲突：'+f.fileName);names.set(f.fileName,f.sha1!)}
  signal?.throwIfAborted();return graph
 })
}
export function registerModFavoritesIpc(){
  ipcMain.handle('mods:favorites',()=>modFavorites())
  ipcMain.handle('mods:favorite',(_e,value,on)=>setFavorite(value,on===true))
  ipcMain.handle('mods:favoriteRemove',(_e,keys)=>write(removeFavoriteRecords(modFavorites(),keys)))
  ipcMain.handle('mods:favoriteLink',async(_e,key,source,projectId)=>{
    if(typeof key!=='string'||!modFavorites().some(f=>f.key===key))throw new Error('该收藏已被取消，请刷新列表')
    const project=await communityModProject(source,projectId)
    return write(linkFavoriteRecords(modFavorites(),key,project))
  })
  ipcMain.handle('mods:favoriteVersions',(_e,s,p,mc,l)=>favoriteVersions(s,p,mc,l))
  ipcMain.handle('mods:favoriteLocal',async(_e,version,folder,name,on,link)=>{
    const dir=await resolveResourceDirectory(folder,version,'mods'),mods=await modCatalog(version,folder),mod=mods.find(m=>m.fileName===name)
    if(!mod?.sha1)throw new Error('无法校验该模组');await validateModFile(dir,name,mod.sha1)
    if(link){const key=favoriteKey(link);if(key.startsWith('sha1:'))throw new Error('请选择来源平台和项目');await communityFiles(link.source,link.projectId,{kind:'mod'});rememberModIdentity(dir,mod.sha1,key)}
    else try{await identify(dir,[mod])}catch{/* Offline local favorites still work. */}
    const identity=modIdentity(dir,mod.sha1),[source,projectId]=identity.split(':')
    const value={name:mod.name,sha1:mod.sha1,...(source==='sha1'?{}:{source,projectId})} as ModFavorite
    const unknown='sha1:'+mod.sha1;const list=modFavorites();if(link&&list.some(f=>f.key===unknown))write(list.filter(f=>f.key!==unknown))
    return setFavorite(value,on===true)
  })
}
