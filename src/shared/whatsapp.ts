/** WhatsApp contact names and aliases. Stored only in MIKO's local settings. */

export const MAX_CONTACT = 80
export const MAX_ALIASES = 40
export const MAX_SNIPPET = 120

export interface WhatsAppAlias {
  alias: string
  name: string
}

/** One searchable chat row from WhatsApp. Identity is name + snippet within a search. */
export interface WhatsAppMatch {
  id: string
  name: string
  snippet: string
  exact: boolean
  /** Contact or group only when WhatsApp exposes it clearly. */
  kind?: 'contact' | 'group'
}

export type WhatsAppStatus =
  | 'opened'
  | 'assisted'
  | 'none'
  | 'choices'
  | 'lost-focus'
  | 'permission'
  | 'failed'
  | 'unsupported'
  | 'cancelled'
  | 'unverified'

export interface WhatsAppOpenResult {
  status: WhatsAppStatus
  query: string
  names: string[]
  matches: WhatsAppMatch[]
  header: string
  reason: string
  composerReady: boolean
}

export type WhatsAppPlan =
  | { action: 'open'; match: WhatsAppMatch }
  | { action: 'choices'; matches: WhatsAppMatch[] }
  | { action: 'none' }
  | { action: 'assisted'; reason?: string }

const MARKS = /[\u200e\u200f\u202a-\u202e]/g

export function normalizeContact(value: string): string {
  return value.replace(MARKS, '').replace(/\s+/g, ' ').trim()
}

export function sameContact(a: string, b: string): boolean {
  return normalizeContact(a).toLowerCase() === normalizeContact(b).toLowerCase()
}

/** A chat-row label, without a trailing unread count. */
export function chatRowName(description: string): string {
  const clean = normalizeContact(description)
  return normalizeContact(clean.replace(/,\s*\d+\s+unread\b.*$/i, ''))
}

export function cleanSnippet(raw: string): string {
  return normalizeContact(raw).slice(0, MAX_SNIPPET)
}

/** Stable within one search: the visible name plus the last-message preview WhatsApp shows. */
export function matchId(name: string, snippet = ''): string {
  return `${normalizeContact(name).toLowerCase()}\u0000${cleanSnippet(snippet).toLowerCase()}`
}

/** A name MIKO may type into WhatsApp search. Control characters are refused. */
export function cleanContactQuery(raw: string): string | null {
  const name = normalizeContact(raw).slice(0, MAX_CONTACT)
  if (!name || /[\u0000-\u001f]/.test(name)) return null
  return name
}

/**
 * While a WhatsApp open is awaiting a corrected recipient (“No match… Who did you mean?”):
 * “Santosh G”, “I meant Santosh G”, “Search Santosh G instead”.
 * Returns a clean contact query, or null when the text is not a recipient correction.
 */
