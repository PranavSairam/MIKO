/** Running-app switcher: data shapes, ordering, filtering and the card arc. Pure, no Electron. */

export interface RunningApp {
  pid: number
  name: string
  bundleId: string
  path: string
  hidden: boolean
  active: boolean
}

export interface SwitcherApp extends RunningApp {
  /** data: URL of the app icon, or '' when none could be read. */
  icon: string
}

export interface BrowserTab {
  window: number
  tab: number
  title: string
  url: string
}

export type BrowserId = 'chrome' | 'safari'

export const BROWSER_BUNDLES: Record<BrowserId, string> = {
  chrome: 'com.google.Chrome',
  safari: 'com.apple.Safari'
}

export function browserFor(bundleId: string): BrowserId | null {
  if (bundleId === BROWSER_BUNDLES.chrome) return 'chrome'
  if (bundleId === BROWSER_BUNDLES.safari) return 'safari'
  return null
}

/** Apps with on-screen windows first, in front-to-back order; the rest alphabetically. */
export function orderByWindows<T extends RunningApp>(apps: T[], frontPids: number[]): T[] {
  const rank = new Map<number, number>()
  frontPids.forEach((pid) => {
    if (!rank.has(pid)) rank.set(pid, rank.size)
  })
  return [...apps].sort((a, b) => {
    const ra = rank.get(a.pid)
    const rb = rank.get(b.pid)
    if (ra !== undefined && rb !== undefined) return ra - rb
    if (ra !== undefined) return -1
    if (rb !== undefined) return 1
    return a.name.localeCompare(b.name)
  })
}

/** Case-insensitive name filter: name prefix first, then word prefix, then anywhere in the name. */
export function filterApps<T extends { name: string }>(apps: T[], query: string): T[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return apps
  const tiers: T[][] = [[], [], []]
  for (const item of apps) {
    const name = item.name.toLowerCase()
    if (name.startsWith(needle)) tiers[0].push(item)
    else if (name.split(/\s+/).some((word) => word.startsWith(needle))) tiers[1].push(item)
    else if (name.includes(needle)) tiers[2].push(item)
  }
  return tiers.flat()
}

export interface ArcSlot {
  x: number
  y: number
  /** Card tilt in degrees; 0 at the apex. */
  angle: number
  radius: number
}

const SPAN_DEG = 150
/** Angle between neighbouring cards, so a few apps sit close like a hand of cards. */
const STEP_DEG = 28
const SINGLE_ARC_MAX = 12

/**
 * Card centers fanned over MIKO like a hand of cards. One arc for up to 12
 * apps, two beyond that (outer arc holds the larger half). The arc's center
 * sits near the bottom of the area so the apex is at the top.
 */
export function arcSlots(count: number, width: number, height: number): ArcSlot[] {
  if (count <= 0) return []
  const cx = width / 2
  const cy = height * 0.95
  const outer = Math.min(height * 0.78, width * 0.46)
  if (count <= SINGLE_ARC_MAX) return ring(count, cx, cy, outer)
  const outerCount = Math.ceil(count / 2)
  return [...ring(outerCount, cx, cy, outer), ...ring(count - outerCount, cx, cy, outer * 0.6)]
}

function ring(count: number, cx: number, cy: number, radius: number): ArcSlot[] {
  const slots: ArcSlot[] = []
  for (let i = 0; i < count; i += 1) {
    const span = Math.min(SPAN_DEG, STEP_DEG * (count - 1))
    const deg = count === 1 ? 0 : -span / 2 + (span * i) / (count - 1)
    const rad = (deg * Math.PI) / 180
    slots.push({ x: cx + radius * Math.sin(rad), y: cy - radius * Math.cos(rad), angle: deg * 0.35, radius })
  }
  return slots
}

export function parseRunning(json: string): RunningApp[] {
  const rows = parseArray(json)
  const apps: RunningApp[] = []
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue
    const r = row as Record<string, unknown>
    if (!Number.isInteger(r.pid) || (r.pid as number) <= 0) continue
    if (typeof r.name !== 'string' || !r.name.trim()) continue
    apps.push({
      pid: r.pid as number,
      name: r.name.slice(0, 80),
      bundleId: typeof r.bundleId === 'string' ? r.bundleId.slice(0, 200) : '',
      path: typeof r.path === 'string' ? r.path.slice(0, 1000) : '',
      hidden: r.hidden === true,
      active: r.active === true
    })
  }
  return apps
}

export function parseTabs(json: string): BrowserTab[] {
  const tabs: BrowserTab[] = []
  for (const row of parseArray(json)) {
    if (!row || typeof row !== 'object') continue
    const r = row as Record<string, unknown>
    if (!Number.isInteger(r.window) || !Number.isInteger(r.tab)) continue
    if (typeof r.url !== 'string' || typeof r.title !== 'string') continue
    tabs.push({ window: r.window as number, tab: r.tab as number, title: r.title.slice(0, 300), url: r.url.slice(0, 2000) })
  }
  return tabs
}

function parseArray(json: string): unknown[] {
  try {
    const value: unknown = JSON.parse(json)
    return Array.isArray(value) ? value : []
  } catch {
    return []
  }
}

/** Preload for the running-apps switcher window. Main validates every pid and index again. */
export interface MikoSwitcherApi {
  list: () => Promise<SwitcherApp[]>
  focus: (pid: number) => Promise<boolean>
  quit: (pid: number) => Promise<boolean>
  tabs: (browser: BrowserId) => Promise<{ ok: boolean; tabs: BrowserTab[]; reason: string }>
  focusTab: (browser: BrowserId, window: number, tab: number) => Promise<boolean>
  close: () => void
  onOpen: (listener: () => void) => () => void
}
