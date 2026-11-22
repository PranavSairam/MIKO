/**
 * MIKO Lens — floating GPT Mode reading window.
 * Closing does not exit GPT Mode.
 */
import { join } from 'node:path'
import { app, BrowserWindow, screen } from 'electron'
import { IPC } from '../shared/api'
import {
  GPT_LIVE_PILL,
  GPT_LIVE_SIZE,
  GPT_LIVE_WORK_INSET,
  type GptLiveSizePreset
} from '../shared/gpt-mode'
import { clamp, clampBounds, type Rect } from '../shared/layout'
import { hardenWindow } from './security-window'
import { gptLiveBoundsSetting, setGptLiveBoundsSetting } from './settings'
import { petOriginPoint } from './pet-window'
import { setGptLiveView } from './gpt-mode'

let win: BrowserWindow | null = null
let saveTimer: NodeJS.Timeout | null = null
let expandedBounds: Rect | null = null
let collapsed = false

function insetWork(work: Rect): Rect {
  const m = GPT_LIVE_WORK_INSET
  return {
    x: work.x + m,
    y: work.y + m,
    width: Math.max(200, work.width - m * 2),
    height: Math.max(160, work.height - m * 2)
  }
}

function workAreaNearPet(): Rect {
  const display = screen.getDisplayNearestPoint(petOriginPoint())
  return insetWork(display.workArea)
}

function fitSize(wanted: { width: number; height: number }, work: Rect): { width: number; height: number } {
  return {
    width: Math.min(wanted.width, Math.max(360, work.width)),
    height: Math.min(wanted.height, Math.max(280, work.height))
  }
}

function defaultBounds(preset: GptLiveSizePreset = 'reading'): Rect {
  const work = workAreaNearPet()
  const size = fitSize(GPT_LIVE_SIZE[preset], work)
  const pet = petOriginPoint()
  // Above / beside the pet initially; then independently movable.
  let x = Math.round(pet.x + 36)
  let y = Math.round(pet.y - size.height - 28)
  return clampBounds({ x, y, width: size.width, height: size.height }, work)
}

function pillBounds(): Rect {
  const work = workAreaNearPet()
  const pet = petOriginPoint()
  const size = GPT_LIVE_PILL
  const x = Math.round(pet.x + 8)
  const y = Math.round(pet.y - size.height - 12)
  return clampBounds({ x, y, width: size.width, height: size.height }, work)
}

function persistBoundsSoon(): void {
  if (!win || win.isDestroyed() || collapsed) return
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    if (!win || win.isDestroyed() || collapsed) return
    const b = win.getBounds()
    expandedBounds = b
    setGptLiveBoundsSetting(b)
  }, 250)
}

function reclampToWorkArea(): void {
  if (!win || win.isDestroyed()) return
  const work = workAreaNearPet()
  const cur = win.getBounds()
  if (collapsed) {
    win.setBounds(clampBounds(pillBounds(), work), false)
    return
  }
  const width = clamp(cur.width, 360, work.width)
  const height = clamp(cur.height, 280, work.height)
  const next = clampBounds({ x: cur.x, y: cur.y, width, height }, work)
  win.setBounds(next, false)
  expandedBounds = next
  setGptLiveBoundsSetting(next)
}

function ensureWindow(): BrowserWindow {
  if (win && !win.isDestroyed()) return win

  const saved = gptLiveBoundsSetting()
  const work = workAreaNearPet()
  const reading = fitSize(GPT_LIVE_SIZE.reading, work)
  // Prefer a real reading window; only honor saved size when it is large enough.
  const initial = saved
    ? clampBounds(
        {
          x: saved.x,
          y: saved.y,
          width: clamp(
            saved.width >= 640 ? saved.width : reading.width,
            360,
            work.width
          ),
          height: clamp(
            saved.height >= 480 ? saved.height : reading.height,
            280,
            work.height
          )
        },
        work
      )
    : defaultBounds('reading')
  expandedBounds = initial
  collapsed = false

  const created = new BrowserWindow({
    x: initial.x,
    y: initial.y,
    width: initial.width,
    height: initial.height,
    minWidth: 420,
    minHeight: 320,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: true,
    thickFrame: false,
    roundedCorners: true,
    alwaysOnTop: true,
    resizable: true,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    title: 'MIKO Lens',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      experimentalFeatures: false,
      spellcheck: false,
      devTools: !app.isPackaged
    }
  })

  win = created
  hardenWindow(created)
  created.setAlwaysOnTop(true, 'floating')
  created.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })

  created.on('moved', persistBoundsSoon)
  created.on('resized', persistBoundsSoon)
  created.on('closed', () => {
    if (win === created) win = null
    collapsed = false
    expandedBounds = null
    setGptLiveView(false, 'MIKO Lens closed.')
  })

  const onDisplayChange = (): void => {
    reclampToWorkArea()
  }
  screen.on('display-metrics-changed', onDisplayChange)
  screen.on('display-added', onDisplayChange)
  screen.on('display-removed', onDisplayChange)
  created.on('closed', () => {
    screen.removeListener('display-metrics-changed', onDisplayChange)
    screen.removeListener('display-added', onDisplayChange)
    screen.removeListener('display-removed', onDisplayChange)
  })

  created.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  created.webContents.on('will-navigate', (event, url) => {
    const devServer = !app.isPackaged ? process.env['ELECTRON_RENDERER_URL'] : undefined
    if (devServer && sameOrigin(url, devServer)) return
    event.preventDefault()
  })

  const devServer = !app.isPackaged ? process.env['ELECTRON_RENDERER_URL'] : undefined
  if (devServer) void created.loadURL(`${devServer}/gpt-live.html`)
  else void created.loadFile(join(__dirname, '../renderer/gpt-live.html'))

  return created
}

