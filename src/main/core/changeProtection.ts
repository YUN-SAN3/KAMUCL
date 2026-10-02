import { app } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import crypto from 'node:crypto'
import { BackupStore } from './backupStore'
import { exportModState } from './modState'
export function instanceBackups(directory:string):BackupStore {
  const real=fs.realpathSync(directory)
  const key=crypto.createHash('sha256').update(process.platform==='win32'?real.toLowerCase():real).digest('hex')
  return new BackupStore(path.join(app.getPath('userData'),'instance-backups',key))
}
export async function protectModChange(dir:string,names:string[],title:string,signal?:AbortSignal){
  const root=path.dirname(dir)
  return instanceBackups(root).create(root,[...new Set(names)].map(n=>'mods/'+n),title,true,{type:'protection',modState:exportModState(dir)},signal)
}
