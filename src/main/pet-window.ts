import { app, BrowserWindow, screen, type Rectangle } from 'electron'
import { join } from 'path'
import { IPC, type HitRect, type PanelLayout, type PresenceEvent, type PanelMode } from '../shared/api'
import {
  EDGE_MARGIN,
  PET_WINDOW,
  layoutWindow,
  fitMailPanel,
  PANEL,
  type PanelSize,
  placeInitially,
  choosePanelSide,
  type Point,
  type Rect
} from '../shared/layout'
import { movementBlocked, placeAtWorkAreaRight } from '../shared/movement'

/**
 * Cursor polling interval. Click-through uses setIgnoreMouseEvents without
 * `forward: true`. On Windows, forwarding installs a WH_MOUSE_LL hook on
 * Electron's UI thread, and a stall there can freeze the system cursor.
 * A short poll avoids that hook. A click in the first instant after the
 * pointer enters a hit rectangle can still pass through.
 */
const CURSOR_POLL_MS = 40

let petWindow: BrowserWindow | null = null
let petOrigin: Point = { x: 0, y: 0 }
let panelOpen = false
let panelMode: PanelMode = 'chat'
let panelSide: 'left' | 'right' = 'left'
let hitRects: HitRect[] = []
let dragActive = false
let pointerHeld = false
let ignoringMouse = true
let quitting = false
let pageReady = false
let reducedMotion = false
let poll: NodeJS.Timeout | null = null
let applied: Rect | null = null
let onVisibility: () => void = () => undefined
let onReady: () => void = () => undefined
let onClose: () => void = () => undefined
let motionMode = true
let homePinned = true

export function setQuitting(next: boolean): void {
  quitting = next
  if (next && poll) {
    clearInterval(poll)
    poll = null
  }
}

export function isPetVisible(): boolean {
  return petWindow !== null && !petWindow.isDestroyed() && petWindow.isVisible()
}

export function createPetWindow(options: {
  onVisibility: () => void
  onReady: () => void
  onClose: () => void
}): void {
  motionMode = true
  homePinned = true
  onVisibility = options.onVisibility
  onReady = options.onReady
  onClose = options.onClose
  pageReady = false
  const work = screen.getPrimaryDisplay().workArea
  const initial = placeInitially(work)
  petOrigin = initial.pet
  panelSide = initial.panelSide
  panelOpen = false

  const win = new BrowserWindow({
    x: initial.bounds.x,
    y: initial.bounds.y,
    width: initial.bounds.width,
    height: initial.bounds.height,
    useContentSize: true,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    thickFrame: false,
    roundedCorners: false,
    alwaysOnTop: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    title: 'MIKO',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      experimentalFeatures: false,
      spellcheck: false
    }
  })

  petWindow = win
  applied = initial.bounds
  win.setContentBounds(initial.bounds, false)
  win.setAlwaysOnTop(true, 'floating')
  win.setIgnoreMouseEvents(true)
  ignoringMouse = true
  win.setMenuBarVisibility(false)

  if (process.platform === 'darwin') {
    win.setWindowButtonVisibility(false)
    win.setHiddenInMissionControl(true)
  }

  win.webContents.setVisualZoomLevelLimits(1, 1).catch(() => undefined)
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (event, url) => {
    const devServer = !app.isPackaged ? process.env['ELECTRON_RENDERER_URL'] : undefined
    if (devServer && sameOrigin(url, devServer)) return
    event.preventDefault()
  })
  win.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => {
    callback(false)
  })

  win.on('close', (event) => {
    if (quitting) return
    event.preventDefault()
    onClose()
  })

  win.webContents.once('did-finish-load', () => {
    setTimeout(() => {
      if (win.isDestroyed()) return
      pageReady = true
      onReady()
    }, 50)
  })

  const devServer = !app.isPackaged ? process.env['ELECTRON_RENDERER_URL'] : undefined
  if (devServer) {
    void win.loadURL(devServer)
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  const onDisplay = (): void => {
    if (!isPetVisible() || dragActive || pointerHeld) return
    if (homePinned) {
      const placed = placeAtWorkAreaRight(workAreaFor(petOrigin))
      petOrigin = placed
    }
    relayout(false)
  }
  screen.on('display-metrics-changed', onDisplay)
  screen.on('display-added', onDisplay)
  screen.on('display-removed', onDisplay)

  poll = setInterval(updateHitTesting, CURSOR_POLL_MS)
}