function sameOrigin(url: string, base: string): boolean {
  try {
    return new URL(url).origin === new URL(base).origin
  } catch {
    return false
  }
}

export function openGptLiveWindow(): void {
  // Lens/live capture currently relies on the macOS capture + AX adapters.
  // Do not open an empty, misleading window on Windows.
  if (process.platform !== 'darwin') return
  const current = ensureWindow()
  if (collapsed) setGptLiveCollapsed(false)
  const show = (): void => {
    if (!current.isDestroyed()) {
      current.show()
      current.focus()
    }
  }
  if (current.isVisible()) {
    current.focus()
    return
  }
  if (current.webContents.isLoading()) current.once('ready-to-show', show)
  else show()
}

export function closeGptLiveWindow(): void {
  if (win && !win.isDestroyed()) {
    const target = win
    win = null
    collapsed = false
    expandedBounds = null
    target.removeAllListeners('closed')
    target.destroy()
  }
}

export function isGptLiveWindowOpen(): boolean {
  return Boolean(win && !win.isDestroyed() && win.isVisible())
}

export function focusGptLiveWindow(): void {
  if (win && !win.isDestroyed()) {
    win.show()
    win.focus()
  }
}

export function applyGptLiveSizePreset(preset: GptLiveSizePreset): void {
  const current = ensureWindow()
  if (collapsed) setGptLiveCollapsed(false)
  const next = defaultBounds(preset)
  const cur = current.getBounds()
  const work = workAreaNearPet()
  const placed = clampBounds({ x: cur.x, y: cur.y, width: next.width, height: next.height }, work)
  current.setBounds(placed, true)
  current.setResizable(true)
  expandedBounds = placed
  setGptLiveBoundsSetting(placed)
}

export function setGptLiveCollapsed(next: boolean): boolean {
  const current = ensureWindow()
  if (next) {
    if (!collapsed) {
      expandedBounds = current.getBounds()
      setGptLiveBoundsSetting(expandedBounds)
    }
    collapsed = true
    current.setResizable(false)
    current.setBounds(pillBounds(), true)
    postToGptLive(IPC.gptModeLiveCollapse, true)
    return true
  }
  collapsed = false
  current.setResizable(true)
  const work = workAreaNearPet()
  const restore = expandedBounds
    ? clampBounds(
        {
          x: expandedBounds.x,
          y: expandedBounds.y,
          width: clamp(expandedBounds.width, 360, work.width),
          height: clamp(expandedBounds.height, 280, work.height)
        },
        work
      )
    : defaultBounds('reading')
  current.setBounds(restore, true)
  postToGptLive(IPC.gptModeLiveCollapse, false)
  return true
}

export function isGptLiveCollapsed(): boolean {
  return collapsed
}

export function postToGptLive(channel: string, payload?: unknown): void {
  if (!win || win.isDestroyed()) return
  const target = win
  const send = (): void => {
    if (!target.isDestroyed()) target.webContents.send(channel, payload)
  }
  if (target.webContents.isLoading()) target.webContents.once('did-finish-load', send)
  else send()
}

/** Narrow allowlist: only this viewer’s webContents (not every renderer). */
export function isGptLiveSender(senderId: number): boolean {
  return win !== null && !win.isDestroyed() && win.webContents.id === senderId
}
