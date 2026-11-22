import { join } from 'node:path'
import { app, BrowserWindow, ipcMain, screen, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron'
import { IPC } from '../shared/api'
import { PET_WINDOW, clamp } from '../shared/layout'
import { switcherDropTarget, type BrowserId, type SwitcherFeedResult } from '../shared/switcher'
import { isPetVisible, petOriginPoint, postToPet } from './pet-window'
import { currentPetChoice } from './pets'
import {
  closeTabVerified,
  focusPid,
  focusTab,
  listRunning,
  listTabs,
  quitPid,
  requestGracefulQuitPid,
  waitUntilPidGone
} from './running'

/** The running-apps fan: a second transparent window anchored above MIKO (macOS only). */

export const SWITCHER = { width: 760, height: 430 } as const
/** How far the fan's bottom edge sits below the top of MIKO's box, so the cards rise from the dog. */
const OVERLAP = 70

let win: BrowserWindow | null = null
let ready = false
let openWhenReady = false
/** While a feed quit is in flight, keep the fan visible even if focus moves to a save sheet. */
let feedHold = 0
const feedBusy = new Set<string>()
/** Click-through for empty glass. macOS-only forward so cards can still arm on hover. */
let switcherIgnoring = true

function applySwitcherIgnore(ignore: boolean): void {
  if (!win || win.isDestroyed()) return
  if (ignore === switcherIgnoring) return
  switcherIgnoring = ignore
  // forward: true is macOS-only here (switcher never opens on Windows).
  if (ignore) win.setIgnoreMouseEvents(true, { forward: true })
  else win.setIgnoreMouseEvents(false)
}

export function openSwitcher(): void {
  if (process.platform !== 'darwin') return
  const current = ensureWindow()
  if (!ready) {
    openWhenReady = true
    return
  }
  place(current)
  // Empty glass must not eat clicks meant for MIKO’s panel underneath.
  applySwitcherIgnore(true)
  current.show()
  current.focus()
  current.webContents.send(IPC.switcherOpened)
}

export function toggleSwitcher(): void {
  if (win && !win.isDestroyed() && win.isVisible()) hideSwitcher()
  else openSwitcher()
}

export function hideSwitcher(force = false): void {
  if (!force && feedHold > 0) return
  if (win && !win.isDestroyed() && win.isVisible()) win.hide()
  if (win && !win.isDestroyed()) applySwitcherIgnore(true)
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
  ipcMain.handle(IPC.switcherCloseTab, async (event, payload: unknown) => {
    if (!trusted(event) || !payload || typeof payload !== 'object') return false
    const { browser, window, tab } = payload as { browser?: unknown; window?: unknown; tab?: unknown }
    if (!isBrowser(browser) || !Number.isInteger(window) || !Number.isInteger(tab)) return false
    const result = await closeTabVerified(browser, window as number, tab as number)
    return result === 'closed' || result === 'gone'
  })
  ipcMain.handle(IPC.switcherDropTarget, (event) => {
    if (!trusted(event)) return switcherDropTarget(SWITCHER.width, SWITCHER.height)
    return switcherDropTarget(SWITCHER.width, SWITCHER.height, currentPetChoice())
  })
  ipcMain.handle(IPC.switcherFeedApp, async (event, pid: unknown) => {
    if (!trusted(event) || !Number.isInteger(pid)) {
      return { status: 'failed', name: 'That app', reason: 'Not allowed.' } satisfies SwitcherFeedResult
    }
    return feedApp(pid as number)
  })
  ipcMain.handle(IPC.switcherFeedTab, async (event, payload: unknown) => {
    if (!trusted(event) || !payload || typeof payload !== 'object') {
      return { status: 'failed', name: 'tab', reason: 'Not allowed.' } satisfies SwitcherFeedResult
    }
    const { browser, window, tab, title } = payload as {
      browser?: unknown
      window?: unknown
      tab?: unknown
      title?: unknown
    }
    if (!isBrowser(browser) || !Number.isInteger(window) || !Number.isInteger(tab)) {
      return { status: 'failed', name: 'tab', reason: 'That tab isn’t valid any more.' } satisfies SwitcherFeedResult
    }
    return feedTab(
      browser,
      window as number,
      tab as number,
      typeof title === 'string' ? title.slice(0, 80) : 'tab'
    )
  })
  ipcMain.on(IPC.switcherClose, (event) => {
    if (trusted(event)) hideSwitcher(true)
  })
  ipcMain.on(IPC.switcherIgnoreMouse, (event, ignore: unknown) => {
    if (!trusted(event) || typeof ignore !== 'boolean') return
    // While visible, only accept clicks over interactive cards (renderer reports hover).
    if (win && !win.isDestroyed() && win.isVisible()) applySwitcherIgnore(ignore)
  })
}

async function feedApp(pid: number): Promise<SwitcherFeedResult> {
  const key = `app:${pid}`
  if (feedBusy.has(key)) {
    return { status: 'busy', name: 'That app', reason: 'Already asking that app to quit.' }
  }
  feedBusy.add(key)
  feedHold += 1
  try {
    const requested = await requestGracefulQuitPid(pid)
    if (!requested.ok && !requested.alreadyGone) {
      return { status: 'failed', name: requested.name, reason: `${requested.name} didn’t accept the quit request.` }
    }
    if (requested.alreadyGone) {
      postToPet(IPC.petCommand, { kind: 'feed' })
      return { status: 'gone', name: requested.name, reason: `${requested.name} was already closed.` }
    }
    postToPet(IPC.petCommand, { kind: 'feed' })
    const outcome = await waitUntilPidGone(pid, 10_000)
    if (outcome === 'closed') {
      return { status: 'closed', name: requested.name, reason: `Quit ${requested.name}.` }
    }
    return {
      status: 'waiting',
      name: requested.name,
      reason: `Waiting for ${requested.name} — finish any save dialog, then try again if it’s still open.`
    }
  } finally {
    feedBusy.delete(key)
    feedHold = Math.max(0, feedHold - 1)
  }
}

async function feedTab(
  browser: BrowserId,
  windowIndex: number,
  tabIndex: number,
  title: string
): Promise<SwitcherFeedResult> {
  const key = `tab:${browser}:${windowIndex}:${tabIndex}`
  if (feedBusy.has(key)) {
    return { status: 'busy', name: title, reason: 'Already closing that tab.' }
  }
  feedBusy.add(key)
  feedHold += 1
  try {
    const result = await closeTabVerified(browser, windowIndex, tabIndex)
    if (result === 'closed') {
      postToPet(IPC.petCommand, { kind: 'feed' })
      return { status: 'closed', name: title, reason: `Closed “${title}”.` }
    }
    if (result === 'gone') {
      return { status: 'gone', name: title, reason: 'That tab is already gone.' }
    }
    return { status: 'failed', name: title, reason: `I couldn’t close “${title}”.` }
  } finally {
    feedBusy.delete(key)
    feedHold = Math.max(0, feedHold - 1)
  }
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
  created.setBackgroundColor('#00000000')
  created.setAlwaysOnTop(true, 'pop-up-menu')
  created.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  created.setHiddenInMissionControl(true)
  created.setWindowButtonVisibility(false)
  switcherIgnoring = false
  applySwitcherIgnore(true)
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
