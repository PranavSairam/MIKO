import { app, BrowserWindow } from 'electron'
import { join } from 'path'

let previewWindow: BrowserWindow | null = null

export function createLivingPreview(): void {
  if (previewWindow && !previewWindow.isDestroyed()) {
    if (previewWindow.isMinimized()) previewWindow.restore()
    previewWindow.focus()
    return
  }

  const win = new BrowserWindow({
    width: 1080,
    height: 900,
    minWidth: 720,
    minHeight: 640,
    show: false,
    title: 'MIKO living preview',
    backgroundColor: '#e7e1da',
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      spellcheck: false
    }
  })

  previewWindow = win
  win.on('closed', () => {
    if (previewWindow === win) previewWindow = null
  })
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (event, url) => {
    const devServer = !app.isPackaged ? process.env['ELECTRON_RENDERER_URL'] : undefined
    if (devServer && sameOrigin(url, devServer)) return
    event.preventDefault()
  })
  win.once('ready-to-show', () => {
    win.show()
  })

  const devServer = !app.isPackaged ? process.env['ELECTRON_RENDERER_URL'] : undefined
  if (devServer) {
    void win.loadURL(`${devServer}/living.html`)
  } else {
    void win.loadFile(join(__dirname, '../renderer/living.html'))
  }
}

function sameOrigin(url: string, base: string): boolean {
  try {
    return new URL(url).origin === new URL(base).origin
  } catch {
    return false
  }
}
