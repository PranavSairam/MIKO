import { spawn } from 'node:child_process'
import { app, nativeImage } from 'electron'
import {
  BROWSER_BUNDLES,
  orderByWindows,
  parseRunning,
  parseTabs,
  type BrowserId,
  type BrowserTab,
  type SwitcherApp
} from '../shared/switcher'

/**
 * Running apps for the switcher (macOS). Reads names, bundle ids, paths and
 * on-screen window order only; nothing is stored. Browsers are never
 * launched to read tabs: a browser must already be in the last listing.
 */

const HELPER_NAMES = new Set(['MIKO', 'MIKO Listen', 'MIKO Keys', 'Electron'])
const ICON_SIZE = 128
const iconCache = new Map<string, string>()
let lastListing = new Map<number, SwitcherApp>()

const LIST_SCRIPT = `
ObjC.import('AppKit')
ObjC.import('CoreGraphics')
function run() {
  const apps = $.NSWorkspace.sharedWorkspace.runningApplications
  const out = []
  for (let i = 0; i < apps.count; i++) {
    const a = apps.objectAtIndex(i)
    if (a.activationPolicy !== $.NSApplicationActivationPolicyRegular) continue
    const url = a.bundleURL
    out.push({ pid: a.processIdentifier, name: ObjC.unwrap(a.localizedName) || '', bundleId: ObjC.unwrap(a.bundleIdentifier) || '',
      path: url.isNil() ? '' : (ObjC.unwrap(url.path) || ''), hidden: a.hidden, active: a.active })
  }
  const info = ObjC.deepUnwrap(ObjC.castRefToObject($.CGWindowListCopyWindowInfo($.kCGWindowListOptionOnScreenOnly | $.kCGWindowListExcludeDesktopElements, 0))) || []
  const front = info.filter((w) => w.kCGWindowLayer === 0).map((w) => w.kCGWindowOwnerPID)
  return JSON.stringify({ apps: out, front })
}`

const QUIT_SCRIPT = `
ObjC.import('AppKit')
function run(argv) {
  const a = $.NSRunningApplication.runningApplicationWithProcessIdentifier(Number(argv[0]))
  if (!a || a.isNil()) return 'gone'
  return a.terminate ? 'ok' : 'no'
}`

const TAB_SCRIPTS: Record<BrowserId, { list: string; focus: string }> = {
  chrome: {
    list: `function run() {
  const c = Application('Google Chrome'); const out = []
  c.windows().forEach((w, wi) => { const t = w.tabs.title(), u = w.tabs.url()
    t.forEach((title, ti) => out.push({ window: wi + 1, tab: ti + 1, title: title || '', url: u[ti] || '' })) })
  return JSON.stringify(out) }`,
    focus: `function run(argv) {
  const c = Application('Google Chrome'); const w = c.windows[Number(argv[0]) - 1]
  w.activeTabIndex = Number(argv[1]); w.index = 1; c.activate(); return 'ok' }`
  },
  safari: {
    list: `function run() {
  const s = Application('Safari'); const out = []
  s.windows().forEach((w, wi) => { let t = [], u = []; try { t = w.tabs.name(); u = w.tabs.url() } catch (e) { return }
    t.forEach((title, ti) => out.push({ window: wi + 1, tab: ti + 1, title: title || '', url: u[ti] || '' })) })
  return JSON.stringify(out) }`,
    focus: `function run(argv) {
  const s = Application('Safari'); const w = s.windows[Number(argv[0]) - 1]
  w.currentTab = w.tabs[Number(argv[1]) - 1]; w.index = 1; s.activate(); return 'ok' }`
  }
}

export async function listRunning(): Promise<SwitcherApp[]> {
  if (process.platform !== 'darwin') return []
  const result = await jxa(LIST_SCRIPT, [], 4000)
  if (!result.ok) return []
  let parsed: { apps?: unknown; front?: unknown }
  try {
    parsed = JSON.parse(result.out) as { apps?: unknown; front?: unknown }
  } catch {
    return []
  }
  const running = parseRunning(JSON.stringify(parsed.apps ?? [])).filter(
    (item) => item.pid !== process.pid && !HELPER_NAMES.has(item.name)
  )
  const front = Array.isArray(parsed.front) ? parsed.front.filter((pid): pid is number => Number.isInteger(pid)) : []
  const ordered = orderByWindows(running, front)
  const listing = await Promise.all(ordered.map(async (item) => ({ ...item, icon: await iconFor(item.path) })))
  lastListing = new Map(listing.map((item) => [item.pid, item]))
  return listing
}

