/**
 * Local website opening. Pure URL resolution — the main process opens the URL.
 */

export interface SiteHit {
  /** Canonical https URL. */
  url: string
  /** Short label for the panel (“YouTube”). */
  name: string
}

/** Well-known sites MIKO can open without treating them as app names. */
const SITES: { keys: string[]; url: string; name: string }[] = [
  { keys: ['youtube', 'you tube', 'yt', 'video site', 'that video site', 'the video site'], url: 'https://www.youtube.com/', name: 'YouTube' },
  { keys: ['gmail', 'google mail'], url: 'https://mail.google.com/', name: 'Gmail' },
  { keys: ['google'], url: 'https://www.google.com/', name: 'Google' },
  { keys: ['github'], url: 'https://github.com/', name: 'GitHub' },
  { keys: ['twitter', 'x.com', 'x'], url: 'https://x.com/', name: 'X' },
  { keys: ['reddit'], url: 'https://www.reddit.com/', name: 'Reddit' },
  { keys: ['wikipedia'], url: 'https://www.wikipedia.org/', name: 'Wikipedia' },
  { keys: ['netflix'], url: 'https://www.netflix.com/', name: 'Netflix' },
  { keys: ['amazon'], url: 'https://www.amazon.com/', name: 'Amazon' },
  { keys: ['maps', 'google maps'], url: 'https://maps.google.com/', name: 'Google Maps' }
]

const BROWSER_WORDS = /^(?:chrome|google\s*chrome|safari|firefox|edge|microsoft\s*edge|brave|the\s+browser|my\s+browser|browser)$/i

/** Strip a trailing “in Chrome/Safari/…” and return the browser preference when present. */
export function splitBrowserPreference(raw: string): { rest: string; browser: string | null } {
  const m = /\s+(?:in|with|using)\s+(.+)$/i.exec(raw.trim())
  if (!m?.[1] || !BROWSER_WORDS.test(m[1].trim())) return { rest: raw.trim(), browser: null }
  const browser = m[1].trim().toLowerCase().replace(/^google\s+/, '').replace(/^microsoft\s+/, '').replace(/^(?:the|my)\s+/, '')
  return { rest: raw.slice(0, m.index).trim(), browser: browser === 'google chrome' ? 'chrome' : browser }
}

export function resolveSite(raw: string): SiteHit | null {
  const q = raw
    .trim()
    .toLowerCase()
    .replace(/^(?:the\s+|my\s+|a\s+)/, '')
    .replace(/\s+/g, ' ')
    .replace(/\.+$/, '')
  if (!q) return null
  // Bare host or URL the owner typed.
  if (/^https?:\/\//i.test(raw.trim())) {
    try {
      const u = new URL(raw.trim())
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
      return { url: u.toString(), name: u.hostname.replace(/^www\./, '') }
    } catch {
      return null
    }
  }
  if (/^[a-z0-9.-]+\.[a-z]{2,}(?:\/\S*)?$/i.test(q)) {
    return { url: `https://${q}`, name: q.replace(/^www\./, '').split('/')[0] }
  }
  for (const site of SITES) {
    if (site.keys.some((key) => key === q || q === `${key}.com` || q === `www.${key}.com`)) {
      return { url: site.url, name: site.name }
    }
  }
  return null
}

/** “in Chrome” / “with Safari” / “use Safari instead” as a follow-up that only names a browser. */
export function parseBrowserOnly(raw: string): string | null {
  const t = raw
    .trim()
    .replace(/[.!,]+$/g, '')
    .replace(/^(?:please\s+)?(?:(?:can|could)\s+you\s+)?(?:open\s+(?:it|that|this)\s+)?/i, '')
    .replace(/\s+/g, ' ')
    .trim()
  const m =
    /^(?:in|with|using)\s+(.+)$/i.exec(t) ||
    /^(?:actually\s+)?(?:use|switch\s+(?:that|it|this)\s+to|open\s+(?:it|that|this)\s+(?:in|with))\s+(.+?)(?:\s+instead)?$/i.exec(t)
  if (!m?.[1] || !BROWSER_WORDS.test(m[1].trim())) return null
  const browser = m[1].trim().toLowerCase().replace(/^google\s+/, '').replace(/^microsoft\s+/, '').replace(/^(?:the|my)\s+/, '')
  return browser === 'google chrome' ? 'chrome' : browser
}
