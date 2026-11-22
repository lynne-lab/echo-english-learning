import { app, BrowserWindow, dialog, ipcMain, session, shell } from 'electron'
import { join } from 'node:path'
import {
  getAppInfo,
  getDataDir,
  getSidecarUrl,
  startSidecar,
  stopSidecar
} from './sidecar'

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1080,
    minHeight: 700,
    show: false,
    backgroundColor: '#0a0d12',
    autoHideMenuBar: true,
    title: 'Echo — 英语精听工作台',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show()
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    void mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function registerIpc(): void {
  ipcMain.handle('dialog:selectMedia', async () => {
    const result = await dialog.showOpenDialog({
      title: '选择音频或视频文件',
      properties: ['openFile'],
      filters: [
        {
          name: '音频 / 视频',
          extensions: [
            'mp3',
            'm4a',
            'wav',
            'flac',
            'ogg',
            'opus',
            'aac',
            'wma',
            'mp4',
            'm4v',
            'mkv',
            'webm',
            'mov',
            'avi',
            'flv',
            'ts'
          ]
        },
        { name: '所有文件', extensions: ['*'] }
      ]
    })
    return result.canceled ? null : result.filePaths[0]
  })

  ipcMain.handle('dialog:selectDictionary', async () => {
    const result = await dialog.showOpenDialog({
      title: '选择 ECDICT 数据库 (ecdict.db)',
      properties: ['openFile'],
      filters: [
        { name: 'SQLite 数据库', extensions: ['db', 'sqlite', 'sqlite3'] },
        { name: '所有文件', extensions: ['*'] }
      ]
    })
    return result.canceled ? null : result.filePaths[0]
  })

  ipcMain.handle('app:info', () => getAppInfo())
  ipcMain.handle('shell:openDataDir', async () => {
    const dir = getDataDir()
    return shell.openPath(dir)
  })
  ipcMain.handle('shell:openSidecarLog', async () => {
    return shell.openPath(join(getDataDir(), 'logs'))
  })
  ipcMain.handle('sidecar:url', () => getSidecarUrl())
}

app.whenReady().then(async () => {
  session.defaultSession.setPermissionRequestHandler(
    (_webContents, permission, callback, details) => {
      if (permission === 'media') {
        const mediaTypes =
          (details as { mediaTypes?: string[] }).mediaTypes ?? []
        // 只放行麦克风，不放行摄像头。
        callback(mediaTypes.length === 0 || mediaTypes.includes('audio'))
        return
      }
      callback(false)
    }
  )
  session.defaultSession.setPermissionCheckHandler(
    (_webContents, permission) => permission === 'media'
  )

  registerIpc()
  await startSidecar()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  stopSidecar()
})
