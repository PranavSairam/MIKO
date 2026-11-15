/**
 * List and close Chrome/Safari tabs by host. Never quits the browser.
 */
import { hostMatchesSite, hostOf } from '../shared/context'
import type { BrowserId, BrowserTab } from '../shared/switcher'
import { closeTab, ensureBrowserListed, listTabs } from './running'

export type TabMatch = BrowserTab & { browser: BrowserId }

export type CloseWebsiteResult =
  | { status: 'closed'; closed: number; tabs: TabMatch[] }
  | { status: 'choices'; tabs: TabMatch[]; reason: string }
  | { status: 'none'; reason: string }
  | { status: 'unsupported'; reason: string }
  | { status: 'failed'; reason: string }

async function allTabs(): Promise<{ tabs: TabMatch[]; reason: string }> {
  if (process.platform !== 'darwin') {
    return { tabs: [], reason: 'Closing browser tabs isn’t available on Windows yet.' }
  }
  const out: TabMatch[] = []
  const reasons: string[] = []
  for (const browser of ['chrome', 'safari'] as BrowserId[]) {
    await ensureBrowserListed(browser)
    const listed = await listTabs(browser)
    if (!listed.ok) {
      if (listed.reason) reasons.push(listed.reason)
      continue
    }
    for (const tab of listed.tabs) out.push({ ...tab, browser })
  }
  return { tabs: out, reason: reasons[0] || '' }
}

function matchHost(tabs: TabMatch[], host: string): TabMatch[] {
  const needle = host.replace(/^www\./i, '').toLowerCase()
  return tabs.filter((t) => hostMatchesSite(hostOf(t.url), needle))
}

export async function closeWebsiteTabs(opts: {
  host?: string
  url?: string
  all?: boolean
  thisTab?: boolean
  /** Pre-chosen tab from a chooser. */
  pick?: { browser: BrowserId; window: number; tab: number }
}): Promise<CloseWebsiteResult> {
  if (process.platform !== 'darwin') {
    return { status: 'unsupported', reason: 'Closing browser tabs isn’t available on Windows yet.' }
  }

  if (opts.pick) {
    const before = await allTabs()
    const ok = await closeTab(opts.pick.browser, opts.pick.window, opts.pick.tab)
    if (!ok) return { status: 'failed', reason: 'I couldn’t close that tab.' }
    const after = await allTabs()
    const gone = before.tabs.length > after.tabs.length
    return gone
      ? { status: 'closed', closed: 1, tabs: [] }
      : { status: 'failed', reason: 'I tried to close that tab but it’s still open.' }
  }

  const listed = await allTabs()
  if (listed.tabs.length === 0) {
    return { status: 'none', reason: listed.reason || 'I don’t see any open Chrome or Safari tabs.' }
  }

  if (opts.thisTab) {
    // Best effort: active tab of the frontmost listed browser isn’t exposed here;
    // use the first Chrome active-looking tab or ask.
    return {
      status: 'choices',
      tabs: listed.tabs.slice(0, 8),
      reason: 'Which tab should I close?'
    }
  }

  const host = (opts.host || (opts.url ? hostOf(opts.url) : '')).replace(/^www\./i, '')
  if (!host) return { status: 'none', reason: 'Which website should I close?' }

  const matches = matchHost(listed.tabs, host)
  if (matches.length === 0) {
    return { status: 'none', reason: `I don’t see an open tab for ${host}.` }
  }

  if (!opts.all && matches.length > 1) {
    return {
      status: 'choices',
      tabs: matches.slice(0, 10),
      reason: `I found ${matches.length} tabs for ${host}. Which one?`
    }
  }

  // Close from the end so window/tab indices stay valid within each window.
  const ordered = [...matches].sort((a, b) => (a.browser === b.browser ? b.window - a.window || b.tab - a.tab : a.browser.localeCompare(b.browser)))
  let closed = 0
  for (const tab of ordered) {
    if (await closeTab(tab.browser, tab.window, tab.tab)) closed += 1
  }
  if (closed === 0) return { status: 'failed', reason: `I couldn’t close the ${host} tab.` }
  return { status: 'closed', closed, tabs: [] }
}
