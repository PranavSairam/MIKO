/** Mail panel logic shared by main and renderer: intents, queries, importance rules, merging. Pure. */

export type MailProvider = 'gmail'
export type MailFilter = 'recent' | 'unread' | 'important'

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
  html: string
  text: string
}

export type MailIntent =
  | { kind: 'recent' }
  | { kind: 'unread' }
  | { kind: 'important'; unreadOnly: boolean }
  | { kind: 'search'; query: string }
  /** 1-based position in the displayed results; -1 = last, 0 = unclear ("that one"). */
  | { kind: 'open'; index: number }

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

  const open = new RegExp(`^(?:open|read|show)\\s+(?:the\\s+|that\\s+|this\\s+)?(?:(\\w+)\\s+)?${MAIL}(?:\\s+(\\d{1,2}))?$`).exec(t)
  if (open && (open[1] || open[2] || /\b(?:that|this)\b/.test(t))) {
    if (open[2]) return { kind: 'open', index: Number(open[2]) }
    if (open[1] && open[1] in ORDINALS) return { kind: 'open', index: ORDINALS[open[1]] }
    if (!open[1]) return { kind: 'open', index: 0 }
    return null
  }

  const search = new RegExp(`^(?:search|find)\\s+(?:my\\s+)?${MAIL}\\s+(?:for\\s+)?(.+)$`, 'i').exec(original)
  if (search?.[1]) return { kind: 'search', query: cleanQuery(search[1]) }
  const from = new RegExp(`^(?:show\\s+(?:me\\s+)?)?(?:my\\s+)?${MAIL}\\s+from\\s+(.+)$`, 'i').exec(original)
  if (from?.[1]) {
    const who = cleanQuery(from[1]).replace(/"/g, '')
    return { kind: 'search', query: /\s/.test(who) ? `from:"${who}"` : `from:${who}` }
  }
  const about = new RegExp(`^(?:show\\s+(?:me\\s+)?)?(?:my\\s+)?${MAIL}\\s+(?:about|regarding|on)\\s+(.+)$`, 'i').exec(original)
  if (about?.[1]) return { kind: 'search', query: cleanQuery(about[1]) }
  return null
}

export function cleanQuery(raw: string): string {
  return raw.replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_QUERY)
}

/**
 * Gmail search string. Recent/Unread/Important browse the inbox; a search
 * covers the whole mailbox except Spam and Trash.
 */
export function gmailQuery(filter: MailFilter, search: string): string {
  const terms = cleanQuery(search)
  if (!terms) return filter === 'unread' ? 'in:inbox is:unread' : 'in:inbox'
  return `${terms}${filter === 'unread' ? ' is:unread' : ''} -in:spam -in:trash`
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
