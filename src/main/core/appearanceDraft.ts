import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import type { Settings } from '../../shared/types'
import { cleanDesign } from '../../shared/visualDesign'
import { getSettings, saveSettings } from './settings'
const keys = ['theme','custom','background','launchThumbnail','homeLayout','visualDesign'] as const
export type Appearance = Pick<Settings, typeof keys[number]>
export function appearanceOnly(input: Partial<Settings>): Appearance {
  const base=getSettings(), result={} as Appearance
  for(const k of keys) (result as any)[k]=input[k]??base[k]
  result.visualDesign=cleanDesign(result.visualDesign)
  return result
}
const file=()=>path.join(app.getPath('userData'),'appearance-draft.json')
export function readAppearanceDraft(): Appearance|null {
  try{return appearanceOnly(JSON.parse(fs.readFileSync(file(),'utf8')))}catch{return null}
}
export function saveAppearanceDraft(input: Partial<Settings>): Appearance {
  const data=appearanceOnly(input),f=file();fs.mkdirSync(path.dirname(f),{recursive:true})
  fs.writeFileSync(f+'.tmp',JSON.stringify(data));fs.renameSync(f+'.tmp',f);return data
}
export function discardAppearanceDraft(){fs.rmSync(file(),{force:true})}
export function applyAppearanceDraft(input: Partial<Settings>): Settings {
  const data=saveAppearanceDraft(input)
  // Only appearance fields are committed; account/game changes made since editing began survive.
  const result=saveSettings(data);discardAppearanceDraft();return result
}
