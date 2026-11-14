import { resolveChat, type SavedChat } from './chatgpt.ts'
import { cleanQuery, parseMailCommand, type MailIntent } from './mail.ts'
import { LITTLE_DIP, MOVE_DIP } from './guide.ts'

/** One router for typed text now and a speech transcript later. */
export type CommandSource = 'typed' | 'voice'

export interface CatalogApp {
  id: string
  name: string
  installed: boolean
  familiar: boolean
  aliases: string[]
}

export type CommandResult =
  | { type: 'move'; direction: 'left' | 'right'; distance: number }
  | { type: 'corner'; edge: 'left' | 'right' }
  | { type: 'home' }
  | { type: 'pose'; pose: 'sit' | 'stand' | 'stay' | 'wander' }
  | { type: 'launch'; appId: string; name: string }
  | { type: 'confirm'; appId: string; name: string }
  | { type: 'close'; appId: string; name: string }
  | { type: 'force-close'; appId: string; name: string }
  | { type: 'close-self' }
  | { type: 'follow'; mode: 'stay' | 'follow' | 'come' }
  | { type: 'choices'; purpose: 'open' | 'close'; text: string; options: { id: string; name: string; familiar: boolean }[] }
  | { type: 'missing'; name: string; text: string }
  | { type: 'question'; prompt: string }
  | { type: 'open-chatgpt' }
  | { type: 'open-chat'; name: string; url: string }
  | { type: 'chat-choices'; text: string; options: SavedChat[] }
  | { type: 'list-chats' }
  | { type: 'ask-gpt'; question: string }
  | { type: 'check-mail'; prompt: string }
  | { type: 'mail'; intent: MailIntent }
  | { type: 'mail-or-app'; query: string }
  | { type: 'unknown'; text: string }


const ACTION_ID =
  /^(chrome|browser|calculator|editor|downloads|files|word|excel|powerpoint|whatsapp|app-[a-z0-9](?:[a-z0-9-]{0,58}[a-z0-9])?)$/

/** Action ids the main process may launch. Anything else is rejected. */
export function parseActionId(value: unknown): string | null {
  if (typeof value !== 'string') return null
  return ACTION_ID.test(value) ? value : null
}

export function movementLine(
  kind: 'move' | 'little' | 'corner' | 'home',
  direction: 'left' | 'right',
  clamped: boolean,
  stayed: boolean
): string {
  if (stayed) return kind === 'home' ? 'I\u2019m already home.' : 'I\u2019m already there.'
  if (kind === 'home') return 'Coming back.'
  if (kind === 'corner') return direction === 'left' ? 'Walking to the left corner.' : 'Walking to the right corner.'
  const way = direction === 'left' ? 'left' : 'right'
  if (kind === 'little' && clamped) return `Walking a little ${way}, up to the edge.`
  if (kind === 'little') return `Walking a little ${way}.`
  if (clamped) return `Walking ${way}, up to the edge.`
  return `Walking ${way}.`
}

export function poseLine(pose: 'sit' | 'stand' | 'stay' | 'wander', panelOpen: boolean): string {
  if (pose === 'sit') return 'Sitting.'
  if (pose === 'stand') return 'Standing.'
  if (pose === 'stay') return 'Staying.'
  return panelOpen ? 'I\u2019ll wander once this is closed.' : 'Wandering again.'
}