export function setReducedMotion(next: boolean): void {
  reducedMotion = next
}

export function canMoveOnItsOwn(): boolean {
  return !movementBlocked({
    hidden: !isPetVisible(),
    dragging: dragActive,
    panelOpen,
    reducedMotion
  })
}

/** Place MIKO at the bottom-right of the display under the pointer, without focusing. */
export function summonAtPointer(): void {
  if (!petWindow || petWindow.isDestroyed() || !pageReady) return
  if (panelOpen) panelOpen = false
  homePinned = true
  const cursor = screen.getCursorScreenPoint()
  const work = screen.getDisplayNearestPoint(cursor).workArea
  petOrigin = placeAtWorkAreaRight(work)
  panelSide = 'left'
  relayout(false)
  petWindow.showInactive()
  petWindow.setAlwaysOnTop(true, 'floating')
  emitPlacement()
  onVisibility()
}

export function revealWithoutMoving(): void {
  if (!petWindow || petWindow.isDestroyed() || !pageReady) return
  petWindow.showInactive()
  petWindow.setAlwaysOnTop(true, 'floating')
  onVisibility()
}

export function concealPet(): void {
  if (!petWindow || petWindow.isDestroyed()) return
  if (panelOpen) panelOpen = false
  dragActive = false
  pointerHeld = false
  applyIgnore(true)
  if (petWindow.isVisible()) petWindow.hide()
  onVisibility()
}

export function sendPresence(event: PresenceEvent): void {
  postToPet(IPC.presence, event)
}

export function postToPet(channel: string, payload: unknown): void {
  if (!petWindow || petWindow.isDestroyed()) return
  petWindow.webContents.send(channel, payload)
}

/** Content origin in DIP, plus the display scale. The scale is not applied to the origin. */
export function petContentFrame(): { x: number; y: number; scaleFactor: number } | null {
  if (!petWindow || petWindow.isDestroyed()) return null
  const bounds = petWindow.getContentBounds()
  const scaleFactor = screen.getDisplayMatching(bounds).scaleFactor
  return {
    x: bounds.x,
    y: bounds.y,
    scaleFactor: Number.isFinite(scaleFactor) && scaleFactor > 0 ? scaleFactor : 1
  }
}

export function currentLayout(): PanelLayout {
  return layoutResult()
}

export function setPanelOpen(open: boolean, mode: PanelMode = 'chat'): PanelLayout {
  panelOpen = open
  panelMode = open ? mode : 'chat'
  return relayout(open)
}

function panelSize(work: Rectangle): PanelSize {
  return panelMode === 'mail' ? fitMailPanel(petOrigin, work) : PANEL
}

function layoutResult(): PanelLayout {
  const size = petWindow && !petWindow.isDestroyed() ? panelSize(workAreaFor(petOrigin)) : PANEL
  return { panelOpen, panelSide, mode: panelMode, panelWidth: size.width, panelHeight: size.height }
}

export function movePetBy(dx: number, dy: number): void {
  if (!dragActive && !canMoveOnItsOwn()) return
  petOrigin = { x: petOrigin.x + dx, y: petOrigin.y + dy }
  relayout(false)
}

/** Horizontal gait, including while the panel is open. A reduced snap is requested explicitly. */
export function travelBy(dx: number, allowReduced: boolean): void {
  shiftBy(dx, 0, allowReduced)
}

/** Follow steps may change both axes. Guide drags and reduced motion still hold. */
export function shiftBy(dx: number, dy: number, allowReduced: boolean): void {
  if (!isPetVisible() || dragActive) return
  if (reducedMotion && !allowReduced) return
  if (!Number.isFinite(dx) || !Number.isFinite(dy) || (dx === 0 && dy === 0)) return
  petOrigin = { x: petOrigin.x + dx, y: petOrigin.y + dy }
  relayout(false)
}

