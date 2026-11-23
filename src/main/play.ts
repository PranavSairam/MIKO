import { BrowserWindow, screen, type Rectangle } from 'electron'
import { IPC } from '../shared/api'
import { EDGE_MARGIN, PET_WINDOW } from '../shared/layout'
import { GROUND_PAD_PX } from '../shared/doberman'
import { parsePlayMode, petTargetFor, planThrow, throwPoint, TOY_SIZE, type PlayMode, type ThrowPlan, type Toy } from '../shared/play'
import { logDiag } from './diagnostics'
import { isPetVisible, petContentFrame, postToPet } from './pet-window'
import { hardenWindow } from './security-window'
import { readSetting, writeSetting } from './settings'

/**
 * Casual-mode fetch: the thrown toy is a tiny separate window that never takes
 * mouse input or focus (it can't block clicks on other apps), moved along the arc
 * and kept inside the pet's display work area (taskbar / Dock excluded).
 * The pet itself walks with its normal controller. Nothing here touches other apps.
 */

export function playMode(): PlayMode {
  return parsePlayMode(readSetting('playMode'))
}

export function setPlayMode(mode: PlayMode): boolean {
  const ok = writeSetting('playMode', mode)
  if (ok) postToPet(IPC.playSettings, playSettings())
  if (mode === 'work') cancelToy('mode')
  return ok
}

/** Optional play sounds. Off by default: no surprise sounds. */
export function playSound(): boolean {
  return readSetting('playSound') === true
}

export function setPlaySound(on: boolean): boolean {
  const ok = writeSetting('playSound', on === true)
  if (ok) postToPet(IPC.playSettings, playSettings())
  return ok
}

export function playSettings(): { mode: PlayMode; sound: boolean } {
  return { mode: playMode(), sound: playSound() }
}

let toyWindow: BrowserWindow | null = null
let timer: NodeJS.Timeout | null = null
let flightToken = 0
let watchingDisplays = false
/** The hidden toy window is released a little after play stops (it holds a renderer process). */
let releaseTimer: NodeJS.Timeout | null = null
const RELEASE_MS = 15_000

function cancelRelease(): void {
  if (releaseTimer) clearTimeout(releaseTimer)
  releaseTimer = null
}

const SVG: Record<Toy, string> = {
  ball:
    '<svg viewBox="0 0 34 34" xmlns="http://www.w3.org/2000/svg"><circle cx="17" cy="17" r="14" fill="#d9f24a" stroke="#8aa21c" stroke-width="2"/>' +
    '<path d="M5 12c7 3 17 3 24 0M5 22c7-3 17-3 24 0" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round"/></svg>',
  stick:
    '<svg viewBox="0 0 34 34" xmlns="http://www.w3.org/2000/svg"><g transform="rotate(-25 17 17)"><rect x="3" y="14" width="28" height="6" rx="3" fill="#9a6a3a" stroke="#6b4423" stroke-width="1.5"/>' +
    '<path d="M20 14l4-5" stroke="#6b4423" stroke-width="2" stroke-linecap="round"/></g></svg>'
}

