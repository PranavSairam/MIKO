/** Mail panel logic shared by main and renderer: intents, queries, importance rules, merging. Pure. */

export type MailProvider = 'gmail'
/** Mail tabs. 'all' = All mail (inbox, or the whole mailbox for a search). */
export type MailFilter = 'all' | 'unread' | 'important' | 'action' | 'fyi' | 'updates' | 'promotions'
export const MAIL_FILTERS: MailFilter[] = ['all', 'unread', 'important', 'action', 'fyi', 'updates', 'promotions']
export type MailCategory = 'action' | 'fyi' | 'updates' | 'promotions' | 'other'
export const CATEGORY_LABELS: Record<MailCategory, string> = {
  action: 'Action needed',
  fyi: 'Important FYI',
  updates: 'Updates',
  promotions: 'Promotions',
  other: 'Other'
}

export interface MailAccount {
  /** Mailbox address; with provider it scopes every message key. */
  email: string
  provider: MailProvider
  status: 'ok' | 'reconnect'
}

export interface MailSummary {
  /** provider:account:messageId. Message ids are only unique within one account. */
  key: string
  provider: MailProvider
  account: string
  id: string
  threadId: string
  from: string
  fromEmail: string
  to: string
  subject: string
  snippet: string
  /** Received time, ms since epoch. */
  date: number
  unread: boolean
  labels: string[]
  /** The account's own address is in To (not only Cc or a list). */
  directToMe: boolean
}

export interface MailMessage extends MailSummary {
  cc: string
  /** Reply-To header, when the sender set one. */
  replyTo: string
  html: string
  text: string
}

/** One message of a thread, for context under the open message (plain text, trimmed). */
export interface ThreadEntry {
  key: string
  from: string
  fromEmail: string
  date: number
  text: string
}

export type MailIntent =
  | { kind: 'recent' }
  | { kind: 'unread' }
  | { kind: 'important'; unreadOnly: boolean }
  | { kind: 'category'; category: Exclude<MailFilter, 'all' | 'unread' | 'important'> }
  | { kind: 'search'; query: string }
  /** 1-based position in the displayed results; -1 = last, 0 = unclear ("that one"). */
  | { kind: 'open'; index: number }
  /** index as for open; 0 = the open message ("reply to this"). instruction may be empty. */
  | { kind: 'reply'; index: number; instruction: string }
  | { kind: 'cancel-reply' }

export const PAGE_SIZE = 10
export const MAX_QUERY = 200

const MAIL = '(?:e-?mails?|mails?|inbox|messages?)'
const ORDINALS: Record<string, number> = {
  first: 1, '1st': 1, one: 1,
  second: 2, '2nd': 2, two: 2,
  third: 3, '3rd': 3, three: 3,
  fourth: 4, '4th': 4, four: 4,
  fifth: 5, '5th': 5, five: 5,
  sixth: 6, '6th': 6, six: 6,
  seventh: 7, '7th': 7, seven: 7,
  eighth: 8, '8th': 8, eight: 8,
  ninth: 9, '9th': 9, nine: 9,
  tenth: 10, '10th': 10, ten: 10,
  last: -1
}

