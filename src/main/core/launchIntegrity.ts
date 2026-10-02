import fs from 'node:fs'
import path from 'node:path'
import AdmZip from 'adm-zip'
import { verifyFile, downloadFile, type MirrorPref } from './download'

export interface LaunchArtifact { dest: string; url?: string; sha1?: string; size?: number }
// Only successful checks are reused, within this launcher process. Any changed
// inode, size, mtime, ctime or expected digest forces a full check again.
const verifiedArtifacts = new Map<string, { signature: string; expires: number }>()
async function artifactSignature(file: LaunchArtifact): Promise<string | null> {
  try {
    const stat = await fs.promises.lstat(file.dest, { bigint: true })
    if (!stat.isFile() || stat.isSymbolicLink()) return null
    return [stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs, file.sha1 ?? '', file.size ?? ''].join(':')
  } catch { return null }
}
export async function invalidLaunchArtifact(file: LaunchArtifact): Promise<string | null> {
  const key = path.resolve(file.dest), before = await artifactSignature(file)
  const cached = verifiedArtifacts.get(key)
  if (before && cached?.signature === before && cached.expires > Date.now()) return null
  verifiedArtifacts.delete(key)
  const reason = await verifyFile(file.dest, file)
  if (reason) return reason
  if (!file.sha1 && /\.jar$/i.test(file.dest)) {
    try { if (!new AdmZip(file.dest).test()) return 'JAR 内容校验失败' } catch { return 'JAR 格式损坏' }
  }
  if (before && before === await artifactSignature(file)) {
    if (verifiedArtifacts.size >= 8192) verifiedArtifacts.delete(verifiedArtifacts.keys().next().value!)
    verifiedArtifacts.set(key, { signature: before, expires: Date.now() + 5 * 60_000 })
    return null
  }
  return '文件在完整性校验期间发生变化，请重试'
}

/** Validate first; a readable path is not evidence of a complete download. */
export async function ensureLaunchArtifact(file: LaunchArtifact, mirror: MirrorPref, progress?: (done: number, total: number) => void, signal?: AbortSignal): Promise<boolean> {
  const reason = await invalidLaunchArtifact(file)
  if (!reason) return false
  if (!file.url) throw new Error(`${file.dest}：${reason}，缺少下载地址，请修复或重新安装加载器`)
  await fs.promises.mkdir(path.dirname(file.dest), {recursive:true})
  const stat=()=>fs.promises.lstat(file.dest).catch(e=>{if(e.code==='ENOENT')return null;throw e})
  const before=await stat()
  if(before&&(!before.isFile()||before.isSymbolicLink()))throw new Error('修复目标不是普通文件')
  const stage=await fs.promises.mkdtemp(path.join(path.dirname(file.dest),'.kamucl-repair-'))
  const temporary=path.join(stage,path.basename(file.dest)),old=path.join(stage,'original')
  let preserve=false
  try{
    await downloadFile(file.url, temporary, progress, file.sha1, mirror, signal, [], { size: file.size })
    const after=await invalidLaunchArtifact({...file,dest:temporary})
    if(after)throw new Error(`${file.dest}：修复后仍未通过完整性校验（${after}）`)
    signal?.throwIfAborted()
    const current=await stat()
    if(current&&(!current.isFile()||current.isSymbolicLink()))throw new Error('修复目标类型已变化')
    if(before?.size!==current?.size||before?.mtimeMs!==current?.mtimeMs)throw new Error('修复期间目标文件已变化，请重新检查')
    if(before)await fs.promises.rename(file.dest,old)
    try{await fs.promises.copyFile(temporary,file.dest,fs.constants.COPYFILE_EXCL)}catch(e){if(before){try{await fs.promises.rename(old,file.dest)}catch{preserve=true;throw new Error('修复未完成，原文件保留于 '+old)}}throw e}
  }finally{if(!preserve)await fs.promises.rm(stage,{recursive:true,force:true})}
  return true
}
