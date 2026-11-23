/**
 * Interactive GPT workspace: real chatgpt.com beside the pet (not covering it).
 * Guest has no preload / no Node / no MIKO IPC. Does not replace GPT Mode or Lens.
 */
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  BrowserWindow,
  WebContentsView,
  app,
  clipboard,
  screen,
  session,
  shell,
  type BrowserWindowConstructorOptions
} from 'electron'
import { PET_WINDOW, clamp, clampBounds, type Rect } from '../shared/layout'
import { hardenWindow } from './security-window'
import { hostOf, logDiag } from './diagnostics'
import { petOriginPoint, postToPet, raisePetWindow, restorePetPointerState } from './pet-window'
import { IPC } from '../shared/api'
import {
  chatgptWebBoundsSetting,
  chatgptWebLastUrlSetting,
  chatgptWebPinnedSetting,
  setChatgptWebBoundsSetting,
  setChatgptWebLastUrlSetting,
  setChatgptWebPinnedSetting
} from './settings'

const PARTITION = 'persist:miko-chatgpt-web'
export const CHATGPT_WEB_HOME = 'https://chatgpt.com/'
const DEFAULT_SIZE = { width: 900, height: 650 } as const
const MIN_SIZE = { width: 480, height: 360 } as const
const PILL = { width: 168, height: 44 } as const
const WORK_INSET = 12
const PET_GAP = 16

const ALLOWED_HOSTS = new Set([
  'chatgpt.com',
  'www.chatgpt.com',
  'chat.openai.com',
  'openai.com',
  'www.openai.com',
  'auth0.openai.com',
  'auth.openai.com',
  'cdn.openai.com',
  'accounts.google.com',
  'appleid.apple.com',
  'login.microsoftonline.com'
])

function hostAllowed(hostname: string): boolean {
  const h = hostname.toLowerCase()
  if (ALLOWED_HOSTS.has(h)) return true
  return (
    h.endsWith('.chatgpt.com') ||
    h.endsWith('.openai.com') ||
    h.endsWith('.google.com') ||
    h.endsWith('.googleusercontent.com') ||
    h.endsWith('.gstatic.com') ||
    h.endsWith('.apple.com') ||
    h.endsWith('.microsoftonline.com') ||
    h.endsWith('.live.com') ||
    h.endsWith('.microsoft.com')
  )
}

function urlAllowed(raw: string): boolean {
  try {
    const u = new URL(raw)
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return false
    return hostAllowed(u.hostname)
  } catch {
    return false
  }
}

let win: BrowserWindow | null = null
let guest: WebContentsView | null = null
let chromeHeight = 44
let collapsed = false
let pinned = true
let expandedBounds: Rect | null = null
let lastDownloadNote = ''
let saveTimer: NodeJS.Timeout | null = null
let lastFocusAt = 0
/** True when the window exists but was hidden by dismiss (session kept). */
let dismissedHidden = false
/** Chrome/pill reports an OS drag over MIKO surfaces — don’t raise the pet mid-drop. */
let chromeDragActive = false
let chromeDragClearTimer: NodeJS.Timeout | null = null
let lastDropNote = ''
/** Guest page failed to load (shown in the chrome with Retry / Open in browser). */
let loadError = ''
/**
 * A link or redirect that would leave chatgpt.com and its sign-in hosts. Never opened
 * silently: the chrome shows it with an explicitly labelled “Open in browser”.
 */
let blockedLink: { url: string; host: string } | null = null
let dropNoteClearTimer: NodeJS.Timeout | null = null
/** Explicit one-shot Dictate-to-GPT arm (next MIKO mic final → composer, then clear). */
let dictateArmed = false
/** Talk to GPT: each final MIKO voice transcript is sent to ChatGPT (explicit switch; off on close). */
let talkArmed = false
/** Debounce pet raise on GPT blur to avoid focus/z-order fighting. */
let raisePetFromBlurTimer: NodeJS.Timeout | null = null
/** Bumped to drop in-flight Interactive GPT submits (cancel / source change). */
let submitGeneration = 0

export type ChatGptWebSubmitStatus =
  | 'submitted-observed'
  | 'delivery-unverified'
  | 'empty'
  | 'changed'
  | 'unavailable'
  | 'cancelled'
  | 'failed'

export type ChatGptWebSubmitResult = {
  ok: boolean
  status: ChatGptWebSubmitStatus
  reason: string
  composerText: string
}

export type ChatGptWebDownloadInfo = {
  filename: string
  state: string
  savePath: string
  receivedBytes: number
  totalBytes: number
}

let lastDownload: ChatGptWebDownloadInfo | null = null
const downloadListeners = new Set<(info: ChatGptWebDownloadInfo) => void>()

export function onChatGptWebDownload(listener: (info: ChatGptWebDownloadInfo) => void): () => void {
  downloadListeners.add(listener)
  return () => downloadListeners.delete(listener)
}

function emitDownload(info: ChatGptWebDownloadInfo): void {
  lastDownload = info
  lastDownloadNote = `${info.state}: ${info.filename}`
  for (const listener of downloadListeners) listener(info)
}

export function getChatGptWebDownload(): ChatGptWebDownloadInfo | null {
  return lastDownload
}

export function isChatGptWebOpen(): boolean {
  return Boolean(win && !win.isDestroyed())
}

export function isChatGptWebCollapsed(): boolean {
  return collapsed
}

/** file:// URLs built from paths must use pathToFileURL: `file://${'C:\\…'}` is not a valid URL on Windows. */
function chromeFileUrl(): string {
  return pathToFileURL(join(__dirname, '../renderer/chatgpt-web.html')).href
}

function rendererDirUrl(): string {
  return pathToFileURL(join(__dirname, '../renderer/')).href
}

function chromeUrl(): string {
  if (app.isPackaged) return chromeFileUrl()
  const port = process.env['ELECTRON_RENDERER_URL']
  if (port) return `${port}/chatgpt-web.html`
  return chromeFileUrl()
}

function guestSession() {
  return session.fromPartition(PARTITION)
}

