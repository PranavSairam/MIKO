/**
 * General web search phrases (“Search Chrome for budget headphones”, “Google transfer learning”).
 * Pure parsing: browser, profile and query are separate. The URL is built with URLSearchParams,
 * so the query is always encoded. WhatsApp contact search is never handled here.
 */

export interface WebSearchIntent {
  query: string
  /** Browser named or implied by the phrase (‘chrome’ when none is named). */
  browser: string
  /** Explicit Chrome profile from the phrase (overrides a saved default). */
  profileQuery: string | null
  /** “Search instead for …”: replaces the previous search. */
  instead: boolean
}

export interface WebSearchContext {
  /** The last web search MIKO opened (for “search instead for …”). */
  lastSearch?: { query: string; browser: string | null } | null
  /** Which destination the owner used most recently. */
  recentDestination?: 'web' | 'whatsapp' | null
}

import { resolveSite } from './sites.ts'

const SEARCH_HOST = 'https://www.google.com/search'
const MAX_QUERY = 300

const BROWSER = String.raw`(?:google\s+)?chrome|safari|firefox|(?:microsoft\s+)?edge|brave`
const WEB = String.raw`google|the\s+web|the\s+internet|online|the\s+browser|my\s+browser`

export function webSearchUrl(query: string): string {
  const params = new URLSearchParams({ q: query.trim().slice(0, MAX_QUERY) })
  return `${SEARCH_HOST}?${params.toString()}`
}

/** The query of a MIKO web search URL, or null for any other URL. */
export function searchQueryFromUrl(url: string | null | undefined): string | null {
  if (!url) return null
  try {
    const u = new URL(url)
    if (u.protocol !== 'https:' || u.hostname !== 'www.google.com' || u.pathname !== '/search') return null
    const q = u.searchParams.get('q')
    return q && q.trim() ? q.trim() : null
  } catch {
    return null
  }
}

export function webSearchName(query: string): string {
  return `search for “${query}”`
}

function browserWord(raw: string | undefined): string | null {
  if (!raw) return null
  const b = raw.trim().toLowerCase().replace(/\s+/g, ' ').replace(/^google /, '').replace(/^microsoft /, '')
  if (/^(?:google|the web|the internet|online|the browser|my browser)$/.test(b)) return null
  return b
}

function cleanSearchQuery(raw: string): string | null {
  const q = raw
    .trim()
    .replace(/^[“"']+|[”"']+$/g, '')
    .replace(/\s+(?:for\s+me|please)$/i, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_QUERY)
  if (!q) return null
  if (new RegExp(`^(?:${BROWSER}|${WEB}|it|that|this)$`, 'i').test(q)) return null
  return q
}

/** “… with my Work profile” / “… in Chrome as Work” → profile, implying Chrome. */
function splitProfile(text: string): { rest: string; profileQuery: string | null } {
  const m =
    /\s+in\s+(?:google\s+)?chrome\s+(?:with|as|using)\s+(?:my\s+|the\s+)?(.+?)(?:\s+profile)?$/i.exec(text) ||
    /\s+in\s+(?:my\s+|the\s+)?(.+?)\s+chrome\s+profile$/i.exec(text) ||
    /\s+(?:with|using|as)\s+(?:my\s+|the\s+)?(.+?)\s+(?:chrome\s+)?profile$/i.exec(text)
  if (!m?.[1]) return { rest: text, profileQuery: null }
  const rest = text.slice(0, m.index).trim()
  // Keep “in Chrome” on the rest so the browser is still named.
  return { rest: /\bchrome\b/i.test(m[0]) && !/\bchrome\b/i.test(rest) ? `${rest} in chrome` : rest, profileQuery: m[1].trim() }
}

/** “Search instead for X” / “search for X instead” → X (destination decided by the caller). */
export function parseInsteadQuery(raw: string): string | null {
  const text = raw.trim().replace(/[.!?]+$/g, '').replace(/\s+/g, ' ')
  const m =
    /^(?:actually\s+)?search\s+instead\s+for\s+(.+)$/i.exec(text) ||
    /^(?:actually\s+)?instead\s+search\s+(?:for\s+)?(.+)$/i.exec(text) ||
    /^(?:actually\s+)?search\s+(?:for\s+)?(.+?)\s+instead$/i.exec(text)
  const q = m?.[1]?.trim()
  return q ? q.slice(0, MAX_QUERY) : null
}

/**
 * A general web search, or null. Never matches a WhatsApp destination
 * (“search for Dad in WhatsApp” stays a contact search).
 */
export function parseWebSearch(raw: string, ctx: WebSearchContext = {}): WebSearchIntent | null {
  let text = raw
    .trim()
    .replace(/[.!?]+$/g, '')
    .replace(/^(?:ok(?:ay)?|hey\s+miko|miko|please)[,\s]+/i, '')
    .replace(/^(?:(?:can|could|would)\s+you\s+)/i, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!text || /\bwhats?\s*app\b/i.test(text)) return null

  const split = splitProfile(text)
  text = split.rest
  const profileQuery = split.profileQuery
  const lastBrowser = ctx.lastSearch?.browser || null
  const pick = (named: string | null): string => named || (profileQuery ? 'chrome' : lastBrowser || 'chrome')

  const instead = parseInsteadQuery(text)
  if (instead) {
    if (!ctx.lastSearch || ctx.recentDestination === 'whatsapp') return null
    const query = cleanSearchQuery(instead)
    return query ? { query, browser: pick(null), profileQuery, instead: true } : null
  }

  const patterns: { re: RegExp; q: number; b: number | null }[] = [
    // “search Chrome for X” / “search on Google for X”
    { re: new RegExp(`^(?:search|look\\s+up)\\s+(?:on\\s+|in\\s+|using\\s+)?(${BROWSER}|${WEB})\\s+for\\s+(.+)$`, 'i'), q: 2, b: 1 },
    // “search for X in Chrome” / “look up X on Google”
    { re: new RegExp(`^(?:search|look\\s+up)\\s+(?:for\\s+)?(.+?)\\s+(?:in|on|using|with)\\s+(${BROWSER}|${WEB})$`, 'i'), q: 1, b: 2 },
    // “search for X online”
    { re: /^(?:search|look\s+up)\s+(?:for\s+)?(.+?)\s+(online)$/i, q: 1, b: 2 },
    // “google X in Chrome” / “google X”
    { re: new RegExp(`^google\\s+(?!chrome\\b)(.+?)\\s+(?:in|on|using|with)\\s+(${BROWSER})$`, 'i'), q: 1, b: 2 },
    { re: /^google\s+(?!chrome\b|it\b|that\b|this\b)(.+)$/i, q: 1, b: null }
  ]
  for (const { re, q, b } of patterns) {
    const m = re.exec(text)
    if (!m?.[q]) continue
    // “Google Maps” / “Google Mail” name a site, not a search.
    if (/^google\s/i.test(text) && resolveSite(text)) return null
    const query = cleanSearchQuery(m[q])
    if (!query) return null
    return { query, browser: pick(b === null ? null : browserWord(m[b])), profileQuery, instead: false }
  }

  // Bare “search for X” right after a web search keeps searching the web.
  if (ctx.recentDestination === 'web' && ctx.lastSearch) {
    const bare = /^(?:search|look\s+up)\s+(?:for\s+)?(.+)$/i.exec(text)
    if (bare?.[1]) {
      const query = cleanSearchQuery(bare[1])
      return query ? { query, browser: pick(null), profileQuery, instead: false } : null
    }
  }
  return null
}