export function parseWaRecipientCorrection(raw: string): string | null {
  const text = normalizeContact(raw).replace(/[.!?]+$/g, '').trim()
  if (!text || text.length > MAX_CONTACT) return null
  // Local commands / questions are not recipient corrections.
  if (
    /^(?:leave it|never mind|nevermind|cancel|stop that|forget it|scratch that|abort that|drop it|skip that)\b/i.test(
      text
    )
  ) {
    return null
  }
  if (
    /^(?:sit|stand|stay|wander|home|come\s+back|follow|move|walk|clear|quit|force\s+quit)\b/i.test(text)
  ) {
    return null
  }
  if (/^(?:how|what|why|when|where|who|which|explain|write|draft a|tell me)\b/i.test(text)) return null

  const meant = /^(?:(?:please\s+)?(?:i\s+)?(?:meant|mean)(?:\s+to\s+say)?)\s+(.+)$/i.exec(text)
  if (meant?.[1]) return cleanContactQuery(meant[1].replace(/^(?:my|the)\s+/i, '').replace(/\s+chat$/i, ''))

  const instead = /^(?:(?:search(?:\s+for)?|find|look\s+for|try|use)\s+)?(.+?)\s+instead$/i.exec(text)
  if (instead?.[1]) return cleanContactQuery(instead[1].replace(/^(?:my|the)\s+/i, '').replace(/\s+chat$/i, ''))

  // “search/find/try X” — not “open X” (known apps must still launch and supersede).
  const search = /^(?:search(?:\s+for)?|find|look\s+for|try|use)\s+(.+)$/i.exec(text)
  if (search?.[1]) {
    const rest = search[1].trim().replace(/\s+instead$/i, '')
    if (/\b(?:in|on)\s+whats\s*app/i.test(rest)) return null
    if (/\band\s+(?:type|tell|say|write|draft|reply)/i.test(rest)) return null
    return cleanContactQuery(rest.replace(/^(?:my|the)\s+/i, '').replace(/\s+chat$/i, '').replace(/^(?:for\s+)/i, ''))
  }

  // Bare name: a few words, no command verbs.
  if (/^(?:open|launch|start|close|quit|ask|type|tell|reply|send|summari)/i.test(text)) return null
  if (/\s+(?:in|on)\s+/i.test(text) || /\band\b/i.test(text)) return null
  const words = text.split(/\s+/).filter(Boolean)
  if (words.length === 0 || words.length > 6) return null
  return cleanContactQuery(text)
}

export function buildMatches(
  rows: { name: string; snippet?: string; kind?: 'contact' | 'group' }[],
  query: string
): WhatsAppMatch[] {
  const wanted = normalizeContact(query)
  const out: WhatsAppMatch[] = []
  const seen = new Set<string>()
  for (const row of rows) {
    const name = chatRowName(row.name)
    if (!name) continue
    const snippet = cleanSnippet(row.snippet ?? '')
    const id = matchId(name, snippet)
    if (seen.has(id)) continue
    seen.add(id)
    const match: WhatsAppMatch = {
      id,
      name,
      snippet,
      exact: sameContact(name, wanted)
    }
    if (row.kind === 'contact' || row.kind === 'group') match.kind = row.kind
    out.push(match)
  }
  return [...out.filter((m) => m.exact), ...out.filter((m) => !m.exact)]
}

/**
 * What to do with the chat rows WhatsApp showed.
 * A unique exact row opens. Anything approximate or multiple is a choice.
 * `expect` is a saved alias destination: open only when that exact name is still listed.
 * `pickId` reopens one previously chosen result after revalidation.
 */
export function planWhatsApp(
  query: string,
  rows: { name: string; snippet?: string; kind?: 'contact' | 'group' }[],
  opts: { inspected: boolean; expect?: string; pickId?: string }
): WhatsAppPlan {
  if (!opts.inspected) return { action: 'assisted' }
  const matches = buildMatches(rows, opts.expect ?? query)
  if (opts.pickId) {
    const hits = matches.filter((m) => m.id === opts.pickId)
    if (hits.length === 1) return { action: 'open', match: hits[0] }
    if (hits.length > 1) {
      return { action: 'assisted', reason: 'Several chats look the same in WhatsApp. Pick the one you want there.' }
    }
    if (matches.length === 0) return { action: 'none' }
    return { action: 'choices', matches }
  }
  if (opts.expect) {
    const exact = matches.filter((m) => sameContact(m.name, opts.expect!))
    if (exact.length === 1) return { action: 'open', match: exact[0] }
    if (exact.length > 1) return { action: 'choices', matches: exact }
    return { action: 'none' }
  }
  if (matches.length === 1 && matches[0].exact) return { action: 'open', match: matches[0] }
  if (matches.length === 0) return { action: 'none' }
  return { action: 'choices', matches }
}

