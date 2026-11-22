import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { EchoApi } from './api-types'

const api: EchoApi = {
  selectMediaFile: () => ipcRenderer.invoke('dialog:selectMedia'),
  selectDictionaryFile: () => ipcRenderer.invoke('dialog:selectDictionary'),
  getPathForFile: (file: File) => webUtils.getPathForFile(file),
  getAppInfo: () => ipcRenderer.invoke('app:info'),
  openDataDir: () => ipcRenderer.invoke('shell:openDataDir'),
  openSidecarLog: () => ipcRenderer.invoke('shell:openSidecarLog'),
  getSidecarUrl: () => ipcRenderer.invoke('sidecar:url')
}

contextBridge.exposeInMainWorld('api', api)