let guestSessionConfigured = false

function configureGuestSession(): void {
  if (guestSessionConfigured) return
  guestSessionConfigured = true
  const ses = guestSession()
  ses.setPermissionRequestHandler((_wc, permission, callback, details) => {
    if (permission === 'clipboard-sanitized-write') {
      callback(true)
      return
    }
    // ChatGPT's own voice mode: microphone only (never camera or screen), only for chatgpt.com.
    if (permission === 'media') {
      const d = details as { mediaTypes?: string[]; requestingUrl?: string; securityOrigin?: string }
      const types = d.mediaTypes ?? []
      callback(chatgptMicOrigin(d.requestingUrl ?? d.securityOrigin ?? '') && types.length > 0 && types.every((t) => t === 'audio'))
      return
    }
    callback(false)
  })
  ses.setPermissionCheckHandler((_wc, permission, origin, details) => {
    if (permission === 'clipboard-sanitized-write') return true
    const d = details as { mediaType?: string; securityOrigin?: string } | undefined
    return permission === 'media' && d?.mediaType === 'audio' && chatgptMicOrigin(origin || d?.securityOrigin || '')
  })

  ses.on('will-download', (_event, item) => {
    const dir = join(app.getPath('downloads'), 'MIKO-ChatGPT-Web')
    try {
      mkdirSync(dir, { recursive: true })
    } catch {
      /* ignore */
    }
    const filename = item.getFilename().slice(0, 200) || 'download'
    const savePath = join(dir, filename)
    item.setSavePath(savePath)
    emitDownload({
      filename,
      state: 'progressing',
      savePath,
      receivedBytes: 0,
      totalBytes: item.getTotalBytes()
    })
    item.on('updated', (_e, state) => {
      emitDownload({
        filename,
        state,
        savePath,
        receivedBytes: item.getReceivedBytes(),
        totalBytes: item.getTotalBytes()
      })
    })
    item.once('done', (_e, state) => {
      emitDownload({
        filename,
        state,
        savePath,
        receivedBytes: item.getReceivedBytes(),
        totalBytes: item.getTotalBytes()
      })
    })
  })
}

function insetWork(work: Rect): Rect {
  return {
    x: work.x + WORK_INSET,
    y: work.y + WORK_INSET,
    width: Math.max(320, work.width - WORK_INSET * 2),
    height: Math.max(240, work.height - WORK_INSET * 2)
  }
}

function workAreaNearPet(): Rect {
  const display = screen.getDisplayNearestPoint(petOriginPoint())
  return insetWork(display.workArea)
}

function petRect(): Rect {
  const o = petOriginPoint()
  return { x: o.x, y: o.y, width: PET_WINDOW.width, height: PET_WINDOW.height }
}

function rectsOverlap(a: Rect, b: Rect, gap = 0): boolean {
  return !(
    a.x + a.width + gap <= b.x ||
    b.x + b.width + gap <= a.x ||
    a.y + a.height + gap <= b.y ||
    b.y + b.height + gap <= a.y
  )
}

/**
 * Place the workspace near the pet without covering it.
 * Prefers left/right; shrinks width before overlapping. Never moves the pet.
 */
function placeBesidePet(wanted: { width: number; height: number }, work: Rect): Rect {
  const pet = petRect()
  let width = Math.min(wanted.width, Math.max(MIN_SIZE.width, work.width))
  let height = Math.min(wanted.height, Math.max(MIN_SIZE.height, work.height))

  const tryPlace = (x: number, y: number, w: number, h: number): Rect | null => {
    const placed = clampBounds({ x, y, width: w, height: h }, work)
    if (rectsOverlap(placed, pet, PET_GAP - 2)) return null
    return placed
  }

  const yBottom = Math.round(pet.y + pet.height - height)
  const yTop = Math.round(pet.y)
  const candidates: Array<() => Rect | null> = [
    () => tryPlace(pet.x - PET_GAP - width, yBottom, width, height),
    () => tryPlace(pet.x + pet.width + PET_GAP, yBottom, width, height),
    () => tryPlace(pet.x - PET_GAP - width, yTop, width, height),
    () => tryPlace(pet.x + pet.width + PET_GAP, yTop, width, height),
    () => tryPlace(Math.round(pet.x + (pet.width - width) / 2), pet.y - PET_GAP - height, width, height)
  ]
  for (const make of candidates) {
    const hit = make()
    if (hit) return hit
  }

  // Shrink to fit beside the pet inside the work area.
  const leftRoom = Math.floor(pet.x - work.x - PET_GAP)
  const rightRoom = Math.floor(work.x + work.width - (pet.x + pet.width) - PET_GAP)
  if (leftRoom >= MIN_SIZE.width || rightRoom >= MIN_SIZE.width) {
    const useLeft = leftRoom >= rightRoom
    width = Math.min(width, useLeft ? leftRoom : rightRoom)
    height = Math.min(height, work.height)
    const x = useLeft ? pet.x - PET_GAP - width : pet.x + pet.width + PET_GAP
    const hit = tryPlace(x, yBottom, width, height) || tryPlace(x, yTop, width, height)
    if (hit) return hit
  }

  // Above pet with reduced height so the pet stays clear.
  const aboveRoom = Math.floor(pet.y - work.y - PET_GAP)
  if (aboveRoom >= MIN_SIZE.height) {
    height = Math.min(height, aboveRoom)
    width = Math.min(width, work.width)
    const hit = tryPlace(Math.round(pet.x + (pet.width - width) / 2), pet.y - PET_GAP - height, width, height)
    if (hit) return hit
  }

  // Last resort: clamp into work area on the side with more free space (may still clear pet).
  const fallbackX = rightRoom >= leftRoom ? pet.x + pet.width + PET_GAP : work.x
  return clampBounds({ x: fallbackX, y: work.y, width: Math.min(width, work.width), height: Math.min(height, work.height) }, work)
}

