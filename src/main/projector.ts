import { join } from 'node:path'
import {
  app,
  BrowserWindow,
  desktopCapturer,
  ipcMain,
  screen,
  session,
  shell,
  systemPreferences,
  type IpcMainEvent,
  type IpcMainInvokeEvent
} from 'electron'
import { IPC } from '../shared/api'
import { PET_WINDOW, type Rect } from '../shared/layout'
import { parseCaptureWindowId } from '../shared/lens-control'
import {
  isBrowserLike,
  placeProjector,
  PROJECTOR_PILL,
  PROJECTOR_SIZES,
  projectorBounds,
  type ProjectorSize,
  type ProjectorSource
} from '../shared/projector'
import { logDiag } from './diagnostics'
import { lensOpenOriginal } from './lens-control'
import { isPetVisible, petOriginPoint } from './pet-window'
import { hardenWindow } from './security-window'
import { winFocusWindow } from './win-keys'

/**
 * “Project video”: a floating live mirror of one window the owner chose, above MIKO.
 * Capture goes through getDisplayMedia, answered here with exactly the selected window —
 * never another source, never audio (the original keeps playing its own sound once).
 * Closing the window stops the capture and destroys the renderer.
 */

let win: BrowserWindow | null = null
let selectedId: string | null = null
let pinned = true
let collapsed = false
let expanded: Rect | null = null
let aspect = 16 / 9
/** Measured height of the controls (they can wrap) plus notes, outside the video. */
let chrome = 44
let size: ProjectorSize = 'medium'
let handlerInstalled = false

const PARTITION = 'miko-projector'

function petRect(): Rect {
  const o = petOriginPoint()
  return { x: o.x, y: o.y, width: PET_WINDOW.width, height: PET_WINDOW.height }
}

function workArea(): Rect {
  const pet = petRect()
  return screen.getDisplayNearestPoint({ x: pet.x + pet.width / 2, y: pet.y + pet.height / 2 }).workArea
}

function layout(): Rect {
  const wanted = projectorBounds(PROJECTOR_SIZES[size], aspect, chrome)
  return placeProjector(wanted, isPetVisible() ? petRect() : { ...petRect(), y: workArea().y + workArea().height }, workArea())
}

function screenPermission(): string {
  if (process.platform !== 'darwin') return 'granted'
  try {
    return systemPreferences.getMediaAccessStatus('screen')
  } catch {
    return 'unknown'
  }
}

/** Shareable windows, browsers first. MIKO's own windows are never offered. */
export async function listProjectorSources(): Promise<{ ok: boolean; reason: string; permission: string; sources: ProjectorSource[] }> {
  const permission = screenPermission()
  try {
    const found = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: 320, height: 180 }, fetchWindowIcons: false })
    const sources: ProjectorSource[] = found
      .filter((s) => s.id.startsWith('window:'))
      // MIKO's own windows, by their exact titles (a browser tab that merely mentions MIKO stays listed).
      .filter((s) => !/^(?:MIKO|MIKO Lens|MIKO switcher|MIKO toy|MIKO projector|MIKO tree|Electron)$/.test((s.name || '').trim()))
      .map((s) => ({
        id: s.id,
        name: (s.name || 'Untitled window').slice(0, 120),
        previewUrl: s.thumbnail.isEmpty() ? '' : s.thumbnail.toDataURL(),
        browser: isBrowserLike(s.name || '')
      }))
      .sort((a, b) => Number(b.browser) - Number(a.browser) || a.name.localeCompare(b.name))
    if (!sources.length && permission === 'denied') {
      return {
        ok: false,
        reason:
          'macOS hasn’t allowed MIKO to see other windows. Turn MIKO on in System Settings → Privacy & Security → Screen & System Audio Recording, then quit and reopen MIKO.',
        permission,
        sources: []
      }
    }
    return { ok: true, reason: sources.length ? '' : 'No windows can be shared right now. Open a video in your browser, then Refresh.', permission, sources }
  } catch (error) {
    logDiag('projector', 'list sources failed', { error: String(error).slice(0, 160) })
    return { ok: false, reason: 'Couldn’t list windows to project.', permission, sources: [] }
  }
}

function installCaptureHandler(): void {
  if (handlerInstalled) return
  handlerInstalled = true
  const ses = session.fromPartition(PARTITION)
  ses.setPermissionRequestHandler((contents, permission, callback) => {
    // Only the projector page, only screen capture.
    callback(Boolean(win && !win.isDestroyed() && contents.id === win.webContents.id && (permission === 'media' || permission === 'display-capture')))
  })
  ses.setDisplayMediaRequestHandler(
    (request, callback) => {
      void (async () => {
        const wanted = selectedId
        const fromProjector = win && !win.isDestroyed() && request.frame?.processId === win.webContents.getProcessId()
        if (!wanted || !fromProjector) {
          callback({})
          return
        }
        try {
          const sources = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: 1, height: 1 } })
          const match = sources.find((s) => s.id === wanted)
          // The chosen window is gone: refuse rather than silently projecting something else.
          if (!match) {
            logDiag('projector', 'selected source gone')
            callback({})
            return
          }
          callback({ video: match })
        } catch (error) {
          logDiag('projector', 'capture handler failed', { error: String(error).slice(0, 160) })
          callback({})
        }
      })()
    },
    { useSystemPicker: false }
  )
}

