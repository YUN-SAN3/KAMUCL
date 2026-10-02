// SPDX-License-Identifier: MIT
// KAMUCL local settings; atomic replacement preserves the last valid file on failure.
import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { app } from 'electron'
import { DEFAULT_SERVER_URL } from './api'
export interface VoxlinkSettings { allowRelay: boolean; theme: string; uploadDiagnostics?: boolean }
export const defaultSettings = (): VoxlinkSettings => ({ allowRelay: true, theme: 'light', uploadDiagnostics: false })
export const defaultSettingsPath = () => path.join(app.getPath('userData'),'voxlink-settings.json')
export function loadSettings(file = defaultSettingsPath()): VoxlinkSettings { try { const value = JSON.parse(fs.readFileSync(file,'utf8')); return { uploadDiagnostics: value.uploadDiagnostics === true, allowRelay: typeof value.allowRelay === 'boolean' ? value.allowRelay : true, theme: typeof value.theme === 'string' && value.theme ? value.theme : 'light' } } catch { return defaultSettings() } }
export function saveSettings(value: VoxlinkSettings, file = defaultSettingsPath()): void { fs.mkdirSync(path.dirname(file),{recursive:true}); const temporary = `${file}.${randomUUID()}.tmp`; try { fs.writeFileSync(temporary,JSON.stringify({allowRelay:value.allowRelay,theme:value.theme,uploadDiagnostics:value.uploadDiagnostics===true})); fs.renameSync(temporary,file) } finally { fs.rmSync(temporary,{force:true}) } }
export const getServerURL = () => DEFAULT_SERVER_URL