function nudgeClearOfPet(bounds: Rect, work: Rect): Rect {
  const pet = petRect()
  if (!rectsOverlap(bounds, pet, PET_GAP - 2)) return clampBounds(bounds, work)
  const shiftedLeft = clampBounds({ ...bounds, x: pet.x - PET_GAP - bounds.width }, work)
  if (!rectsOverlap(shiftedLeft, pet, PET_GAP - 2)) return shiftedLeft
  const shiftedRight = clampBounds({ ...bounds, x: pet.x + pet.width + PET_GAP }, work)
  if (!rectsOverlap(shiftedRight, pet, PET_GAP - 2)) return shiftedRight
  return placeBesidePet({ width: bounds.width, height: bounds.height }, work)
}

function pillBounds(): Rect {
  const work = workAreaNearPet()
  const pet = petOriginPoint()
  const x = Math.round(pet.x + 8)
  const y = Math.round(pet.y - PILL.height - 10)
  return clampBounds({ x, y, width: PILL.width, height: PILL.height }, work)
}

function applyPin(target: BrowserWindow): void {
  if (pinned) {
    // Same floating band as the pet — placement keeps them from covering each other.
    target.setAlwaysOnTop(true, 'floating')
    target.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  } else {
    target.setAlwaysOnTop(false)
    target.setVisibleOnAllWorkspaces(false)
  }
}

function persistBoundsSoon(): void {
  if (!win || win.isDestroyed() || collapsed) return
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    if (!win || win.isDestroyed() || collapsed) return
    const b = win.getBounds()
    expandedBounds = b
    setChatgptWebBoundsSetting(b)
  }, 250)
}

function persistGuestUrl(): void {
  if (!guest || guest.webContents.isDestroyed()) return
  const url = guest.webContents.getURL()
  if (urlAllowed(url) && /^https:/i.test(url)) setChatgptWebLastUrlSetting(url)
}

function layoutGuest(): void {
  if (!win || win.isDestroyed() || !guest) return
  if (collapsed) {
    guest.setBounds({ x: 0, y: 0, width: 1, height: 1 })
    guest.setVisible(false)
    return
  }
  guest.setVisible(true)
  const b = win.getContentBounds()
  const top = Math.max(36, chromeHeight)
  guest.setBounds({ x: 0, y: top, width: Math.max(1, b.width), height: Math.max(1, b.height - top) })
}

/**
 * Minimal guest helper: visual drop affordance only.
 * Does not preventDefault / stopPropagation — ChatGPT keeps native composer/upload handling.
 * Does not scrape messages or rewrite layout beyond a temporary outline.
 */
const GUEST_DND_HELPER = `(() => {
  if (window.__mikoDndHl) return 'already';
  window.__mikoDndHl = true;
  const style = document.createElement('style');
  style.setAttribute('data-miko-dnd', '1');
  style.textContent =
    'html.miko-dnd-active{outline:3px solid rgba(110,220,230,0.9);outline-offset:-3px;}' +
    'html.miko-dnd-active body::after{content:"Drop into the ChatGPT composer";position:fixed;left:50%;top:12px;' +
    'transform:translateX(-50%);z-index:2147483646;pointer-events:none;padding:6px 12px;border-radius:999px;' +
    'background:rgba(14,18,24,0.92);color:#6edce6;font:600 12px/1.2 system-ui,sans-serif;' +
    'box-shadow:0 8px 24px rgba(0,0,0,0.35);}';
  document.documentElement.appendChild(style);
  let depth = 0;
  const clear = () => {
    depth = 0;
    document.documentElement.classList.remove('miko-dnd-active');
  };
  const enter = () => {
    depth += 1;
    document.documentElement.classList.add('miko-dnd-active');
  };
  const leave = () => {
    depth = Math.max(0, depth - 1);
    if (!depth) document.documentElement.classList.remove('miko-dnd-active');
  };
  document.addEventListener('dragenter', () => enter(), false);
  document.addEventListener('dragleave', () => leave(), false);
  document.addEventListener('drop', (event) => {
    clear();
    try {
      const dt = event.dataTransfer;
      const kinds = [];
      if (dt) {
        if (dt.types && [...dt.types].includes('Files')) kinds.push('files');
        if (dt.types && ([...dt.types].includes('text/plain') || [...dt.types].includes('Text'))) kinds.push('text');
        if (dt.types && [...dt.types].includes('text/uri-list')) kinds.push('uri');
        if (dt.files && dt.files.length) kinds.push('filecount:' + dt.files.length);
      }
      console.info('[miko-dnd] drop ' + kinds.join(','));
    } catch (_) {
      console.info('[miko-dnd] drop');
    }
  }, false);
  document.addEventListener('dragend', () => clear(), false);
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') clear();
  }, true);
  return 'ok';
})()`

function installGuestDragHelper(wc: Electron.WebContents): void {
  if (wc.isDestroyed()) return
  void wc.executeJavaScript(GUEST_DND_HELPER, true).catch(() => undefined)
}

function setDropNote(note: string): void {
  lastDropNote = note.slice(0, 200)
  if (dropNoteClearTimer) clearTimeout(dropNoteClearTimer)
  dropNoteClearTimer = setTimeout(() => {
    lastDropNote = ''
    postChromeState()
  }, 4500)
  postChromeState()
}

export function setChatGptWebChromeDragActive(active: boolean): void {
  chromeDragActive = active === true
  if (chromeDragClearTimer) {
    clearTimeout(chromeDragClearTimer)
    chromeDragClearTimer = null
  }
  if (chromeDragActive) {
    // Safety: never leave chromeDragActive stuck (would skip pet raise forever).
    chromeDragClearTimer = setTimeout(() => {
      chromeDragActive = false
      chromeDragClearTimer = null
    }, 4000)
  }
}

function offerOutsideLink(url: string, via: 'new-window' | 'navigate' | 'redirect'): void {
  blockedLink = { url: url.slice(0, 2000), host: hostOf(url) }
  logDiag('gpt', 'link outside the workspace held for the user', { via, host: blockedLink.host })
  postChromeState()
}