export function openProjector(): void {
  if (win && !win.isDestroyed()) {
    win.showInactive()
    return
  }
  installCaptureHandler()
  collapsed = false
  selectedId = null
  aspect = 16 / 9
  const bounds = layout()
  const created = new BrowserWindow({
    ...bounds,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    resizable: true,
    minWidth: 260,
    minHeight: 48,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    title: 'MIKO projector',
    webPreferences: {
      preload: join(__dirname, '../preload/projector.js'),
      partition: PARTITION,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
      backgroundThrottling: false,
      devTools: !app.isPackaged
    }
  })
  win = created
  pinned = true
  created.setAlwaysOnTop(true, 'floating')
  if (process.platform === 'darwin') created.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  created.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  created.webContents.on('will-navigate', (event) => event.preventDefault())
  hardenWindow(created)
  created.on('closed', () => {
    if (win === created) win = null
    selectedId = null
    logDiag('projector', 'closed (capture stopped)')
  })
  created.once('ready-to-show', () => created.showInactive())
  const devServer = !app.isPackaged ? process.env['ELECTRON_RENDERER_URL'] : undefined
  if (devServer) void created.loadURL(`${devServer}/projector.html`)
  else void created.loadFile(join(__dirname, '../renderer/projector.html'))
  logDiag('projector', 'opened')
}

export function closeProjector(): void {
  selectedId = null
  if (win && !win.isDestroyed()) win.destroy()
  win = null
}

function trusted(event: IpcMainEvent | IpcMainInvokeEvent): boolean {
  return win !== null && !win.isDestroyed() && event.sender.id === win.webContents.id
}

function applyBounds(): void {
  if (!win || win.isDestroyed()) return
  if (collapsed) {
    const pet = petRect()
    const work = workArea()
    const b = placeProjector(PROJECTOR_PILL, pet, work)
    win.setAspectRatio(0)
    win.setBounds(b, false)
    return
  }
  const next = expanded ?? layout()
  win.setAspectRatio(0)
  win.setBounds(next, false)
}

export function registerProjectorIpc(): void {
  ipcMain.handle(IPC.projectorSources, (event) => (trusted(event) ? listProjectorSources() : { ok: false, reason: 'Not allowed.', permission: '', sources: [] }))
  ipcMain.handle(IPC.projectorSelect, (event, id: unknown) => {
    if (!trusted(event) || typeof id !== 'string' || !id.startsWith('window:')) return false
    selectedId = id
    logDiag('projector', 'source selected')
    return true
  })
  ipcMain.on(IPC.projectorAspect, (event, value: unknown, extra: unknown) => {
    if (!trusted(event) || typeof value !== 'number' || !Number.isFinite(value) || value <= 0.2 || value >= 5) return
    const nextChrome = typeof extra === 'number' && Number.isFinite(extra) ? Math.round(Math.max(44, Math.min(200, extra))) : chrome
    if ((Math.abs(value - aspect) < 0.01 && Math.abs(nextChrome - chrome) < 2) || collapsed) return
    aspect = value
    chrome = nextChrome
    expanded = layout()
    applyBounds()
  })
  ipcMain.on(IPC.projectorSize, (event, value: unknown) => {
    if (!trusted(event) || (value !== 'small' && value !== 'medium' && value !== 'large')) return
    size = value
    collapsed = false
    expanded = layout()
    applyBounds()
  })
  ipcMain.handle(IPC.projectorCollapse, (event, value: unknown) => {
    if (!trusted(event) || typeof value !== 'boolean' || !win) return collapsed
    if (value && !collapsed) expanded = win.getBounds()
    collapsed = value
    applyBounds()
    return collapsed
  })
  ipcMain.handle(IPC.projectorPin, (event, value: unknown) => {
    if (!trusted(event) || typeof value !== 'boolean' || !win) return pinned
    pinned = value
    win.setAlwaysOnTop(pinned, 'floating')
    return pinned
  })
  ipcMain.handle(IPC.projectorOpenOriginal, async (event) => {
    if (!trusted(event) || !selectedId) return { ok: false, reason: 'No window is being projected.' }
    if (process.platform === 'darwin') return lensOpenOriginal(selectedId)
    if (process.platform === 'win32') {
      const hwnd = parseCaptureWindowId(selectedId)
      if (!hwnd) return { ok: false, reason: 'Couldn’t find the original window.' }
      const ok = await winFocusWindow(hwnd)
      return { ok, reason: ok ? 'Brought the original window forward.' : 'Windows didn’t bring the original window forward.' }
    }
    return { ok: false, reason: 'Open original isn’t available here.' }
  })
  ipcMain.handle(IPC.projectorPrivacy, async (event) => {
    if (!trusted(event) || process.platform !== 'darwin') return false
    await shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture').catch(() => undefined)
    return true
  })
  ipcMain.on(IPC.projectorClose, (event) => {
    if (trusted(event)) closeProjector()
  })
}
