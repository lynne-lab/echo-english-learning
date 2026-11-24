export interface AppInfo {
  version: string
  dataDir: string
  sidecarUrl: string
  platform: string
}

export interface EchoApi {
  selectMediaFile(): Promise<string | null>
  selectDictionaryFile(): Promise<string | null>
  getPathForFile(file: File): string
  getAppInfo(): Promise<AppInfo>
  openDataDir(): Promise<void>
  openSidecarLog(): Promise<void>
  getSidecarUrl(): Promise<string>
  loadNotes(): Promise<string>
  saveNotes(text: string): Promise<{ ok: boolean }>
  exportNotesMarkdown(text: string): Promise<string | null>
  exportNotesPdf(payload: { text: string; html: string }): Promise<string | null>
}

declare global {
  interface Window {
    api: EchoApi
  }
}