/** The chrome's explicit “Open in browser” for a held outside link. */
export async function openChatGptWebBlockedLink(): Promise<boolean> {
  const link = blockedLink
  blockedLink = null
  postChromeState()
  if (!link) return false
  logDiag('gpt', 'user opened outside link in browser', { host: link.host })
  try {
    await shell.openExternal(link.url)
    return true
  } catch {
    return false
  }
}

export function dismissChatGptWebBlockedLink(): boolean {
  blockedLink = null
  postChromeState()
  return true
}

/** Retry after a load error: reload the page, or start at chatgpt.com when there is none. */
export function retryChatGptWebLoad(): boolean {
  if (!guest || guest.webContents.isDestroyed()) return false
  loadError = ''
  postChromeState()
  const url = guest.webContents.getURL()
  logDiag('gpt', 'retry load', { host: hostOf(url || CHATGPT_WEB_HOME) })
  if (url && urlAllowed(url)) guest.webContents.reload()
  else void guest.webContents.loadURL(CHATGPT_WEB_HOME).catch(() => undefined)
  return true
}

/** Explicit, labelled fallback: the current ChatGPT page in the default browser. */
export async function openChatGptWebInBrowser(): Promise<boolean> {
  const current = guest && !guest.webContents.isDestroyed() ? guest.webContents.getURL() : ''
  const url = current && urlAllowed(current) ? current : CHATGPT_WEB_HOME
  logDiag('gpt', 'user chose Open in browser', { host: hostOf(url) })
  try {
    await shell.openExternal(url)
    return true
  } catch {
    return false
  }
}

function wireGuest(wc: Electron.WebContents): void {
  wc.on('will-attach-webview', (event) => {
    event.preventDefault()
  })

  wc.setWindowOpenHandler(({ url }) => {
    if (!urlAllowed(url)) {
      offerOutsideLink(url, 'new-window')
      return { action: 'deny' }
    }
    const opts: BrowserWindowConstructorOptions = {
      width: 520,
      height: 740,
      title: 'MIKO · ChatGPT · sign-in',
      webPreferences: {
        session: guestSession(),
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
        allowRunningInsecureContent: false,
        navigateOnDragDrop: false,
        plugins: false
      }
    }
    return { action: 'allow', overrideBrowserWindowOptions: opts }
  })

  // Never navigate the workspace to a dropped file/image/URL.
  wc.on('will-navigate', (event, url) => {
    if (!urlAllowed(url)) {
      event.preventDefault()
      // Do not offer file:// drops — that would look like “opening” the attachment.
      if (/^https?:/i.test(url)) offerOutsideLink(url, 'navigate')
      return
    }
  })

  wc.on('will-redirect', (event, url) => {
    if (!urlAllowed(url)) {
      event.preventDefault()
      if (/^https?:/i.test(url)) offerOutsideLink(url, 'redirect')
    }
  })

  wc.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    // -3 = aborted (a navigation replaced another, or we blocked it) — not a failure.
    if (!isMainFrame || errorCode === -3) return
    loadError = `${errorDescription || 'Load failed'} (${errorCode})`
    logDiag('gpt', 'guest load failed', { code: errorCode, error: errorDescription, host: hostOf(validatedURL) })
    postChromeState()
  })

  wc.on('render-process-gone', (_event, details) => {
    loadError = `The ChatGPT page stopped (${details.reason})`
    logDiag('gpt', 'guest renderer gone', { reason: details.reason, exitCode: details.exitCode })
    postChromeState()
  })

  wc.on('did-finish-load', () => {
    if (loadError) {
      loadError = ''
      postChromeState()
    }
    logDiag('gpt', 'guest loaded', { host: hostOf(wc.getURL()) })
    persistGuestUrl()
    installGuestDragHelper(wc)
  })
  wc.on('did-navigate', () => {
    persistGuestUrl()
    installGuestDragHelper(wc)
  })
  wc.on('did-navigate-in-page', () => persistGuestUrl())

  // Neutral drop feedback only — no file paths, tokens, or message content.
  wc.on('console-message', (...args: unknown[]) => {
    let message = ''
    const second = args[1]
    if (second && typeof second === 'object' && 'message' in second) {
      message = String((second as { message: unknown }).message ?? '')
    } else if (typeof args[2] === 'string') {
      message = args[2]
    }
    if (!message.startsWith('[miko-dnd] drop')) return
    const kinds = message.slice('[miko-dnd] drop'.length).trim()
    if (kinds.includes('files') || kinds.includes('filecount')) {
      setDropNote('Dropped into ChatGPT—check the attachment preview.')
    } else if (kinds.includes('text') || kinds.includes('uri')) {
      setDropNote('Dropped into ChatGPT—check the composer (not sent).')
    } else {
      setDropNote('Dropped into ChatGPT—check the composer or attachment preview.')
    }
  })
}

function resolveOpenBounds(): Rect {
  const work = workAreaNearPet()
  const saved = expandedBounds ?? chatgptWebBoundsSetting()
  if (saved) {
    const fitted = clampBounds(
      {
        x: saved.x,
        y: saved.y,
        width: clamp(saved.width, MIN_SIZE.width, work.width),
        height: clamp(saved.height, MIN_SIZE.height, work.height)
      },
      work
    )
    return nudgeClearOfPet(fitted, work)
  }
  return placeBesidePet(DEFAULT_SIZE, work)
}