/** "the second one", "2", "number three", "first" → 0-based index, or null. */
export function parseChooserIndex(text: string, count: number): number | null {
  if (count < 1) return null
  const spoken = text
    .toLowerCase()
    .replace(/[.!,]+$/g, '')
    .replace(/^(?:please\s+)?(?:(?:can|could)\s+you\s+)?/, '')
    .replace(/\s+/g, ' ')
    .trim()
  const ordinals: Record<string, number> = {
    first: 1,
    '1st': 1,
    second: 2,
    '2nd': 2,
    third: 3,
    '3rd': 3,
    fourth: 4,
    '4th': 4,
    fifth: 5,
    '5th': 5,
    sixth: 6,
    '6th': 6,
    seventh: 7,
    '7th': 7,
    eighth: 8,
    '8th': 8,
    ninth: 9,
    '9th': 9,
    tenth: 10,
    '10th': 10,
    eleventh: 11,
    twelfth: 12,
    last: count
  }
  const numbered =
    /^(?:(?:open|pick|choose|select)\s+)?(?:(?:the|number|no\.?|#)\s*)?(\d{1,2}|first|1st|second|2nd|third|3rd|fourth|4th|fifth|5th|sixth|6th|seventh|7th|eighth|8th|ninth|9th|tenth|10th|eleventh|twelfth|last)(?:\s+(?:one|chat|result|option))?$/.exec(
      spoken
    )
  if (!numbered?.[1]) return null
  const raw = numbered[1]
  const n = /^\d+$/.test(raw) ? Number(raw) : ordinals[raw]
  if (!Number.isInteger(n) || n < 1 || n > count) return null
  return n - 1
}

export function parseAliases(value: unknown): WhatsAppAlias[] {
  if (!Array.isArray(value)) return []
  const out: WhatsAppAlias[] = []
  for (const row of value) {
    if (!row || typeof row !== 'object') continue
    const added = rememberAlias(out, (row as { alias?: unknown }).alias, (row as { name?: unknown }).name)
    if (added.ok) out.splice(0, out.length, ...added.list)
  }
  return out
}

export function resolveAlias(list: WhatsAppAlias[], query: string): WhatsAppAlias | null {
  return list.find((item) => sameContact(item.alias, query)) ?? null
}

export function rememberAlias(
  list: WhatsAppAlias[],
  aliasRaw: unknown,
  nameRaw: unknown
): { ok: true; list: WhatsAppAlias[] } | { ok: false; reason: string } {
  if (typeof aliasRaw !== 'string' || typeof nameRaw !== 'string') return { ok: false, reason: 'Say the short name and the WhatsApp name.' }
  const alias = cleanContactQuery(aliasRaw)
  const name = cleanContactQuery(nameRaw)
  if (!alias || !name) return { ok: false, reason: 'That name can’t be saved.' }
  if (sameContact(alias, name)) return { ok: false, reason: 'That short name is already the WhatsApp name.' }
  const next = list.filter((item) => !sameContact(item.alias, alias))
  if (next.length >= MAX_ALIASES) return { ok: false, reason: `You can save up to ${MAX_ALIASES} WhatsApp names.` }
  return { ok: true, list: [...next, { alias, name }] }
}

export function forgetAlias(list: WhatsAppAlias[], aliasRaw: string): { ok: true; list: WhatsAppAlias[] } | { ok: false; reason: string } {
  const alias = cleanContactQuery(aliasRaw)
  if (!alias) return { ok: false, reason: 'Which WhatsApp name should I forget?' }
  const next = list.filter((item) => !sameContact(item.alias, alias))
  if (next.length === list.length) return { ok: false, reason: `I don’t have a WhatsApp name for “${alias}”.` }
  return { ok: true, list: next }
}

/** Last JSON line of a helper's stdout (Windows PowerShell may prefix a BOM or use CRLF). */
export function parseHelperOutput(out: string): Record<string, unknown> {
  const lines = out
    .replace(/\ufeff/g, '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  const parsed: unknown = JSON.parse(lines.pop() ?? '{}')
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {}
}