export function routeCommand(
  text: string,
  _source: CommandSource,
  catalog: CatalogApp[],
  chats: SavedChat[] = [],
  context: { mailTab?: boolean } = {}
): CommandResult {
  const original = text.trim().slice(0, 2000)
  if (!original) return { type: 'unknown', text: 'I can walk, sit, open or close an app, or follow the active window.' }
  const asked = matchAskGpt(original)
  if (asked) return asked
  if (isCheckMailInChatGpt(normalize(original))) return { type: 'check-mail', prompt: MAIL_REQUEST }
  const mail = parseMailCommand(original)
  if (mail) return { type: 'mail', intent: mail }
  const bareSearch = /^(?:search|find|look\s+for)\s+(?:for\s+)?(.+)$/i.exec(original.replace(/[.!?]+$/, ''))
  if (bareSearch?.[1]) {
    const query = cleanQuery(bareSearch[1])
    return context.mailTab ? { type: 'mail', intent: { kind: 'search', query } } : { type: 'mail-or-app', query }
  }
  if (isQuestion(original)) return { type: 'question', prompt: original }
  const spoken = normalize(original)
  const chat = matchChatGpt(spoken, chats)
  if (chat) return chat
  const motion = matchMotion(spoken)
  if (motion) return motion
  const followed = matchFollow(spoken)
  if (followed) return followed
  const closed = matchClose(spoken, catalog)
  if (closed) return closed
  const opened = matchOpen(spoken, catalog)
  if (opened) return opened
  if (context.mailTab) return { type: 'mail', intent: { kind: 'search', query: cleanQuery(original.replace(/[.!?]+$/, '')) } }
  return { type: 'unknown', text: 'I can walk, sit, open or close an app, or follow the active window.' }
}

/**
 * "check mail": a read-only request handed to ChatGPT, which reads the mail
 * accounts connected there. MIKO never sees the mail or the summary.
 */
export const MAIL_REQUEST =
  'Check the email accounts currently connected to this ChatGPT account. ' +
  'Find unread messages that need my attention. Prioritize direct requests, ' +
  'deadlines, approvals, payments, interviews, and important follow-ups. ' +
  'Exclude spam, promotions, newsletters, shopping, and routine automated ' +
  'updates unless they contain a relevant deadline or action.\n\n' +
  'Group results into Urgent, Action needed, and Important FYI. For each ' +
  'message include the account, sender, subject, received date, a short ' +
  'summary, why it matters, the next action, and a link to the message. ' +
  'Keep messages unread and make this a read-only check. State which ' +
  'accounts and date range you checked, and disclose any access limits. ' +
  'Use my existing preferences when available.'

/** "check mail in ChatGPT": the read-only request handed to the ChatGPT app (MIKO sees no mail). */
function isCheckMailInChatGpt(spoken: string): boolean {
  return /^(?:check|chk)\s+(?:my\s+)?(?:e-?mails?|mail|inbox)\s+(?:in|with|using)\s+(?:chat\s*-?\s*gpt|gpt)$/.test(spoken)
}

const CHATGPT_NAME = '(?:chat\\s*-?\\s*gpt|chat\\s*g\\s*p\\s*t|gpt)'

/** "ask GPT <question>" / "ask ChatGPT, <question>". The question is kept exactly as written. */
function matchAskGpt(original: string): CommandResult | null {
  const match = new RegExp(`^(?:please\\s+)?ask\\s+${CHATGPT_NAME}\\b\\s*[,:\\-]?\\s*`, 'i').exec(original)
  if (!match) return null
  const question = original.slice(match[0].length).trim()
  if (!question) return { type: 'unknown', text: 'What should I ask? Say \u201cask GPT\u201d and then your question.' }
  return { type: 'ask-gpt', question }
}