function ensureWindow(): BrowserWindow {
  if (win && !win.isDestroyed()) return win
  configureGuestSession()
  pinned = chatgptWebPinnedSetting()
  const initial = resolveOpenBounds()
  expandedBounds = initial
  collapsed = false
  dismissedHidden = false

  const created = new BrowserWindow({
    x: initial.x,
    y: initial.y,
    width: initial.width,
    height: initial.height,
    minWidth: MIN_SIZE.width,
    minHeight: MIN_SIZE.height,
    show: false,
    title: 'MIKO · ChatGPT',
    backgroundColor: '#0e1218',
    autoHideMenuBar: true,
    alwaysOnTop: pinned,
    resizable: true,
    movable: true,
    minimizable: false,
    maximizable: true,
    fullscreenable: false,
    skipTaskbar: false,
    acceptFirstMouse: true,
    webPreferences: {
      preload: join(__dirname, '../preload/chatgpt-web.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      navigateOnDragDrop: false,
      experimentalFeatures: false,
      spellcheck: false,
      devTools: !app.isPackaged
    }
  })
  win = created
  hardenWindow(created)
  applyPin(created)

  // Chrome itself must never navigate to a dropped file/URL.
  created.webContents.on('will-navigate', (event, url) => {
    try {
      const allowed =
        url === chromeUrl() ||
        url.startsWith(rendererDirUrl()) ||
        (!app.isPackaged && Boolean(process.env['ELECTRON_RENDERER_URL']) && url.startsWith(process.env['ELECTRON_RENDERER_URL'] || ''))
      if (!allowed) event.preventDefault()
    } catch {
      event.preventDefault()
    }
  })

  const view = new WebContentsView({
    webPreferences: {
      session: guestSession(),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      // Critical: drops must attach/insert in-page, never navigate the guest away.
      navigateOnDragDrop: false,
      experimentalFeatures: false,
      plugins: false
    }
  })
  guest = view
  created.contentView.addChildView(view)
  wireGuest(view.webContents)
  layoutGuest()
  created.on('resize', () => {
    layoutGuest()
    persistBoundsSoon()
  })
  created.on('move', persistBoundsSoon)
  created.on('maximize', layoutGuest)
  created.on('unmaximize', layoutGuest)

  // After ChatGPT loses window focus, gently keep the companion above it — debounced
  // so we don’t fight focus or leave a transparent sink on top of the panel.
  created.on('blur', () => {
    if (chromeDragActive) return
    if (raisePetFromBlurTimer) clearTimeout(raisePetFromBlurTimer)
    raisePetFromBlurTimer = setTimeout(() => {
      raisePetFromBlurTimer = null
      if (!win || win.isDestroyed() || chromeDragActive) return
      // Only raise when the workspace is still visible; restore pointer so clicks work.
      if (win.isVisible()) {
        raisePetWindow()
        restorePetPointerState()
      }
    }, 120)
  })

  const onDisplayChange = (): void => {
    if (!win || win.isDestroyed()) return
    const work = workAreaNearPet()
    if (collapsed) {
      win.setBounds(clampBounds(pillBounds(), work), false)
      return
    }
    const cur = win.getBounds()
    const next = nudgeClearOfPet(
      {
        x: cur.x,
        y: cur.y,
        width: clamp(cur.width, MIN_SIZE.width, work.width),
        height: clamp(cur.height, MIN_SIZE.height, work.height)
      },
      work
    )
    win.setBounds(next, false)
    expandedBounds = next
  }
  screen.on('display-metrics-changed', onDisplayChange)
  screen.on('display-added', onDisplayChange)
  screen.on('display-removed', onDisplayChange)

  created.on('closed', () => {
    invalidatePendingTransfers()
    screen.removeListener('display-metrics-changed', onDisplayChange)
    screen.removeListener('display-added', onDisplayChange)
    screen.removeListener('display-removed', onDisplayChange)
    persistGuestUrl()
    if (win === created) win = null
    guest = null
    collapsed = false
    dismissedHidden = false
    loadError = ''
    blockedLink = null
  })

  created.once('ready-to-show', () => {
    if (!created.isDestroyed() && !collapsed && !dismissedHidden) {
      created.showInactive()
      raisePetWindow()
    }
  })

  const resumeUrl = chatgptWebLastUrlSetting()
  const startUrl = resumeUrl && urlAllowed(resumeUrl) ? resumeUrl : CHATGPT_WEB_HOME
  logDiag('gpt', 'workspace window created', { start: hostOf(startUrl) })
  void created.loadURL(chromeUrl()).catch((error: unknown) => {
    logDiag('gpt', 'chrome page failed to load', { error: String(error) })
  })
  // Preserve guest session: only load start URL for a fresh guest.
  // Failures surface through did-fail-load (error + Retry in the chrome), never a browser fallback.
  void view.webContents.loadURL(startUrl).catch(() => undefined)
  return created
}

function keepPetCompanionVisible(): void {
  // Pet stays visible beside the workspace; raise so it isn’t buried under the same floating band.
  raisePetWindow()
}

function showGently(created: BrowserWindow, focus: boolean): void {
  if (created.isDestroyed()) return
  dismissedHidden = false
  if (focus) {
    const now = Date.now()
    if (created.isVisible() && created.isFocused() && now - lastFocusAt < 500) {
      layoutGuest()
      keepPetCompanionVisible()
      return
    }
    created.show()
    // Focus the guest page for typing/scroll without a pin activation loop.
    if (guest && !guest.webContents.isDestroyed()) guest.webContents.focus()
    else created.focus()
    lastFocusAt = now
  } else {
    created.showInactive()
  }
  layoutGuest()
  keepPetCompanionVisible()
}

/**
 * Open or focus the single Interactive GPT workspace beside the pet.
 * Does not enable GPT Mode forwarding or create a second pet.
 */
export function openChatGptWebWindow(opts?: { focus?: boolean; placeFresh?: boolean }): void {
  const focus = opts?.focus !== false
  const created = ensureWindow()
  if (opts?.placeFresh || !expandedBounds) {
    const next = resolveOpenBounds()
    if (!collapsed) {
      created.setBounds(next, false)
      expandedBounds = next
    }
  } else if (!collapsed) {
    // Reopening: keep saved size/pos but clear pet overlap.
    const cleared = nudgeClearOfPet(created.getBounds(), workAreaNearPet())
    created.setBounds(cleared, false)
    expandedBounds = cleared
  }
  if (collapsed) {
    expandChatGptWebWindow(focus)
    return
  }
  showGently(created, focus)
}

/**
 * Hide workspace/pill for dismiss without destroying the session (no logout).
 */
function invalidatePendingTransfers(): void {
  chromeDragActive = false
  lastDropNote = ''
  dictateArmed = false
  if (talkArmed) {
    talkArmed = false
    postToPet(IPC.uiHint, { talkToGpt: false })
  }
  cancelChatGptWebSubmit()
  if (dropNoteClearTimer) {
    clearTimeout(dropNoteClearTimer)
    dropNoteClearTimer = null
  }
  if (chromeDragClearTimer) {
    clearTimeout(chromeDragClearTimer)
    chromeDragClearTimer = null
  }
  if (raisePetFromBlurTimer) {
    clearTimeout(raisePetFromBlurTimer)
    raisePetFromBlurTimer = null
  }
  restorePetPointerState()
}

/** Arm/disarm one-shot voice dictation into Interactive GPT (never auto-arms by merely opening). */
export function setChatGptWebDictateArmed(armed: boolean): boolean {
  dictateArmed = armed === true
  postChromeState()
  postToPet(IPC.uiHint, { dictateToGpt: dictateArmed })
  return dictateArmed
}

export function isChatGptWebDictateArmed(): boolean {
  return dictateArmed
}

/** Talk to GPT on/off. Turning it on cancels a one-shot Dictate (they'd compete for the next sentence). */
export function setChatGptWebTalkArmed(armed: boolean): boolean {
  talkArmed = armed === true && isChatGptWebOpen()
  if (talkArmed && dictateArmed) {
    dictateArmed = false
    postToPet(IPC.uiHint, { dictateToGpt: false })
  }
  postChromeState()
  postToPet(IPC.uiHint, { talkToGpt: talkArmed })
  return talkArmed
}

function chatgptMicOrigin(url: string): boolean {
  try {
    const host = new URL(url).hostname
    return host === 'chatgpt.com' || host.endsWith('.chatgpt.com')
  } catch {
    return false
  }
}

export function hideChatGptWebSurfaces(): void {
  if (!win || win.isDestroyed()) return
  persistGuestUrl()
  invalidatePendingTransfers()
  if (!collapsed && win.isVisible()) {
    expandedBounds = win.getBounds()
    setChatgptWebBoundsSetting(expandedBounds)
  }
  dismissedHidden = true
  if (win.isVisible()) win.hide()
}

export function closeChatGptWebWindow(): void {
  if (!win || win.isDestroyed()) return
  persistGuestUrl()
  invalidatePendingTransfers()
  if (!collapsed) {
    expandedBounds = win.getBounds()
    setChatgptWebBoundsSetting(expandedBounds)
  }
  win.close()
  // Closing the workspace must leave the pet visible and clickable.
  keepPetCompanionVisible()
  restorePetPointerState()
}

export function collapseChatGptWebWindow(): boolean {
  if (!win || win.isDestroyed()) return false
  if (!collapsed) {
    expandedBounds = win.getBounds()
    setChatgptWebBoundsSetting(expandedBounds)
    persistGuestUrl()
  }
  collapsed = true
  dismissedHidden = false
  if (dictateArmed) {
    dictateArmed = false
    postToPet(IPC.uiHint, { dictateToGpt: false })
  }
  win.setResizable(false)
  win.setMinimumSize(PILL.width, PILL.height)
  win.setBounds(pillBounds(), true)
  layoutGuest()
  win.showInactive()
  keepPetCompanionVisible()
  restorePetPointerState()
  postChromeState()
  return true
}

export function expandChatGptWebWindow(focus = true): boolean {
  if (!win || win.isDestroyed()) return false
  collapsed = false
  dismissedHidden = false
  win.setResizable(true)
  win.setMinimumSize(MIN_SIZE.width, MIN_SIZE.height)
  const work = workAreaNearPet()
  const restore = expandedBounds
    ? nudgeClearOfPet(
        {
          x: expandedBounds.x,
          y: expandedBounds.y,
          width: clamp(expandedBounds.width, MIN_SIZE.width, work.width),
          height: clamp(expandedBounds.height, MIN_SIZE.height, work.height)
        },
        work
      )
    : placeBesidePet(DEFAULT_SIZE, work)
  win.setBounds(restore, true)
  expandedBounds = restore
  layoutGuest()
  showGently(win, focus)
  postChromeState()
  return true
}

export function setChatGptWebPinned(next: boolean): boolean {
  pinned = next === true
  setChatgptWebPinnedSetting(pinned)
  if (win && !win.isDestroyed()) applyPin(win)
  keepPetCompanionVisible()
  postChromeState()
  return pinned
}

export function isChatGptWebPinned(): boolean {
  return pinned
}

export function setChatGptWebChromeHeight(height: number): void {
  chromeHeight = Math.max(32, Math.min(100, Math.round(height)))
  layoutGuest()
}

export function chatgptWebCanGoBack(): boolean {
  return !collapsed && guest?.webContents.navigationHistory.canGoBack() === true
}

export function chatgptWebCanGoForward(): boolean {
  return !collapsed && guest?.webContents.navigationHistory.canGoForward() === true
}

export function chatgptWebBack(): boolean {
  if (!guest || !chatgptWebCanGoBack()) return false
  guest.webContents.navigationHistory.goBack()
  return true
}

export function chatgptWebForward(): boolean {
  if (!guest || !chatgptWebCanGoForward()) return false
  guest.webContents.navigationHistory.goForward()
  return true
}

export function chatgptWebReload(): boolean {
  if (!guest || collapsed) return false
  guest.webContents.reload()
  return true
}

export function chatgptWebGuestUrl(): string {
  return guest && !guest.webContents.isDestroyed() ? guest.webContents.getURL() : ''
}

export function chatgptWebGuestTitle(): string {
  return guest && !guest.webContents.isDestroyed() ? guest.webContents.getTitle() : ''
}

function guestLooksSignedOut(url: string): boolean {
  return /\/auth\b|\/login\b|accounts\.google|browser\/oauth|signin/i.test(url)
}

/**
 * Insert text into the ChatGPT composer without submitting.
 * Preserves any existing draft by inserting at the caret (or appending).
 * Never targets password / login fields.
 */
export async function chatgptWebInsertTranscript(text: string): Promise<{ ok: boolean; reason: string }> {
  const raw = text.slice(0, 8000)
  if (!raw.trim()) return { ok: false, reason: 'Nothing to insert.' }
  if (!guest || guest.webContents.isDestroyed() || collapsed || dismissedHidden) {
    return { ok: false, reason: 'Interactive GPT isn’t open.' }
  }
  const pageUrl = guest.webContents.getURL()
  if (guestLooksSignedOut(pageUrl)) {
    return { ok: false, reason: 'Sign in to ChatGPT first — won’t paste into a login page.' }
  }
  const escaped = JSON.stringify(raw)
  try {
    const result = (await guest.webContents.executeJavaScript(
      `(() => {
        const text = ${escaped};
        const nodes = [
          ...document.querySelectorAll('textarea, [contenteditable="true"]')
        ];
        const el = nodes.find((n) => {
          if (!(n instanceof HTMLElement)) return false;
          if (n instanceof HTMLInputElement && (n.type === 'password' || n.type === 'hidden')) return false;
          if (n.getAttribute('type') === 'password') return false;
          if (n.getAttribute('autocomplete') === 'current-password' || n.getAttribute('autocomplete') === 'new-password') return false;
          if (n.closest('form[action*="login"], form[action*="auth"], [data-testid*="login"]')) return false;
          const r = n.getBoundingClientRect();
          return r.width > 40 && r.height > 16;
        });
        if (!el) return { ok: false, reason: 'Composer not found — open a chat or log in first.' };
        el.focus();
        if (el instanceof HTMLTextAreaElement) {
          const start = typeof el.selectionStart === 'number' ? el.selectionStart : el.value.length;
          const end = typeof el.selectionEnd === 'number' ? el.selectionEnd : start;
          const before = el.value.slice(0, start);
          const after = el.value.slice(end);
          el.value = before + text + after;
          const caret = start + text.length;
          try { el.setSelectionRange(caret, caret); } catch (_) {}
          el.dispatchEvent(new Event('input', { bubbles: true }));
          return { ok: true, reason: 'Inserted into composer (not sent; draft preserved).' };
        }
        try {
          const ok = document.execCommand('insertText', false, text);
          if (ok) {
            el.dispatchEvent(new InputEvent('input', { bubbles: true, data: text, inputType: 'insertText' }));
            return { ok: true, reason: 'Inserted into composer (not sent; draft preserved).' };
          }
        } catch (_) {}
        // Fallback: append without wiping an existing draft.
        const current = el.textContent || '';
        el.textContent = current ? current + text : text;
        el.dispatchEvent(new InputEvent('input', { bubbles: true, data: text, inputType: 'insertText' }));
        return { ok: true, reason: 'Inserted into composer (not sent; draft preserved).' };
      })()`,
      true
    )) as { ok?: boolean; reason?: string }
    return {
      ok: result?.ok === true,
      reason: typeof result?.reason === 'string' ? result.reason : 'Insert finished.'
    }
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message.slice(0, 200) : 'Insert failed.'
    }
  }
}