export function petOriginPoint(): Point {
  return { x: petOrigin.x, y: petOrigin.y }
}

export function reducedMotionEnabled(): boolean {
  return reducedMotion
}

export function followBlocked(): boolean {
  return panelOpen || dragActive || pointerHeld
}

/** Move onto another display without focusing. A brief hide covers the jump. */
export function placePet(x: number, y: number, hideBriefly: boolean): void {
  if (!petWindow || petWindow.isDestroyed() || !pageReady || !isPetVisible()) return
  if (!Number.isFinite(x) || !Number.isFinite(y)) return
  petOrigin = { x, y }
  if (hideBriefly && petWindow.isVisible()) petWindow.hide()
  relayout(false)
  petWindow.showInactive()
  petWindow.setAlwaysOnTop(true, 'floating')
  emitPlacement()
}

export function unpinHome(): void {
  homePinned = false
}

export function setPointerHeld(active: boolean): void {
  pointerHeld = active
  if (active) applyIgnore(false)
  else updateHitTesting()
}

export function setHitRects(rects: HitRect[]): void {
  hitRects = rects
  updateHitTesting()
}

export function setDragActive(active: boolean): void {
  if (dragActive && !active) homePinned = false
  dragActive = active
  if (active) applyIgnore(false)
  else updateHitTesting()
}

export function isTrustedSender(senderId: number): boolean {
  return petWindow !== null && !petWindow.isDestroyed() && petWindow.webContents.id === senderId
}

function sameOrigin(url: string, base: string): boolean {
  try {
    return new URL(url).origin === new URL(base).origin
  } catch {
    return false
  }
}

function workAreaFor(pet: Point): Rectangle {
  return screen.getDisplayNearestPoint({
    x: Math.round(pet.x + PET_WINDOW.width / 2),
    y: Math.round(pet.y + PET_WINDOW.height / 2)
  }).workArea
}

function relayout(pickSide: boolean): PanelLayout {
  if (!petWindow || petWindow.isDestroyed()) return layoutResult()
  const work = workAreaFor(petOrigin)
  const size = panelSize(work)
  const preferred = pickSide ? choosePanelSide(petOrigin, work, size) : panelSide
  const next = layoutWindow(petOrigin, panelOpen, work, preferred, size)
  petOrigin = next.pet
  panelSide = next.panelSide
  const bounds = next.bounds
  if (
    !applied ||
    applied.x !== bounds.x ||
    applied.y !== bounds.y ||
    applied.width !== bounds.width ||
    applied.height !== bounds.height
  ) {
    applied = bounds
    petWindow.setContentBounds(bounds, false)
  }
  emitPlacement()
  return { panelOpen, panelSide, mode: panelMode, panelWidth: size.width, panelHeight: size.height }
}

function emitPlacement(): void {
  if (!motionMode || !petWindow || petWindow.isDestroyed() || !pageReady || !petWindow.isVisible()) return
  const work = workAreaFor(petOrigin)
  const span = Math.max(0, work.width - PET_WINDOW.width - EDGE_MARGIN * 2)
  const x = petOrigin.x - (work.x + EDGE_MARGIN)
  petWindow.webContents.send(IPC.placement, { x, span })
}

function applyIgnore(ignore: boolean): void {
  if (!petWindow || petWindow.isDestroyed()) return
  if (ignore === ignoringMouse) return
  ignoringMouse = ignore
  petWindow.setIgnoreMouseEvents(ignore)
}

function updateHitTesting(): void {
  if (!petWindow || petWindow.isDestroyed() || !petWindow.isVisible()) return
  if (dragActive || pointerHeld) {
    applyIgnore(false)
    return
  }
  const cursor = screen.getCursorScreenPoint()
  const content = petWindow.getContentBounds()
  const localX = cursor.x - content.x
  const localY = cursor.y - content.y
  const hit = hitRects.some(
    (rect) =>
      localX >= rect.x &&
      localY >= rect.y &&
      localX < rect.x + rect.width &&
      localY < rect.y + rect.height
  )
  applyIgnore(!hit)
}
