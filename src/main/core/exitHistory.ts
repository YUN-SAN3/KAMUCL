import { app } from 'electron'
import path from 'node:path'
import { ExitJournal } from './exitJournal'
import { launcherLogWarn } from './launcherLog'
let journal: ExitJournal | undefined
export function exitHistory() { return journal ??= new ExitJournal(path.join(app.getPath('userData'), 'exit-history.json')) }
export function rememberExit<T>(action: () => T): T | undefined {
  try { return action() } catch (error) { launcherLogWarn('exit-history', '保存退出记录失败', error); return undefined }
}