function readComposerScript(): string {
  return `(() => {
    const nodes = [...document.querySelectorAll('textarea, [contenteditable="true"]')];
    const el = nodes.find((n) => {
      if (!(n instanceof HTMLElement)) return false;
      if (n instanceof HTMLInputElement && (n.type === 'password' || n.type === 'hidden')) return false;
      if (n.getAttribute('type') === 'password') return false;
      if (n.closest('form[action*="login"], form[action*="auth"], [data-testid*="login"]')) return false;
      const r = n.getBoundingClientRect();
      return r.width > 40 && r.height > 16;
    });
    if (!el) return { ok: false, text: '', reason: 'Composer not found.' };
    const text = el instanceof HTMLTextAreaElement ? el.value : (el.innerText || el.textContent || '');
    return { ok: true, text: String(text || ''), reason: 'ok' };
  })()`
}

/**
 * Submit the current Interactive GPT composer once after verifying it has a draft.
 * Never retries. Cancel / generation bump aborts without a second press.
 */
export async function chatgptWebSubmitCurrentDraft(opts?: {
  expectedText?: string
  generation?: number
}): Promise<ChatGptWebSubmitResult> {
  const gen = opts?.generation ?? submitGeneration
  const finish = (
    status: ChatGptWebSubmitStatus,
    reason: string,
    composerText = '',
    ok = false
  ): ChatGptWebSubmitResult => ({ ok, status, reason, composerText })

  if (gen !== submitGeneration) {
    return finish('cancelled', 'Cancelled before submit.')
  }
  if (!guest || guest.webContents.isDestroyed() || collapsed || dismissedHidden) {
    return finish('unavailable', 'Interactive GPT isn’t open.')
  }
  const pageUrl = guest.webContents.getURL()
  if (guestLooksSignedOut(pageUrl)) {
    return finish('unavailable', 'Sign in to ChatGPT first — won’t submit on a login page.')
  }

  let before: { ok?: boolean; text?: string; reason?: string }
  try {
    before = (await guest.webContents.executeJavaScript(readComposerScript(), true)) as {
      ok?: boolean
      text?: string
      reason?: string
    }
  } catch (err) {
    return finish(
      'failed',
      err instanceof Error ? err.message.slice(0, 200) : 'Could not read the composer.'
    )
  }
  if (gen !== submitGeneration) return finish('cancelled', 'Cancelled before submit.')

  const composerText = String(before?.text || '')
  const trimmed = composerText.replace(/\s+/g, ' ').trim()
  if (!before?.ok || !trimmed) {
    return finish('empty', 'Composer is empty — nothing to send.', composerText)
  }

  const expected = String(opts?.expectedText || '')
    .replace(/\s+/g, ' ')
    .trim()
  if (expected) {
    const live = trimmed
    if (!(live === expected || live.endsWith(expected) || live.includes(expected))) {
      return finish(
        'changed',
        'The ChatGPT draft changed since MIKO inserted it — confirm before sending.',
        composerText
      )
    }
  }

  // Click Send once (preferred) or Cmd/Ctrl+Enter once — never retry.
  let pressed = false
  try {
    const click = (await guest.webContents.executeJavaScript(
      `(() => {
        const buttons = [...document.querySelectorAll('button')];
        const send = buttons.find((b) => {
          if (!(b instanceof HTMLButtonElement)) return false;
          if (b.disabled) return false;
          const label = ((b.getAttribute('aria-label') || '') + ' ' + (b.textContent || '')).toLowerCase();
          const testId = (b.getAttribute('data-testid') || '').toLowerCase();
          if (/stop|cancel|upload|attach|voice|mic|speech/.test(label + testId)) return false;
          return (
            testId.includes('send') ||
            /\\bsend\\b/.test(label) ||
            b.getAttribute('data-testid') === 'send-button'
          );
        });
        if (send) {
          send.click();
          return { ok: true, via: 'button' };
        }
        const nodes = [...document.querySelectorAll('textarea, [contenteditable="true"]')];
        const el = nodes.find((n) => n instanceof HTMLElement && n.getBoundingClientRect().height > 16);
        if (!el) return { ok: false, via: 'none' };
        el.focus();
        const isMac = /mac/i.test(navigator.platform || '');
        const ev = new KeyboardEvent('keydown', {
          key: 'Enter',
          code: 'Enter',
          keyCode: 13,
          which: 13,
          bubbles: true,
          cancelable: true,
          metaKey: isMac,
          ctrlKey: !isMac
        });
        el.dispatchEvent(ev);
        return { ok: true, via: 'enter' };
      })()`,
      true
    )) as { ok?: boolean; via?: string }
    pressed = click?.ok === true
  } catch (err) {
    return finish(
      'failed',
      err instanceof Error ? err.message.slice(0, 200) : 'Submit gesture failed.',
      composerText
    )
  }

  if (gen !== submitGeneration) {
    return finish(
      'delivery-unverified',
      'Cancel requested after submit may have fired. Check Interactive GPT — MIKO won’t press Send again.',
      composerText
    )
  }
  if (!pressed) {
    return finish('failed', 'Couldn’t find a Send control in Interactive GPT.', composerText)
  }

  await new Promise((resolve) => setTimeout(resolve, 700))
  if (gen !== submitGeneration) {
    return finish(
      'delivery-unverified',
      'Cancel requested after submit may have fired. Check Interactive GPT — MIKO won’t press Send again.',
      composerText
    )
  }

  let afterText = composerText
  try {
    const after = (await guest.webContents.executeJavaScript(readComposerScript(), true)) as {
      text?: string
    }
    afterText = String(after?.text || '')
  } catch {
    /* observation failed — stay unverified */
  }

  const afterTrim = afterText.replace(/\s+/g, ' ').trim()
  if (!afterTrim || afterTrim.length + 8 < trimmed.length) {
    return finish(
      'submitted-observed',
      'Submitted in Interactive GPT (composer cleared or shortened after Send).',
      afterText,
      true
    )
  }
  return finish(
    'delivery-unverified',
    'Send was pressed once in Interactive GPT, but delivery isn’t verified — check the chat. MIKO won’t press Send again.',
    afterText
  )
}

