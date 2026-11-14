import { join } from 'node:path'
import { app, BrowserWindow, ipcMain, screen, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron'
import { IPC } from '../shared/api'
import { PET_WINDOW, clamp } from '../shared/layout'
import type { BrowserId } from '../shared/switcher'
import { isPetVisible, petOriginPoint } from './pet-window'
import { focusPid, focusTab, listRunning, listTabs, quitPid } from './running'

/** The running-apps fan: a second transparent window anchored above MIKO (macOS only). */

export const SWITCHER = { width: 760, height: 430 } as const
/** How far the fan's bottom edge sits below the top of MIKO's box, so the cards rise from the dog. */
const OVERLAP = 70

let win: BrowserWindow | null = null
let ready = false
let openWhenReady = false

export function openSwitcher(): void {
  if (process.platform !== 'darwin') return
  const current = ensureWindow()
  if (!ready) {
    openWhenReady = true
    return
  }
  place(current)
  current.show()
  current.focus()
  current.webContents.send(IPC.switcherOpened)
}

export function toggleSwitcher(): void {
  if (win && !win.isDestroyed() && win.isVisible()) hideSwitcher()
  else openSwitcher()
}

export function hideSwitcher(): void {
  if (win && !win.isDestroyed() && win.isVisible()) win.hide()
}

export function registerSwitcherIpc(): void {
  ipcMain.handle(IPC.switcherList, (event) => (trusted(event) ? listRunning() : []))
  ipcMain.handle(IPC.switcherFocus, async (event, pid: unknown) => {
    if (!trusted(event) || !Number.isInteger(pid)) return false
    const ok = await focusPid(pid as number)
    if (ok) hideSwitcher()
    return ok
  })
  ipcMain.handle(IPC.switcherQuit, (event, pid: unknown) => {
    if (!trusted(event) || !Number.isInteger(pid)) return false
    return quitPid(pid as number)
  })
  ipcMain.handle(IPC.switcherTabs, (event, browser: unknown) => {
    if (!trusted(event) || !isBrowser(browser)) return { ok: false, tabs: [], reason: 'That browser isn’t supported.' }
    return listTabs(browser)
  })
  ipcMain.handle(IPC.switcherFocusTab, async (event, payload: unknown) => {
    if (!trusted(event) || !payload || typeof payload !== 'object') return false
    const { browser, window, tab } = payload as { browser?: unknown; window?: unknown; tab?: unknown }
    if (!isBrowser(browser) || !Number.isInteger(window) || !Number.isInteger(tab)) return false
    const ok = await focusTab(browser, window as number, tab as number)
    if (ok) hideSwitcher()
    return ok
  })
  ipcMain.on(IPC.switcherClose, (event) => {
    if (trusted(event)) hideSwitcher()
  })
}

function isBrowser(value: unknown): value is BrowserId {
  return value === 'chrome' || value === 'safari'
}

function trusted(event: IpcMainEvent | IpcMainInvokeEvent): boolean {
  return win !== null && !win.isDestroyed() && event.sender.id === win.webContents.id
}

/** Bottom-center of the fan over MIKO's head, kept inside the work area. Falls back to the cursor's display. */
function place(target: BrowserWindow): void {
  const origin = isPetVisible() ? petOriginPoint() : screen.getCursorScreenPoint()
  const display = screen.getDisplayNearestPoint(origin)
  const work = display.workArea
  const centerX = origin.x + PET_WINDOW.width / 2
  const bottom = isPetVisible() ? origin.y + OVERLAP : origin.y + SWITCHER.height / 2
  const x = Math.round(clamp(centerX - SWITCHER.width / 2, work.x, work.x + work.width - SWITCHER.width))
  const y = Math.round(clamp(bottom - SWITCHER.height, work.y, work.y + work.height - SWITCHER.height))
  target.setBounds({ x, y, width: SWITCHER.width, height: SWITCHER.height }, false)
}

function ensureWindow(): BrowserWindow {
  if (win && !win.isDestroyed()) return win
  ready = false
  const created = new BrowserWindow({
    width: SWITCHER.width,
    height: SWITCHER.height,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    title: 'MIKO switcher',
    webPreferences: {
      preload: join(__dirname, '../preload/switcher.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      spellcheck: false
    }
  })
  win = created
  created.setAlwaysOnTop(true, 'pop-up-menu')
  created.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  created.setHiddenInMissionControl(true)
  created.setWindowButtonVisibility(false)
  created.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  created.webContents.on('will-navigate', (event) => event.preventDefault())
  created.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
  created.on('blur', () => hideSwitcher())
  created.webContents.once('did-finish-load', () => {
    ready = true
    if (openWhenReady) {
      openWhenReady = false
      openSwitcher()
    }
  })
  const devServer = !app.isPackaged ? process.env['ELECTRON_RENDERER_URL'] : undefined
  if (devServer) void created.loadURL(`${devServer}/switcher.html`)
  else void created.loadFile(join(__dirname, '../renderer/switcher.html'))
  return created
}

/** Build the window early so the first Tab + Q is instant. */
export function warmSwitcher(): void {
  if (process.platform === 'darwin') ensureWindow()
}