function matchChatGpt(spoken: string, chats: SavedChat[]): CommandResult | null {
  if (new RegExp(`^(?:open|launch|start|show)\\s+(?:the\\s+)?${CHATGPT_NAME}(?:\\s+app)?$`).test(spoken)) {
    return { type: 'open-chatgpt' }
  }
  if (/^(?:show|list|open)\s+(?:my\s+)?saved\s+chats$/.test(spoken) || /^(?:show|list)\s+my\s+chats$/.test(spoken)) {
    return { type: 'list-chats' }
  }
  const opened = /^(?:open|go\s+to|switch\s+to)\s+(my\s+)?(.+?)(\s+(?:chat|conversation|project|gpt))?$/.exec(spoken)
  if (!opened?.[2]) return null
  const explicit = Boolean(opened[1] || opened[3])
  const name = opened[2].trim()
  const found = resolveChat(chats, name)
  if (found.kind === 'one') return { type: 'open-chat', name: found.chat.name, url: found.chat.url }
  if (found.kind === 'many') return { type: 'chat-choices', text: 'Which chat should I open?', options: found.chats }
  // "open my X chat" with no match is about chats; plain "open X" falls through to apps.
  if (explicit && opened[3]) return { type: 'missing', name, text: `I don\u2019t have a saved chat called \u201c${name}\u201d.` }
  return null
}

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[.!,]+$/g, '')
    .replace(/^(?:please\s+)?(?:(?:can|could)\s+you\s+)?/, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function isQuestion(text: string): boolean {
  if (/\?\s*$/.test(text)) return true
  const stripped = text.trim().replace(/^(?:please\s+)?(?:(?:can|could)\s+you\s+)?/i, '')
  return /^(how|what|why|when|who|where|which|explain|write|draft|compose|rewrite|summarize|tell me)\b/i.test(
    stripped
  )
}

function matchMotion(spoken: string): CommandResult | null {
  const little = spoken.match(/^(?:(?:move|go|walk)\s+)?(?:a little|a bit)(?:\s+to\s+the)?\s+(left|right)$/)
  if (little?.[1] === 'left' || little?.[1] === 'right') {
    return { type: 'move', direction: little[1], distance: LITTLE_DIP }
  }
  const step = spoken.match(/^(?:move|go|walk)\s+(left|right)$/)
  if (step?.[1] === 'left' || step?.[1] === 'right') {
    return { type: 'move', direction: step[1], distance: MOVE_DIP }
  }
  const corner = spoken.match(/^(?:go\s+to\s+the\s+)?(left|right)\s+corner$/)
  if (corner?.[1] === 'left' || corner?.[1] === 'right') return { type: 'corner', edge: corner[1] }
  if (spoken === 'come back' || spoken === 'come home') return { type: 'home' }
  if (spoken === 'sit') return { type: 'pose', pose: 'sit' }
  if (spoken === 'stand') return { type: 'pose', pose: 'stand' }
  if (spoken === 'stay' || spoken === 'stay there') return { type: 'pose', pose: 'stay' }
  if (spoken === 'resume wandering' || spoken === 'start wandering' || spoken === 'wander') {
    return { type: 'pose', pose: 'wander' }
  }
  return null
}

function matchFollow(spoken: string): CommandResult | null {
  if (spoken === 'stay here') return { type: 'follow', mode: 'stay' }
  if (spoken === 'follow me') return { type: 'follow', mode: 'follow' }
  if (spoken === 'come here') return { type: 'follow', mode: 'come' }
  return null
}

function matchClose(spoken: string, catalog: CatalogApp[]): CommandResult | null {
  if (spoken === 'quit' || spoken === 'exit' || /^(?:force\s+)?(?:close|quit)\s+(?:miko|yourself)$/.test(spoken)) {
    return { type: 'close-self' }
  }
  const forced = spoken.match(/^force\s+(?:close|quit)\s+(.+)$/)
  const closed = spoken.match(/^(?:close|quit)\s+(.+)$/)
  const raw = forced?.[1] ?? closed?.[1]
  if (!raw) return null
  const resolved = resolveApp(raw, catalog)
  if (resolved.kind === 'none') return { type: 'missing', name: resolved.label, text: `I can\u2019t find ${resolved.label}.` }
  if (resolved.kind === 'many') return choices(resolved.apps, 'close')
  if (!resolved.app.installed) return { type: 'missing', name: resolved.app.name, text: `I can\u2019t find ${resolved.app.name}.` }
  if (forced) return { type: 'force-close', appId: resolved.app.id, name: resolved.app.name }
  return { type: 'close', appId: resolved.app.id, name: resolved.app.name }
}

function matchOpen(spoken: string, catalog: CatalogApp[]): CommandResult | null {
  const opened = spoken.match(/^(?:open|launch|start)\s+(.+)$/)
  if (!opened?.[1]) return null
  const resolved = resolveApp(opened[1], catalog)
  if (resolved.kind === 'none') return { type: 'missing', name: resolved.label, text: `I can\u2019t find ${resolved.label}.` }
  if (resolved.kind === 'many') return choices(resolved.apps, 'open')
  return oneMatch(resolved.app)
}

function resolveApp(
  raw: string,
  catalog: CatalogApp[]
): { kind: 'one'; app: CatalogApp } | { kind: 'many'; apps: CatalogApp[] } | { kind: 'none'; label: string } {
  const query = raw.replace(/^(?:my|the)\s+/, '').trim()
  const full = raw.trim()
  if (!query) return { kind: 'none', label: 'that' }
  const exact = catalog.filter((app) => aliases(app).some((alias) => alias === full || alias === query))
  if (exact.length === 1) return { kind: 'one', app: exact[0] }
  if (exact.length > 1) {
    const installed = exact.filter((app) => app.installed)
    if (installed.length === 1) return { kind: 'one', app: installed[0] }
    if (installed.length > 1) return { kind: 'many', apps: installed }
    return { kind: 'none', label: exact[0].name }
  }
  const loose = catalog.filter((app) => app.installed && nameHit(app, query))
  if (loose.length === 1) return { kind: 'one', app: loose[0] }
  if (loose.length > 1) return { kind: 'many', apps: loose }
  return { kind: 'none', label: titleCase(query) }
}

function aliases(app: CatalogApp): string[] {
  return [app.name.toLowerCase(), ...app.aliases.map((alias) => alias.toLowerCase())]
}

function nameHit(app: CatalogApp, query: string): boolean {
  if (query.length < 3) return false
  const name = app.name.toLowerCase()
  if (name === query || name.startsWith(query + ' ') || name.endsWith(' ' + query) || name.includes(' ' + query + ' ')) {
    return true
  }
  return app.aliases.some((alias) => alias.toLowerCase() === query)
}

function oneMatch(app: CatalogApp): CommandResult {
  if (!app.installed) return { type: 'missing', name: app.name, text: `I can\u2019t find ${app.name}.` }
  if (!app.familiar) return { type: 'confirm', appId: app.id, name: app.name }
  return { type: 'launch', appId: app.id, name: app.name }
}

function choices(apps: CatalogApp[], purpose: 'open' | 'close'): CommandResult {
  return {
    type: 'choices',
    purpose,
    text: purpose === 'close' ? 'Which one should I close?' : 'Which one should I open?',
    options: apps.map((app) => ({ id: app.id, name: app.name, familiar: app.familiar }))
  }
}

function titleCase(value: string): string {
  return value.replace(/\b[a-z]/g, (letter) => letter.toUpperCase())
}

/**
 * What to do with a recognised voice command.
 * - run: clear, harmless commands execute right away
 * - confirm: closing, force quitting, quitting MIKO, or opening an unfamiliar app (existing confirm UI)
 * - handoff: questions and writing requests open the ChatGPT card for review
 * - review: the transcript goes into the chat box (ambiguous, unclear, or automatic execution is off)
 */
export type VoicePlan =
  | { kind: 'run' }
  | { kind: 'confirm' }
  | { kind: 'handoff' }
  | { kind: 'review'; reason: 'ambiguous' | 'unclear' | 'off' }

export function planVoice(decision: CommandResult, auto: boolean): VoicePlan {
  if (!auto) return { kind: 'review', reason: 'off' }
  switch (decision.type) {
    case 'move':
    case 'corner':
    case 'home':
    case 'pose':
    case 'follow':
    case 'launch':
    case 'open-chatgpt':
    case 'open-chat':
    case 'list-chats':
    case 'mail':
      return { kind: 'run' }
    case 'confirm':
    case 'close':
    case 'force-close':
    case 'close-self':
      return { kind: 'confirm' }
    case 'question':
    case 'ask-gpt':
    case 'check-mail':
      return { kind: 'handoff' }
    case 'choices':
    case 'chat-choices':
    case 'mail-or-app':
      return { kind: 'review', reason: 'ambiguous' }
    default:
      return { kind: 'review', reason: 'unclear' }
  }
}