/** Invalidate in-flight Interactive GPT submits (cancel / dismiss / source change). */
export function cancelChatGptWebSubmit(): void {
  submitGeneration += 1
}

export function chatgptWebSubmitGeneration(): number {
  return submitGeneration
}

/**
 * Explicit one-shot: read clipboard text and insert into Interactive GPT (opens/restores if needed).
 * Does not monitor the clipboard and does not upload files automatically.
 */
export async function chatgptWebPasteClipboard(): Promise<{ ok: boolean; reason: string; text?: string }> {
  const raw = String(clipboard.readText() || '').slice(0, 8000)
  if (!raw.trim()) {
    return { ok: false, reason: 'Clipboard has no text. Copy a WhatsApp message (or other text), then try again.' }
  }
  if (!isChatGptWebOpen() || dismissedHidden) {
    openChatGptWebWindow({ focus: true })
  } else if (collapsed) {
    expandChatGptWebWindow(true)
  } else {
    openChatGptWebWindow({ focus: true })
  }
  // Guest may need a beat after expand/open before the composer is hittable.
  await new Promise((resolve) => setTimeout(resolve, 350))
  if (!guest || guest.webContents.isDestroyed()) {
    return { ok: false, reason: 'Interactive GPT didn’t open.' }
  }
  const inserted = await chatgptWebInsertTranscript(raw)
  return { ...inserted, text: raw }
}