function toyPage(toy: Toy, seconds: number, reduced: boolean): string {
  const spin = reduced ? '' : `animation:spin ${Math.max(0.2, seconds).toFixed(2)}s ease-out 1;`
  const html =
    '<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; img-src data:">' +
    `<style>html,body{margin:0;background:transparent;overflow:hidden}div{width:${TOY_SIZE}px;height:${TOY_SIZE}px;${spin}}` +
    '@keyframes spin{from{transform:rotate(0)}to{transform:rotate(540deg)}}</style></head>' +
    `<body><div>${SVG[toy]}</div></body></html>`
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`
}

function ensureToyWindow(): BrowserWindow {
  if (toyWindow && !toyWindow.isDestroyed()) return toyWindow
  const win = new BrowserWindow({
    width: TOY_SIZE,
    height: TOY_SIZE,
    useContentSize: true,
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
    focusable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    title: 'MIKO toy',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      javascript: false,
      webSecurity: true,
      spellcheck: false,
      devTools: false
    }
  })
  // Never a click target: clicks go straight through to whatever is underneath.
  win.setIgnoreMouseEvents(true)
  win.setAlwaysOnTop(true, 'floating')
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (event) => event.preventDefault())
  hardenWindow(win)
  win.on('closed', () => {
    if (toyWindow === win) toyWindow = null
  })
  toyWindow = win
  return win
}

function stopTimer(): void {
  if (timer) clearInterval(timer)
  timer = null
}

function place(win: BrowserWindow, x: number, y: number): void {
  win.setBounds({ x: Math.round(x - TOY_SIZE / 2), y: Math.round(y - TOY_SIZE / 2), width: TOY_SIZE, height: TOY_SIZE }, false)
}

/** Hide the thrown toy (the pet picked it up, play ended, or MIKO is hiding). */
export function hideToy(): void {
  flightToken += 1
  stopTimer()
  if (toyWindow && !toyWindow.isDestroyed() && toyWindow.isVisible()) toyWindow.hide()
  cancelRelease()
  if (toyWindow) releaseTimer = setTimeout(destroyToy, RELEASE_MS)
}

/** Stop a flight and tell the pet (display change, Work mode, dismiss). */
export function cancelToy(reason: string): void {
  const flying = timer !== null || (toyWindow !== null && !toyWindow.isDestroyed() && toyWindow.isVisible())
  hideToy()
  if (flying) {
    logDiag('play', 'toy cancelled', { reason })
    postToPet(IPC.playToy, { phase: 'cancelled', reason })
  }
}

/** Release the toy window entirely (quit / app teardown). */
export function destroyToy(): void {
  flightToken += 1
  stopTimer()
  cancelRelease()
  if (toyWindow && !toyWindow.isDestroyed()) toyWindow.destroy()
  toyWindow = null
}

function watchDisplays(): void {
  if (watchingDisplays) return
  watchingDisplays = true
  // A monitor unplugged, rearranged or rescaled mid-throw: drop the throw rather than land off-screen.
  const onChange = (): void => cancelToy('display-changed')
  screen.on('display-removed', onChange)
  screen.on('display-metrics-changed', onChange)
  screen.on('display-added', onChange)
}

export interface ThrowRequest {
  toy: Toy
  /** Toy centre in the pet window's content (DIP). */
  localX: number
  localY: number
  vx: number
  vy: number
  /** Offset from the pet's centre to its mouth (DIP), so it stops with the toy at its mouth. */
  mouthDx: number
  /** Longest throw (DIP): about six seconds of this pet's walking. */
  maxDistance: number
  reduced: boolean
}

export interface ThrowResult {
  ok: boolean
  reason: string
  /** Placement DIP (left edge of the pet window) the pet walks to. */
  targetX: number
  seconds: number
}

const finite = (value: unknown, fallback = 0): number => (typeof value === 'number' && Number.isFinite(value) ? value : fallback)

export function parseThrowRequest(raw: unknown): ThrowRequest | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (r.toy !== 'ball' && r.toy !== 'stick') return null
  return {
    toy: r.toy,
    localX: Math.max(-200, Math.min(2000, finite(r.localX))),
    localY: Math.max(-200, Math.min(2000, finite(r.localY))),
    vx: Math.max(-6000, Math.min(6000, finite(r.vx))),
    vy: Math.max(-6000, Math.min(6000, finite(r.vy))),
    mouthDx: Math.max(0, Math.min(120, finite(r.mouthDx, 40))),
    maxDistance: Math.max(140, Math.min(560, finite(r.maxDistance, 560))),
    reduced: r.reduced === true
  }
}

export function throwToy(request: ThrowRequest): ThrowResult {
  const frame = petContentFrame()
  if (!frame || !isPetVisible()) return { ok: false, reason: 'MIKO isn’t on screen.', targetX: 0, seconds: 0 }
  if (playMode() !== 'casual') return { ok: false, reason: 'Play is part of Casual mode.', targetX: 0, seconds: 0 }
  watchDisplays()
  const petBounds: Rectangle = { x: frame.x, y: frame.y, width: PET_WINDOW.width, height: PET_WINDOW.height }
  const work = screen.getDisplayMatching(petBounds).workArea
  const petCenterX = frame.x + PET_WINDOW.width / 2
  const groundY = frame.y + PET_WINDOW.height - GROUND_PAD_PX - TOY_SIZE / 2
  const plan: ThrowPlan = planThrow(
    { x: frame.x + request.localX, y: frame.y + request.localY, vx: request.vx, vy: request.vy, work, groundY, petCenterX, maxDistance: request.maxDistance },
    request.toy
  )
  const dir = plan.to.x >= petCenterX ? 1 : -1
  const span = Math.max(0, work.width - PET_WINDOW.width - EDGE_MARGIN * 2)
  const targetX = petTargetFor(plan.to.x - dir * request.mouthDx, work, PET_WINDOW.width, EDGE_MARGIN, span)

  cancelRelease()
  const win = ensureToyWindow()
  stopTimer()
  flightToken += 1
  const token = flightToken
  const seconds = request.reduced ? 0 : plan.seconds
  void win.loadURL(toyPage(request.toy, seconds, request.reduced)).catch(() => undefined)
  logDiag('play', 'throw', { toy: request.toy, seconds: Number(seconds.toFixed(2)), reduced: request.reduced })

  const land = (): void => {
    if (token !== flightToken) return
    stopTimer()
    place(win, plan.to.x, plan.to.y)
    postToPet(IPC.playToy, { phase: 'landed' })
  }

  if (request.reduced) {
    // Reduced motion: no arc, the toy just appears where it lands.
    place(win, plan.to.x, plan.to.y)
    win.showInactive()
    setTimeout(land, 250)
    return { ok: true, reason: '', targetX, seconds: 0 }
  }

  place(win, plan.from.x, plan.from.y)
  win.showInactive()
  const started = Date.now()
  const bounceMs = 260
  timer = setInterval(() => {
    if (token !== flightToken || win.isDestroyed()) {
      stopTimer()
      return
    }
    const elapsed = (Date.now() - started) / 1000
    if (elapsed < plan.seconds) {
      const point = throwPoint(plan, elapsed / plan.seconds)
      place(win, point.x, point.y)
      return
    }
    const after = (elapsed - plan.seconds) * 1000
    if (after < bounceMs && plan.bounce > 0) {
      const u = after / bounceMs
      place(win, plan.to.x, plan.to.y - Math.sin(Math.PI * u) * plan.bounce)
      return
    }
    land()
  }, 16)
  return { ok: true, reason: '', targetX, seconds: plan.seconds }
}