function tidy(text: string): string {
  return text
    .trim()
    .replace(/[.!?]+$/g, '')
    .replace(/^(?:please\s+)?(?:(?:can|could)\s+you\s+)?/i, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Mail phrases, checked before app launching. Returns null for anything else. */
export function parseMailCommand(raw: string): MailIntent | null {
  const original = tidy(raw)
  const t = original.toLowerCase()
  if (!t || /^ask\s+(?:chat\s*-?\s*)?gpt\b/.test(t)) return null
  if (
    new RegExp(`^(?:check|chk)\\s+(?:my\\s+)?${MAIL}$`).test(t) ||
    new RegExp(`^(?:show\\s+(?:me\\s+)?)?(?:my\\s+)?(?:recent|latest|new|newest)\\s+${MAIL}$`).test(t)
  ) {
    return { kind: 'recent' }
  }
  // Questions about the user's own mail go to the mailbox, never to the model.
  const asks = new RegExp(`^(?:do|did|have)\\s+i\\s+(?:got|get|have|received?)\\s+(?:any\\s+)?(new\\s+|unread\\s+|important\\s+)?${MAIL}$|^any\\s+(new\\s+|unread\\s+|important\\s+)?${MAIL}$`).exec(t)
  if (asks) {
    const kind = (asks[1] ?? asks[2] ?? '').trim()
    if (kind === 'unread') return { kind: 'unread' }
    if (kind === 'important') return { kind: 'important', unreadOnly: false }
    return { kind: 'recent' }
  }
  if (new RegExp(`^what(?:'s|\\s+is)\\s+(?:new\\s+)?in\\s+my\\s+(?:inbox|mail|email)$`).test(t)) return { kind: 'recent' }
  const important = new RegExp(`^(?:show\\s+(?:me\\s+)?)?(?:my\\s+)?important\\s+(unread\\s+)?${MAIL}$`).exec(t)
  if (important) return { kind: 'important', unreadOnly: Boolean(important[1]) }
  if (new RegExp(`^(?:show\\s+(?:me\\s+)?)?(?:my\\s+)?unread\\s+${MAIL}$`).test(t)) return { kind: 'unread' }

  const category =
    new RegExp(`^(?:show\\s+(?:me\\s+)?)?(?:my\\s+)?(action[- ]needed|important fyi|fyi)(?:\\s+${MAIL})?$`).exec(t) ??
    new RegExp(`^(?:(?:show\\s+(?:me\\s+)?)?(?:my\\s+)?(updates?|promotions?|promos?)\\s+${MAIL}|show\\s+(?:me\\s+)?(?:my\\s+)?(updates|promotions))$`).exec(t)
  if (category) {
    const c = category[1] ?? category[2]
    if (/^action/.test(c)) return { kind: 'category', category: 'action' }
    if (/fyi/.test(c)) return { kind: 'category', category: 'fyi' }
    if (/^update/.test(c)) return { kind: 'category', category: 'updates' }
    return { kind: 'category', category: 'promotions' }
  }
  if (/^(?:cancel|stop|discard|close)\s+(?:the\s+|this\s+|my\s+)?(?:reply|draft)$/.test(t)) return { kind: 'cancel-reply' }
  const reply = new RegExp(
    `^(?:reply|respond|answer|(?:draft|write)\\s+(?:a\\s+)?reply)\\s+(?:to\\s+)?(?:the\\s+|that\\s+|this\\s+)?(?:(\\w+)\\s+)?${MAIL}(?:\\s+(\\d{1,2}))?(?:[,:]?\\s+(?:saying|and say|to say|that|with)\\s+(.+))?$`,
    'i'
  ).exec(original)
  if (reply) {
    const instruction = (reply[3] ?? '').trim()
    const word = reply[1]?.toLowerCase()
    if (reply[2]) return { kind: 'reply', index: Number(reply[2]), instruction }
    if (word && word in ORDINALS) return { kind: 'reply', index: ORDINALS[word], instruction }
    if (!word) return { kind: 'reply', index: 0, instruction }
    return null
  }
  const replyHere = /^(?:reply|respond)(?:\s+(?:to\s+(?:it|this|him|her|them)))?(?:[,:]?\s+(?:saying|and say|to say|with)\s+(.+))?$/i.exec(original)
  if (replyHere) return { kind: 'reply', index: 0, instruction: (replyHere[1] ?? '').trim() }

  const open = new RegExp(`^(?:open|read|show)\\s+(?:the\\s+|that\\s+|this\\s+)?(?:(\\w+)\\s+)?${MAIL}(?:\\s+(\\d{1,2}))?$`).exec(t)
  if (open && (open[1] || open[2] || /\b(?:that|this)\b/.test(t))) {
    if (open[2]) return { kind: 'open', index: Number(open[2]) }
    if (open[1] && open[1] in ORDINALS) return { kind: 'open', index: ORDINALS[open[1]] }
    if (!open[1]) return { kind: 'open', index: 0 }
    return null
  }

  const search = new RegExp(`^(?:search|find)\\s+(?:my\\s+)?${MAIL}\\s+(?:for\\s+)?(.+)$`, 'i').exec(original)
  if (search?.[1]) return { kind: 'search', query: withDate(search[1], (rest) => cleanQuery(rest)) }
  const subject = new RegExp(`^(?:show\\s+(?:me\\s+)?)?(?:my\\s+)?${MAIL}\\s+with\\s+(?:the\\s+)?subject\\s+(.+)$`, 'i').exec(original)
  if (subject?.[1]) return { kind: 'search', query: withDate(subject[1], (rest) => operator('subject', rest)) }
  const from = new RegExp(`^(?:show\\s+(?:me\\s+)?)?(?:my\\s+)?${MAIL}\\s+from\\s+(.+)$`, 'i').exec(original)
  if (from?.[1]) return { kind: 'search', query: withDate(from[1], (rest) => operator('from', rest)) }
  const about = new RegExp(`^(?:show\\s+(?:me\\s+)?)?(?:my\\s+)?${MAIL}\\s+(?:about|regarding|on)\\s+(.+)$`, 'i').exec(original)
  if (about?.[1]) return { kind: 'search', query: withDate(about[1], (rest) => cleanQuery(rest)) }
  return null
}

function operator(name: string, raw: string): string {
  const value = cleanQuery(raw).replace(/"/g, '')
  if (!value) return ''
  return /\s/.test(value) ? `${name}:"${value}"` : `${name}:${value}`
}

const RELATIVE: Record<string, string> = {
  today: 'newer_than:1d',
  yesterday: 'newer_than:2d older_than:1d',
  'this week': 'newer_than:7d',
  'last week': 'newer_than:7d',
  'past week': 'newer_than:7d',
  'this month': 'newer_than:30d',
  'last month': 'newer_than:30d',
  'past month': 'newer_than:30d'
}

/** Splits a trailing date phrase ("last week", "before 2026-01-31") into a Gmail date clause. */
function withDate(raw: string, build: (rest: string) => string): string {
  const text = raw.trim()
  const relative = /(?:^|\s+)(?:from\s+|in\s+|on\s+)?(today|yesterday|(?:this|last|past)\s+(?:week|month))$/i.exec(text)
  const absolute = /(?:^|\s+)(before|after)\s+(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/i.exec(text)
  let clause = ''
  let rest = text
  if (relative) {
    clause = RELATIVE[relative[1].toLowerCase().replace(/\s+/g, ' ')] ?? ''
    rest = text.slice(0, relative.index)
  } else if (absolute) {
    clause = `${absolute[1].toLowerCase()}:${absolute[2]}/${absolute[3].padStart(2, '0')}/${absolute[4].padStart(2, '0')}`
    rest = text.slice(0, absolute.index)
  }
  return [build(rest), clause].filter(Boolean).join(' ')
}

export function cleanQuery(raw: string): string {
  return raw.replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_QUERY)
}

/**
 * Gmail search string. Without search words the tabs browse the inbox
 * (Updates/Promotions narrow by Gmail's own category); a search covers the
 * whole mailbox except Spam and Trash. Action needed and Important FYI are
 * MIKO's local categories, filtered after fetching.
 */
export function gmailQuery(filter: MailFilter, search: string): string {
  const terms = cleanQuery(search)
  const extra = filter === 'unread' ? 'is:unread' : filter === 'updates' ? 'category:updates' : filter === 'promotions' ? 'category:promotions' : ''
  if (!terms) return ['in:inbox', extra].filter(Boolean).join(' ')
  return [terms, extra, '-in:spam -in:trash'].filter(Boolean).join(' ')
}

/** Structured search (Advanced search fields) to a Gmail query. Dates are YYYY-MM-DD. */
export function buildQuery(fields: { words?: string; from?: string; subject?: string; after?: string; before?: string }): string {
  const parts: string[] = []
  const words = cleanQuery(fields.words ?? '')
  if (words) parts.push(words)
  if (fields.from?.trim()) parts.push(operator('from', fields.from))
  if (fields.subject?.trim()) parts.push(operator('subject', fields.subject))
  for (const key of ['after', 'before'] as const) {
    const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec((fields[key] ?? '').trim())
    if (d) parts.push(`${key}:${d[1]}/${d[2]}/${d[3]}`)
  }
  return cleanQuery(parts.filter(Boolean).join(' '))
}

/** Local importance rules. Every switch is user-adjustable in the Mail tab. */
export interface ImportanceRules {
  providerFlag: boolean
  directRequests: boolean
  deadlines: boolean
  approvals: boolean
  payments: boolean
  keywords: string[]
}

export const DEFAULT_RULES: ImportanceRules = {
  providerFlag: true,
  directRequests: true,
  deadlines: true,
  approvals: true,
  payments: true,
  keywords: []
}

export interface Importance {
  important: boolean
  /** provider = Gmail's own flag; rules = MIKO's heuristic rules (shown as such). */
  source: 'provider' | 'rules' | null
  reasons: string[]
}

const REQUEST = /\b(?:can|could|would|will) you\b|\bplease\b|\blet me know\b|\bneed you to\b/i
const DEADLINE =
  /\b(?:deadline|due (?:on|by|today|tomorrow|date|(?:mon|tues|wednes|thurs|fri|satur|sun)day)|by (?:today|tomorrow|tonight|eod|end of (?:day|week))|overdue|expires?|last date|asap|urgent)\b/i
const APPROVAL = /\b(?:approve|approval|sign[- ]?off|authori[sz]e|needs your (?:ok|okay|sign))\b/i
const PAYMENT = /\b(?:invoice|payment|pay(?:able)?|overdue|bill|amount due|remittance|refund)\b/i
const BULK = ['CATEGORY_PROMOTIONS', 'CATEGORY_SOCIAL', 'CATEGORY_FORUMS', 'SPAM']

function quoteHit(re: RegExp, text: string): string {
  const found = re.exec(text)
  return found ? ` (“${found[0]}”)` : ''
}

export function classifyImportance(message: MailSummary, rules: ImportanceRules): Importance {
  if (rules.providerFlag && message.labels.includes('IMPORTANT')) {
    return { important: true, source: 'provider', reasons: ['Gmail marked it important'] }
  }
  if (message.labels.some((label) => BULK.includes(label))) return { important: false, source: null, reasons: [] }
  const text = `${message.subject} ${message.snippet}`
  const reasons: string[] = []
  if (rules.directRequests && message.directToMe && REQUEST.test(text)) reasons.push(`Direct request to you${quoteHit(REQUEST, text)}`)
  if (rules.deadlines && DEADLINE.test(text)) reasons.push(`Mentions a deadline${quoteHit(DEADLINE, text)}`)
  if (rules.approvals && APPROVAL.test(text)) reasons.push(`Asks for approval${quoteHit(APPROVAL, text)}`)
  if (rules.payments && PAYMENT.test(text)) reasons.push(`About a payment${quoteHit(PAYMENT, text)}`)
  const lower = text.toLowerCase()
  for (const keyword of rules.keywords) {
    const k = keyword.trim().toLowerCase()
    if (k && lower.includes(k)) reasons.push(`Matches your keyword “${keyword.trim()}”`)
  }
  return reasons.length ? { important: true, source: 'rules', reasons } : { important: false, source: null, reasons: [] }
}

/** The owner's category corrections: per message, or for everything from one sender. */
export interface MailCorrections {
  messages: Record<string, MailCategory>
  senders: Record<string, MailCategory>
}

export const EMPTY_CORRECTIONS: MailCorrections = { messages: {}, senders: {} }
const CATEGORIES: MailCategory[] = ['action', 'fyi', 'updates', 'promotions', 'other']

export function parseCorrections(value: unknown): MailCorrections {
  const v = (value && typeof value === 'object' ? value : {}) as { messages?: unknown; senders?: unknown }
  const pick = (raw: unknown, key: (k: string) => boolean, max: number): Record<string, MailCategory> => {
    const out: Record<string, MailCategory> = {}
    if (!raw || typeof raw !== 'object') return out
    const entries = Object.entries(raw as Record<string, unknown>).filter(
      ([k, c]) => k.length < 300 && key(k) && CATEGORIES.includes(c as MailCategory)
    )
    for (const [k, c] of entries.slice(-max)) out[k] = c as MailCategory
    return out
  }
  return {
    messages: pick(v.messages, (k) => /^gmail:[^:\s]+@[^:\s]+:[0-9a-zA-Z]+$/.test(k), 1000),
    senders: pick(v.senders, (k) => /^[^\s@]+@[^\s@]+$/.test(k) && k === k.toLowerCase(), 300)
  }
}

export interface Categorized {
  category: MailCategory
  /** Short reason shown under the row. */
  reason: string
  /** false = a guess; the row says "Maybe". */
  certain: boolean
  source: 'you' | 'gmail' | 'rules' | 'none'
}

/**
 * Transparent category rules (no model): the owner's corrections first, then
 * Gmail's own category tabs, then MIKO's action cues, then Gmail's
 * importance flag. Anything else is "Other" and stays in All mail.
 */
export function categorize(message: MailSummary, rules: ImportanceRules, corrections: MailCorrections = EMPTY_CORRECTIONS): Categorized {
  const own = corrections.messages[message.key]
  if (own) return { category: own, reason: 'You set this', certain: true, source: 'you' }
  const sender = corrections.senders[message.fromEmail.toLowerCase()]
  if (sender) return { category: sender, reason: `You set this for ${message.fromEmail}`, certain: true, source: 'you' }
  const labels = message.labels
  if (labels.includes('CATEGORY_PROMOTIONS')) return { category: 'promotions', reason: 'Gmail filed it under Promotions', certain: true, source: 'gmail' }
  const text = `${message.subject} ${message.snippet}`
  const cues: string[] = []
  if (rules.directRequests && message.directToMe && REQUEST.test(text)) cues.push(`Direct request to you${quoteHit(REQUEST, text)}`)
  if (rules.deadlines && DEADLINE.test(text)) cues.push(`Deadline${quoteHit(DEADLINE, text)}`)
  if (rules.approvals && APPROVAL.test(text)) cues.push(`Approval${quoteHit(APPROVAL, text)}`)
  if (rules.payments && PAYMENT.test(text)) cues.push(`Payment${quoteHit(PAYMENT, text)}`)
  const flagged = rules.providerFlag && labels.includes('IMPORTANT')
  const social = labels.includes('CATEGORY_SOCIAL') || labels.includes('CATEGORY_FORUMS')
  if (social) return { category: 'updates', reason: `Gmail filed it under ${labels.includes('CATEGORY_SOCIAL') ? 'Social' : 'Forums'}`, certain: false, source: 'gmail' }
  if (labels.includes('CATEGORY_UPDATES')) {
    if (cues.length && (message.directToMe || flagged)) {
      return { category: 'action', reason: `${cues.join(' · ')} (Gmail filed it under Updates)`, certain: false, source: 'rules' }
    }
    return { category: 'updates', reason: 'Gmail filed it under Updates', certain: true, source: 'gmail' }
  }
  if (cues.length) {
    const certain = cues.length >= 2 || flagged
    return { category: 'action', reason: `${cues.join(' · ')}${flagged ? ' · Gmail marked it important' : ''}`, certain, source: 'rules' }
  }
  const lower = text.toLowerCase()
  const keyword = rules.keywords.find((k) => k.trim() && lower.includes(k.trim().toLowerCase()))
  if (flagged) return { category: 'fyi', reason: 'Gmail marked it important; no request or deadline found', certain: true, source: 'gmail' }
  if (keyword) return { category: 'fyi', reason: `Matches your keyword “${keyword.trim()}”`, certain: true, source: 'rules' }
  return { category: 'other', reason: 'No category signal', certain: false, source: 'none' }
}

/** Whether a message belongs on a tab. All mail and Unread take every category. */
export function inFilter(filter: MailFilter, message: MailSummary, category: MailCategory): boolean {
  if (filter === 'all') return true
  if (filter === 'unread') return message.unread
  // Important = Action needed + Important FYI.
  if (filter === 'important') return category === 'action' || category === 'fyi'
  return category === filter
}

export function parseRules(value: unknown): ImportanceRules {
  const v = (value && typeof value === 'object' ? value : {}) as Partial<Record<keyof ImportanceRules, unknown>>
  const flag = (key: Exclude<keyof ImportanceRules, 'keywords'>): boolean =>
    typeof v[key] === 'boolean' ? (v[key] as boolean) : DEFAULT_RULES[key]
  const keywords = Array.isArray(v.keywords)
    ? v.keywords.filter((k): k is string => typeof k === 'string').map((k) => k.trim().slice(0, 40)).filter(Boolean).slice(0, 20)
    : []
  return {
    providerFlag: flag('providerFlag'),
    directRequests: flag('directRequests'),
    deadlines: flag('deadlines'),
    approvals: flag('approvals'),
    payments: flag('payments'),
    keywords
  }
}

/** Take the n newest across per-account buffers (each already newest-first); return what's left. */
export function mergeNewest(
  buffers: Record<string, MailSummary[]>,
  n: number
): { take: MailSummary[]; rest: Record<string, MailSummary[]> } {
  const rest: Record<string, MailSummary[]> = {}
  for (const [key, list] of Object.entries(buffers)) rest[key] = [...list]
  const take: MailSummary[] = []
  while (take.length < n) {
    let best: string | null = null
    for (const [key, list] of Object.entries(rest)) {
      if (list.length && (best === null || list[0].date > rest[best][0].date)) best = key
    }
    if (best === null) break
    take.push(rest[best].shift() as MailSummary)
  }
  return { take, rest }
}

/** Validates a Google OAuth "Desktop app" client pasted by the owner. */
export function checkGoogleClient(
  rawId: string,
  rawSecret: string
): { ok: true; clientId: string; clientSecret: string } | { ok: false; reason: string } {
  const clientId = rawId.trim()
  const clientSecret = rawSecret.trim()
  if (!/^[0-9]{6,20}-[a-z0-9]{8,64}\.apps\.googleusercontent\.com$/.test(clientId)) {
    return { ok: false, reason: 'That doesn’t look like a Google Client ID (it ends in .apps.googleusercontent.com).' }
  }
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(clientSecret)) {
    return { ok: false, reason: 'Paste the Client secret shown next to the Client ID (it usually starts with GOCSPX-).' }
  }
  return { ok: true, clientId, clientSecret }
}