export function isChatGptWebSender(senderId: number): boolean {
  return Boolean(win && !win.isDestroyed() && win.webContents.id === senderId)
}

export function chatgptWebStatus(): {
  open: boolean
  collapsed: boolean
  pinned: boolean
  visible: boolean
  url: string
  title: string
  canGoBack: boolean
  canGoForward: boolean
  downloadNote: string
  dropNote: string
  dictateArmed: boolean
  talkArmed: boolean
  partition: string
  label: string
  loadError: string
  blockedHost: string
} {
  const visible = Boolean(win && !win.isDestroyed() && win.isVisible())
  return {
    open: isChatGptWebOpen(),
    collapsed,
    pinned,
    visible,
    url: chatgptWebGuestUrl(),
    title: chatgptWebGuestTitle(),
    canGoBack: chatgptWebCanGoBack(),
    canGoForward: chatgptWebCanGoForward(),
    downloadNote: lastDownloadNote,
    dropNote: lastDropNote,
    dictateArmed,
    talkArmed,
    partition: PARTITION,
    label: 'MIKO · ChatGPT',
    loadError,
    blockedHost: blockedLink?.host ?? ''
  }
}

/** Expand from collapsed pill while an OS drag is held (hover ~600ms in chrome). */
export function expandChatGptWebFromDrag(): boolean {
  if (!win || win.isDestroyed()) return false
  if (!collapsed) return true
  return expandChatGptWebWindow(false)
}

function postChromeState(): void {
  if (!win || win.isDestroyed()) return
  win.webContents.send('miko:chatgpt-web-state', chatgptWebStatus())
}
