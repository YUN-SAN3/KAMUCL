import { contextBridge, ipcRenderer } from 'electron'
import type { BootState } from '../shared/startup'
contextBridge.exposeInMainWorld('kamuclSplash', {
  ready: () => ipcRenderer.send('boot:splash-ready'),
  assembled: () => ipcRenderer.send('boot:assembled'),
  finished: () => ipcRenderer.send('boot:finished'),
  failed: (message: string) => ipcRenderer.send('boot:splash-failed', message),
  onPointer: (callback: (point: { x: number; y: number }) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, point: { x: number; y: number }) => callback(point)
    ipcRenderer.on('boot:pointer', listener)
    return () => ipcRenderer.removeListener('boot:pointer', listener)
  },
  onState: (callback: (state: BootState) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, state: BootState) => callback(state)
    ipcRenderer.on('boot:state', listener)
    return () => ipcRenderer.removeListener('boot:state', listener)
  },
  onReveal: (callback: () => void) => {
    ipcRenderer.on('boot:reveal', callback)
    return () => ipcRenderer.removeListener('boot:reveal', callback)
  }
})