/** Bring a listed app forward. LaunchServices (`open -a`) also unhides it and is not blocked by activation rules. */
export async function focusPid(pid: number): Promise<boolean> {
  const target = lastListing.get(pid)
  if (!target || !target.path.endsWith('.app')) return false
  return run('/usr/bin/open', ['-a', target.path], 4000).then((result) => result.ok)
}

/** Polite quit: the app's own save prompts still protect unsaved work. */
export async function quitPid(pid: number): Promise<boolean> {
  if (!lastListing.has(pid)) return false
  const result = await jxa(QUIT_SCRIPT, [String(pid)], 4000)
  if (result.ok) lastListing.delete(pid)
  return result.ok && result.out.trim() === 'ok'
}

export async function listTabs(browser: BrowserId): Promise<{ ok: boolean; tabs: BrowserTab[]; reason: string }> {
  const name = browser === 'chrome' ? 'Chrome' : 'Safari'
  if (!isListed(browser)) return { ok: false, tabs: [], reason: `${name} isn’t open.` }
  const result = await jxa(TAB_SCRIPTS[browser].list, [], 6000)
  if (!result.ok) {
    return {
      ok: false,
      tabs: [],
      reason: `I can’t read ${name}’s tabs yet. Allow it under System Settings → Privacy & Security → Automation.`
    }
  }
  const tabs = parseTabs(result.out)
  return { ok: true, tabs, reason: tabs.length === 0 ? `${name} has no open tabs.` : '' }
}

export async function focusTab(browser: BrowserId, window: number, tab: number): Promise<boolean> {
  if (!isListed(browser)) return false
  if (!Number.isInteger(window) || !Number.isInteger(tab) || window < 1 || tab < 1 || window > 500 || tab > 5000) {
    return false
  }
  const result = await jxa(TAB_SCRIPTS[browser].focus, [String(window), String(tab)], 4000)
  return result.ok
}

function isListed(browser: BrowserId): boolean {
  const bundle = BROWSER_BUNDLES[browser]
  for (const item of lastListing.values()) if (item.bundleId === bundle) return true
  return false
}

async function iconFor(path: string): Promise<string> {
  if (!path) return ''
  const cached = iconCache.get(path)
  if (cached !== undefined) return cached
  let url = ''
  try {
    const image = await nativeImage.createThumbnailFromPath(path, { width: ICON_SIZE, height: ICON_SIZE })
    if (!image.isEmpty()) url = image.toDataURL()
  } catch {
    // Fall through to the generic file icon.
  }
  if (!url) {
    try {
      url = (await app.getFileIcon(path, { size: 'normal' })).toDataURL()
    } catch {
      url = ''
    }
  }
  iconCache.set(path, url)
  return url
}

function jxa(script: string, args: string[], timeoutMs: number): Promise<{ ok: boolean; out: string }> {
  return run('/usr/bin/osascript', ['-l', 'JavaScript', '-e', script, ...args], timeoutMs)
}

function run(command: string, args: string[], timeoutMs: number): Promise<{ ok: boolean; out: string }> {
  return new Promise((resolve) => {
    const proc = spawn(command, args, { shell: false, stdio: ['ignore', 'pipe', 'ignore'] })
    let out = ''
    let settled = false
    const done = (ok: boolean): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ ok, out })
    }
    const timer = setTimeout(() => {
      proc.kill('SIGTERM')
      done(false)
    }, timeoutMs)
    proc.stdout?.on('data', (chunk: Buffer) => {
      if (out.length < 2_000_000) out += chunk.toString('utf8')
    })
    proc.once('error', () => done(false))
    proc.once('close', (code) => done(code === 0))
  })
}
