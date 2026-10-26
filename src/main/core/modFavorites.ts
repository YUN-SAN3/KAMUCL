import { app, ipcMain } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import type { CommunityFile, InstallOptions, LoaderName } from '../../shared/types'
import { favoriteKey, favoriteIconUrl, linkFavoriteRecords, removeFavoriteRecords, validateFavoriteInstallIntent, type ModFavorite, type FavoriteInstallResult, type FavoriteVersionResult } from '../../shared/modFavorites'
import { communityFiles, communityFavoriteCandidates, communityModProject, withCommunitySignal } from './community'
import { modCatalog, identify } from './modManagement'
import { resolveResourceDirectory } from './resourceDirectory'
import { modIdentity, rememberModIdentity } from './modState'
import { validateModFile } from './modTransaction'
import { dependencyGraph, dependencyRepository } from './modInstallPlan'
import { compatibleRecordingMod, RECORDING_PROJECTS } from '../../shared/recordingMods'
import { FavoriteVersionQueue } from './favoriteVersionQueue'
import { fileHash } from './fileHash'
const file = () => path.join(app.getPath('userData'),'mod-favorites.json')
export function modFavorites(): ModFavorite[] { try { const value=JSON.parse(fs.readFileSync(file(),'utf8')); if(!Array.isArray(value))throw new Error();return value.map(v=>({...v,key:favoriteKey(v)})) } catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return [];throw new Error('收藏记录读取失败，未覆盖原记录')} }
function write(list:ModFavorite[]) { fs.mkdirSync(path.dirname(file()),{recursive:true});fs.writeFileSync(file()+'.tmp',JSON.stringify(list));fs.renameSync(file()+'.tmp',file());return list }
export function setFavorite(value:ModFavorite,on:boolean) { const key=favoriteKey(value),hash=typeof value.sha1==='string'?value.sha1.toLowerCase():undefined,list=modFavorites().filter(f=>f.key!==key&&!(hash&&f.key==='sha1:'+hash));if(on)list.push({key,name:String(value.name||value.projectId||'本地模组').slice(0,200),source:value.source,projectId:value.projectId,sha1:hash,iconUrl:favoriteIconUrl(value.iconUrl),added:Date.now()});return write(list) }
const versionQueries = new FavoriteVersionQueue<FavoriteVersionResult>(4)
export async function favoriteVersionResult(source:string,project:string,mc:string,loader:string,signal?:AbortSignal):Promise<FavoriteVersionResult> {
 favoriteKey({source,projectId:project})
 if(!['fabric','quilt','forge','neoforge'].includes(loader)||typeof mc!=='string'||!mc.trim()||mc.length>100)throw new Error('请选择游戏与加载器')
 mc=mc.trim()
 return versionQueries.request(JSON.stringify([source,project,mc,loader]),querySignal=>withCommunitySignal(querySignal,async()=>{
  const compatible=(await communityFavoriteCandidates(source as 'modrinth'|'curseforge',project,mc,loader as LoaderName)).filter(f=>f.projectId===project&&f.gameVersions.includes(mc)&&f.loaders.includes(loader))
  const files=compatible.filter(f=>compatibleRecordingMod(f,mc,loader))
  return {files,status:files.length?'available':compatible.length?'unreliable':'incompatible'}
 }),signal)
}
export async function favoriteVersions(source:string,project:string,mc:string,loader:string,signal?:AbortSignal):Promise<CommunityFile[]>{return(await favoriteVersionResult(source,project,mc,loader,signal)).files}
export async function prepareInstallMods(mc:string,opts:InstallOptions,signal?:AbortSignal):Promise<CommunityFile[]> {
 return withCommunitySignal(signal,async()=>{
  signal?.throwIfAborted()
  validateFavoriteInstallIntent(opts.favoriteMods??[],opts.favoriteInstallIntent)
  const selections=[...(opts.favoriteMods||[])];if(selections.length>100)throw new Error('收藏模组过多')
  if(opts.recordingMod)selections.push({source:'modrinth',projectId:RECORDING_PROJECTS[opts.recordingMod.kind],fileId:opts.recordingMod.fileId})
  if(!selections.length)return []
  if(!opts.loader)throw new Error('收藏模组需要模组加载器')
  const roots:CommunityFile[]=[]
  for(const selected of selections){const files=await favoriteVersions(selected.source,selected.projectId,mc,opts.loader,signal);const exact=files.find(f=>f.fileId===selected.fileId);if(!exact)throw new Error('所选模组版本已不可用或不兼容：'+selected.projectId);roots.push(exact)}
  if(opts.loader==='fabric'&&opts.fabricApi){const api=(await favoriteVersions('modrinth','P7dR8mSH',mc,opts.loader,signal)).find(f=>f.version===opts.fabricApi);if(!api)throw new Error('Fabric API 已不可用');roots.push(api)}
  const target={mcVersion:mc,loader:opts.loader} as Parameters<typeof dependencyGraph>[1]
  const graph=await dependencyGraph(roots,target,dependencyRepository)
  for(const f of graph)if(!compatibleRecordingMod(f,mc,opts.loader))throw new Error('模组缺少可校验下载文件：'+f.fileName)
  const names=new Map<string,string>();for(const f of graph){const old=names.get(f.fileName);if(old&&old!==f.sha1)throw new Error('模组文件名冲突：'+f.fileName);names.set(f.fileName,f.sha1!)}
  signal?.throwIfAborted();return graph
 })
}
/** Completion comes from files read back from the accepted instance, never from the preview query count. */
export async function favoriteInstallResult(opts:InstallOptions,files:CommunityFile[],modsDirectory:string,folder:string,instanceId:string,signal?:AbortSignal):Promise<FavoriteInstallResult|undefined>{
 if(!opts.favoriteInstallIntent&&!opts.favoriteMods?.length)return
 const intent=validateFavoriteInstallIntent(opts.favoriteMods??[],opts.favoriteInstallIntent)
 const verifiedFiles:FavoriteInstallResult['verifiedFiles']=[]
 for(const file of [...new Map(files.map(file=>[file.fileName,file])).values()]){
  signal?.throwIfAborted()
  const target=path.join(modsDirectory,file.fileName),info=await fs.promises.lstat(target)
  if(!info.isFile()||info.isSymbolicLink())throw new Error('收藏模组落盘校验失败：'+file.fileName)
  const sha1=await fileHash(target,'sha1',signal)
  if(sha1!==file.sha1?.toLowerCase())throw new Error('收藏模组落盘哈希不符：'+file.fileName)
  verifiedFiles.push({fileName:file.fileName,sha1,source:file.source,projectId:file.projectId})
 }
 for(const selected of opts.favoriteMods??[])if(!files.some(file=>file.source===selected.source&&file.projectId===selected.projectId&&file.fileId===selected.fileId))throw new Error('收藏模组未出现在实际安装结果中：'+selected.projectId)
 const selectedKeys=new Set((opts.favoriteMods??[]).map(f=>f.source+':'+f.fileId)),favoriteGraph=new Set<string>()
 const visit=(file:CommunityFile)=>{const key=file.source+':'+file.fileId;if(favoriteGraph.has(key))return;favoriteGraph.add(key);for(const dep of file.dependencies??[])if(dep.required){const next=files.find(candidate=>candidate.source===file.source&&(dep.fileId?candidate.fileId===dep.fileId:candidate.projectId===dep.projectId));if(next)visit(next)}}
 for(const root of files)if(selectedKeys.has(root.source+':'+root.fileId))visit(root)
 const dependencies=[...favoriteGraph].filter(key=>!selectedKeys.has(key)).length
 signal?.throwIfAborted()
 return {...intent,installed:intent.selected,dependencies,folder:fs.realpathSync.native(folder),instanceId,modsDirectory:fs.existsSync(modsDirectory)?fs.realpathSync.native(modsDirectory):path.resolve(modsDirectory),verifiedFiles}
}
export function registerModFavoritesIpc(){
 const subscriptions=new Map<string,AbortController>(),observed=new WeakSet<object>()
  ipcMain.handle('mods:favorites',()=>modFavorites())
  ipcMain.handle('mods:favorite',(_e,value,on)=>setFavorite(value,on===true))
  ipcMain.handle('mods:favoriteRemove',(_e,keys)=>write(removeFavoriteRecords(modFavorites(),keys)))
  ipcMain.handle('mods:favoriteLink',async(_e,key,source,projectId)=>{
    if(typeof key!=='string'||!modFavorites().some(f=>f.key===key))throw new Error('该收藏已被取消，请刷新列表')
    const project=await communityModProject(source,projectId)
    return write(linkFavoriteRecords(modFavorites(),key,project))
  })
  ipcMain.handle('mods:favoriteVersions',async(e,s,p,mc,l,ticket?:string)=>{
    if(ticket===undefined)return favoriteVersions(s,p,mc,l)
    if(typeof ticket!=='string'||!/^[a-zA-Z0-9_-]{1,100}$/.test(ticket))throw new Error('收藏查询订阅无效')
    const owner=e.sender,key=owner.id+':'+ticket
    if(subscriptions.has(key))throw new Error('收藏查询订阅重复')
    if(!observed.has(owner)){observed.add(owner);owner.once('destroyed',()=>{for(const [id,controller]of subscriptions)if(id.startsWith(owner.id+':'))controller.abort(new Error('收藏查询窗口已关闭'))})}
    const controller=new AbortController();subscriptions.set(key,controller)
    try{return await favoriteVersionResult(s,p,mc,l,controller.signal)}finally{if(subscriptions.get(key)===controller)subscriptions.delete(key)}
  })
  ipcMain.handle('mods:favoriteVersionsCancel',(e,ticket:string)=>{if(typeof ticket==='string')subscriptions.get(e.sender.id+':'+ticket)?.abort(new Error('收藏查询已取消'))})
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
