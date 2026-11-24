import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { EchoApi } from './api-types'

const api: EchoApi = {
  selectMediaFile: () => ipcRenderer.invoke('dialog:selectMedia'),
  selectDictionaryFile: () => ipcRenderer.invoke('dialog:selectDictionary'),
  getPathForFile: (file: File) => webUtils.getPathForFile(file),
  getAppInfo: () => ipcRenderer.invoke('app:info'),
  openDataDir: () => ipcRenderer.invoke('shell:openDataDir'),
  openSidecarLog: () => ipcRenderer.invoke('shell:openSidecarLog'),
  getSidecarUrl: () => ipcRenderer.invoke('sidecar:url'),
  loadNotes: () => ipcRenderer.invoke('notes:load'),
  saveNotes: (text: string) => ipcRenderer.invoke('notes:save', text),
  exportNotesMarkdown: (text: string) =>
    ipcRenderer.invoke('notes:exportMarkdown', text),
  exportNotesPdf: (payload: { text: string; html: string }) =>
    ipcRenderer.invoke('notes:exportPdf', payload)
}

contextBridge.exposeInMainWorld('api', api)
