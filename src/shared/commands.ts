import { CHATGPT_HOME, resolveChat, type SavedChat } from './chatgpt.ts'
import { parsePetCommand, type PetId } from './pets.ts'
import { cleanQuery, parseMailCommand, type MailIntent } from './mail.ts'
import { LITTLE_DIP, MOVE_DIP } from './guide.ts'
import { parseBrowserOnly, resolveSite, splitBrowserPreference } from './sites.ts'
import { splitChromeProfilePhrase } from './chrome-profiles.ts'
import { parseInsteadQuery, parseWebSearch, webSearchName, webSearchUrl } from './web-search.ts'
import { detectNegations } from './actions.ts'
import { cleanContactQuery, parseWaRecipientCorrection } from './whatsapp.ts'
import {
  parseWhatsAppReplyIntent,
  parseWhatsAppSummarizeIntent,
  stripDraftInstructionFraming,
  type WhatsAppReplyIntent,
  type WhatsAppSummarizeIntent
} from './whatsapp-reply.ts'
import { matchProjectVideo } from './projector.ts'
import { parseAttachmentIntent, type WhatsAppAttachmentIntent } from './whatsapp-attachments.ts'
import { isFeedbackCommand } from './feedback.ts'
import { isSendItPhrase } from './send-destination.ts'
import { isTypeFollowUp, parseTypeIntent, type TypeIntent } from './type-plan.ts'

/** One router for typed text now and a speech transcript later. */
export type CommandSource = 'typed' | 'voice'

export interface CatalogApp {
  id: string
  name: string
  installed: boolean
  familiar: boolean
  aliases: string[]
}

/** Pending work the next utterance may finish (browser follow-up, held WhatsApp draft). */
export interface RouterContext {
  mailTab?: boolean
  assistantActive?: boolean
  messaging?: 'whatsapp' | null
  waDraftActive?: boolean
  /** Last website MIKO offered to open; “in Chrome” can finish it. */
  pendingUrl?: { url: string; name: string } | null
  /** Open WhatsApp chat MIKO last verified (for type/reply follow-ups). */
  waChat?: string | null
  /** Fresh selected-text capture is available. */
  hasSelection?: boolean
  /** Last website MIKO opened (for “close it”). */
  lastWebsite?: { url: string; name: string; browser?: string | null } | null
  /** A retrieved attachment file is held in working context. */
  hasRetrievedFile?: boolean
  /**
   * Contact search returned no match and a recipient correction is expected.
   * Bare names / “I meant …” resume the WhatsApp open — not the general assistant.
   */
  awaitingWaRecipient?: boolean
  /** Active typing destination (ChatGPT / Notes / field / omnibox) for follow-ups. */
  typeDestActive?: boolean
  typeDestKind?: string | null
  /** Last non-MIKO app before the panel took focus — for “go back” / “take me back”. */
  lastExternalApp?: { name: string; bundleId?: string } | null
  /** Last web search MIKO opened (“search instead for …”). */
  lastSearch?: { query: string; browser: string | null } | null
  /** Most recent explicit destination: a web search or WhatsApp. */
  recentDestination?: 'web' | 'whatsapp' | null
}

export type CommandResult =
  | { type: 'move'; direction: 'left' | 'right'; distance: number }
  | { type: 'corner'; edge: 'left' | 'right' }
  | { type: 'home' }
  | { type: 'pose'; pose: 'sit' | 'stand' | 'stay' | 'wander' }
  /** Casual-mode play: open the Play menu (activity null) or go straight to fetch. */
  | { type: 'play'; activity: 'fetch' | null }
  /** Open the video projector (mirror a chosen window above MIKO). */
  | { type: 'project-video' }
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
  | { type: 'bridge-test' }
  | { type: 'clear' }
  /** Switch MIKO's character, or open the pet chooser. */
  | { type: 'pet'; pet: PetId }
  | { type: 'pet-choose' }
  | { type: 'type-in-gpt'; text: string }
  /** Compound / destination typing plan (ChatGPT new chat, omnibox, Notes, type here, Paste now). */
  | { type: 'type-dest'; intent: TypeIntent }
  | { type: 'bridge-new' }
  | { type: 'whatsapp'; query: string; pendingDraft?: string }
  | { type: 'chat-or-whatsapp'; name: string }
  | { type: 'whatsapp-forget'; alias: string }
  | { type: 'whatsapp-aliases' }
  | { type: 'whatsapp-reply'; intent: WhatsAppReplyIntent }
  | { type: 'whatsapp-summarize'; intent: WhatsAppSummarizeIntent }
  | { type: 'whatsapp-attachment'; intent: WhatsAppAttachmentIntent }
  | {
      type: 'open-url'
      url: string
      name: string
      browser?: string | null
      chromeProfileQuery?: string | null
      /** Set for a general web search (the URL is the encoded search URL). */
      search?: string
    }
  | {
      type: 'chrome-profiles'
      /** Always show the fan even when a default is saved. */
      forceChooser: boolean
      /** Optional explicit profile name from the command (overrides default). */
      profileQuery?: string | null
      /** Optional URL to open after the profile is chosen (pending URL). */
      url?: string | null
      name?: string | null
    }
  | { type: 'close-website'; name: string; url?: string; host?: string; all?: boolean; thisTab?: boolean }
  | { type: 'cancel-workflow' }
  /** Submit the current bound draft (Interactive GPT) or report WhatsApp unsent policy. */
  | { type: 'send-it' }
  /** Open the private feedback form (never runs as an assistant prompt). */
  | { type: 'feedback' }
  | { type: 'unknown'; text: string }


const ACTION_ID =
  /^(chrome|browser|calculator|editor|downloads|files|word|excel|powerpoint|whatsapp|notes|app-[a-z0-9](?:[a-z0-9-]{0,58}[a-z0-9])?)$/

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

/**
 * Strip conversational lead-ins for command matching only.
 * Does not change casing or wording of the remaining content (negations stay).
 * “type exactly …” keeps trailing punctuation so the verbatim draft matches what was typed.
 */
export function commandLead(text: string): string {
  const trimmed = text.trim()
  const verbatimType =
    /^(?:(?:ok(?:ay)?|alright|sure|yeah|yep|yes)\s*[,.]?\s*)?(?:please\s+)?(?:(?:can|could)\s+you\s+)?type\s+exactly\b/i.test(
      trimmed
    )
  return trimmed
    .replace(verbatimType ? /$/ : /[.!,]+$/g, '')
    .replace(
      /^(?:(?:ok(?:ay)?|alright|sure|yeah|yep|yes)\s*[,.]?\s*)?(?:please\s+)?(?:(?:can|could)\s+you\s+)?/i,
      ''
    )
    .replace(/\s+/g, ' ')
    .trim()
}

export function routeCommand(
  text: string,
  _source: CommandSource,
  catalog: CatalogApp[],
  chats: SavedChat[] = [],
  context: RouterContext = {}
): CommandResult {
  const original = text.trim().slice(0, 2000)
  if (!original) return { type: 'unknown', text: 'I can walk, sit, open or close an app, or follow the active window.' }
  const lead = commandLead(original)
  const bridge = normalize(lead)
  if (
    /^(?:leave it|never mind|nevermind|cancel(?:\s+that)?|stop that|forget it|scratch that|abort that|drop it|skip that)$/i.test(
      bridge
    )
  ) {
    return { type: 'cancel-workflow' }
  }
  // “Send it” resolves against ContextSnapshot / draft bindings — never assistant prose.
  if (isSendItPhrase(original) || isSendItPhrase(lead) || isSendItPhrase(bridge)) {
    return { type: 'send-it' }
  }
  // Feedback is a dedicated UI path — never fall through to the assistant.
  if (isFeedbackCommand(original) || isFeedbackCommand(lead)) return { type: 'feedback' }
  if (/^(?:reply with\s+)?miko bridge test$/.test(bridge)) return { type: 'bridge-test' }
  // “New chat” with an active ChatGPT typing destination → ChatGPT new chat, not MIKO bridge reset.
  if (
    /^(?:bridge\s+|start\s+(?:a\s+)?)?new\s+(?:conversation|chat|thread)$/.test(bridge) &&
    context.typeDestActive &&
    (context.typeDestKind === 'chatgpt-composer' || context.typeDestKind === 'chatgpt' || !context.typeDestKind)
  ) {
    const intent = parseTypeIntent('New chat.', _source)
    if (intent) return { type: 'type-dest', intent }
  }
  if (/^(?:bridge\s+|start\s+(?:a\s+)?)?new\s+(?:conversation|chat|thread)$/.test(bridge)) return { type: 'bridge-new' }
  if (/^clear(?:\s+(?:the\s+)?(?:chat|all|screen|everything|panel|log|messages))?[.!]?$/i.test(lead)) return { type: 'clear' }
  // Pet switching only matches real pet names ("switch to the cat"), so "switch to Chrome" etc. route as before.
  const petCommand = parsePetCommand(lead)
  if (petCommand) return petCommand.kind === 'switch' ? { type: 'pet', pet: petCommand.pet } : { type: 'pet-choose' }

  // Chrome profile chooser / open-with-profile (before generic app open).
  const chromePhrase = splitChromeProfilePhrase(lead)
  if (chromePhrase.forceChooser) {
    return {
      type: 'chrome-profiles',
      forceChooser: true,
      profileQuery: null,
      url: context.pendingUrl?.url ?? null,
      name: context.pendingUrl?.name ?? null
    }
  }
  if (chromePhrase.browser === 'chrome' && chromePhrase.rest === '' && !chromePhrase.forceChooser) {
    // “open Chrome” / “open Chrome with Work”
    return {
      type: 'chrome-profiles',
      forceChooser: false,
      profileQuery: chromePhrase.profileQuery,
      url: null,
      name: null
    }
  }

  // Browser follow-up: “in Chrome” after “open YouTube”.
  const browserOnly = parseBrowserOnly(lead)
  if (browserOnly) {
    if (context.pendingUrl?.url) {
      return {
        type: 'open-url',
        url: context.pendingUrl.url,
        name: context.pendingUrl.name,
        browser: browserOnly,
        chromeProfileQuery: browserOnly === 'chrome' ? null : undefined
      }
    }
    return { type: 'unknown', text: 'Open what in that browser? Say “open YouTube in Chrome”, for example.' }
  }

  // General web search (“search Chrome for …”, “Google …”). WhatsApp destinations never match.
  const webSearch = parseWebSearch(lead, { lastSearch: context.lastSearch, recentDestination: context.recentDestination })
  if (webSearch) {
    return {
      type: 'open-url',
      url: webSearchUrl(webSearch.query),
      name: webSearchName(webSearch.query),
      browser: webSearch.browser,
      chromeProfileQuery: webSearch.browser === 'chrome' ? webSearch.profileQuery : undefined,
      search: webSearch.query
    }
  }

  // “Search instead for X” follows the destination in use: WhatsApp contact or web search (above).
  const insteadQuery = parseInsteadQuery(lead)
  if (insteadQuery) {
    if (context.recentDestination === 'whatsapp' || (!context.lastSearch && (context.messaging === 'whatsapp' || context.waChat))) {
      const contact = cleanContactQuery(insteadQuery)
      if (contact) return { type: 'whatsapp', query: contact }
    }
    return {
      type: 'unknown',
      text: `Search for “${insteadQuery}” where? Say “search Chrome for ${insteadQuery}” or “search for ${insteadQuery} in WhatsApp”.`
    }
  }

  const site = matchOpenSite(lead)
  if (site) return site

  const waMessagingEarly = context.messaging || (context.waChat ? 'whatsapp' : null)

  // “type … in GPT” / “type in gpt to …” must keep the exact prompt path — before type-dest follow-ups.
  const typedEarly = matchTypeInGpt(lead)
  if (typedEarly) return typedEarly

  // Compound open→navigate→type plans before generic app-name lookup.
  // Do not steal WhatsApp Draft:/tell/attach/type-exactly, or bare type without an active destination.
  const typeDest = parseTypeIntent(lead, _source)
  if (typeDest) {
    const exactLiteral = /^(?:type|write|put|paste|enter)\s+exactly\b/i.test(lead)
    // With an active WhatsApp chat, “type exactly …” stays on the WA reply path.
    const allowExact = exactLiteral && !waMessagingEarly
    const compound =
      typeDest.destinationHint === 'chatgpt' ||
      typeDest.destinationHint === 'omnibox' ||
      typeDest.destinationHint === 'notes' ||
      typeDest.destinationHint === 'here' ||
      typeDest.destinationHint === 'choose' ||
      allowExact ||
      (context.typeDestActive && isTypeFollowUp(lead) && !waMessagingEarly) ||
      typeDest.plan.steps.some(
        (s) => s.kind === 'chatgpt_new_chat' || s.kind === 'focus_omnibox' || (s.kind === 'open_application' && (s.app === 'chatgpt' || s.app === 'notes'))
      )
    if (compound) return { type: 'type-dest', intent: typeDest }
  }

  const typed = matchTypeInGpt(lead)
  if (typed) return typed
  const asked = matchAskGpt(lead)
  if (asked) return asked
  if (isCheckMailInChatGpt(normalize(lead))) return { type: 'check-mail', prompt: MAIL_REQUEST }

  const closedSite = matchCloseWebsite(lead, context)
  if (closedSite) return closedSite

  const waMessaging = waMessagingEarly

  // Exact play phrases (“play fetch”) before attachment “fetch …” wording.
  const played = matchPlay(normalize(lead))
  if (played) return played
  if (matchProjectVideo(normalize(lead))) return { type: 'project-video' }

  // Attachment fetch/copy/attach — before assistant fallback (verified chat checked at run time).
  const waAttachment = parseAttachmentIntent(lead)
  if (waAttachment) {
    const followUpOnly =
      context.hasRetrievedFile &&
      (waAttachment.op === 'copy-file' ||
        waAttachment.op === 'copy-filename' ||
        waAttachment.op === 'copy-path' ||
        waAttachment.op === 'show-finder' ||
        waAttachment.op === 'open' ||
        waAttachment.op === 'attach-here' ||
        waAttachment.op === 'attach-elsewhere' ||
        waAttachment.op === 'save-downloads')
    if (
      followUpOnly ||
      waMessaging === 'whatsapp' ||
      Boolean(context.waChat) ||
      /\bwhats?\s*app\b/i.test(lead) ||
      waAttachment.op === 'fetch' ||
      waAttachment.op === 'save-downloads' ||
      waAttachment.op === 'copy-file' ||
      waAttachment.op === 'attach-here'
    ) {
      return { type: 'whatsapp-attachment', intent: waAttachment }
    }
  }

  // With a verified WhatsApp target, summarize/reply beat mail “reply saying …” and app opens.
  const waSum = parseWhatsAppSummarizeIntent(lead, {
    messaging: waMessaging,
    waChat: context.waChat
  })
  if (waSum) return { type: 'whatsapp-summarize', intent: waSum }

  const waReplyEarly = parseWhatsAppReplyIntent(lead, {
    messaging: waMessaging,
    draftActive: context.waDraftActive,
    waChat: context.waChat
  })
  if (waReplyEarly && waMessaging === 'whatsapp') return { type: 'whatsapp-reply', intent: waReplyEarly }

  const mail = parseMailCommand(lead)
  if (mail) return { type: 'mail', intent: mail }
  const whatsapp = matchWhatsApp(lead)
  if (whatsapp) return whatsapp

  // Failed contact search: correct the name before generic “search for …” follow-ups.
  if (context.awaitingWaRecipient) {
    const earlyCorrection = parseWaRecipientCorrection(lead)
    if (earlyCorrection) return { type: 'whatsapp', query: earlyCorrection }
  }

  // “search for Mukundan” right after WhatsApp is active — contact search, not app/mail lookup.
  if (waMessaging === 'whatsapp') {
    const waFollow = matchWhatsAppContextFollowUp(lead)
    if (waFollow) return waFollow
  }

  // Named recipient / Draft: / reply-to-X without prior messaging (mail already handled above).
  if (waReplyEarly) return { type: 'whatsapp-reply', intent: waReplyEarly }
  const bareSearch = /^(?:search|find|look\s+for|dig\s+up|hunt\s+down|pull\s+up)\s+(?:for\s+)?(.+)$/i.exec(
    lead.replace(/[.!?]+$/, '')
  )
  if (bareSearch?.[1]) {
    const query = cleanQuery(bareSearch[1])
    // Require an explicit mail cue (“mail”, “email”, “inbox”) — bare “find invoice” stays mail-or-app.
    const mailish = /\b(?:mail|email|inbox|message\s+from)\b/i.test(bareSearch[1])
    if (context.mailTab || mailish) return { type: 'mail', intent: { kind: 'search', query } }
    // While awaiting a WhatsApp recipient fix, “find Santosh G” is a contact retry — not mail-or-app.
    if (context.awaitingWaRecipient) {
      const contact = parseWaRecipientCorrection(lead)
      if (contact) return { type: 'whatsapp', query: contact }
    }
    return { type: 'mail-or-app', query }
  }
  const spoken = normalize(lead)
  // Explicit local supersedes (motion / apps) beat a pending recipient correction.
  const motionEarly = matchMotion(spoken)
  if (motionEarly) return motionEarly
  const followedEarly = matchFollow(spoken)
  if (followedEarly) return followedEarly
  const closedEarly = matchClose(spoken, catalog)
  if (closedEarly) return closedEarly
  const openedEarly = matchOpen(spoken, catalog, context)
  if (openedEarly && openedEarly.type !== 'missing') return openedEarly

  // Failed contact search: “Santosh G” / “I meant Santosh G” resume the open — not the assistant.
  if (context.awaitingWaRecipient) {
    const correction = parseWaRecipientCorrection(lead)
    if (correction) return { type: 'whatsapp', query: correction }
  }

  if (isQuestion(lead)) return { type: 'question', prompt: original }
  // “Open Gayu Sis” after Open WhatsApp — catalog apps first, else WhatsApp contact.
  if (waMessaging === 'whatsapp') {
    const openContact = matchOpenContactWhileMessaging(lead, catalog, spoken)
    if (openContact) return openContact
  }
  const chat = matchChatGpt(phrase(lead), chats, context.messaging)
  if (chat) return chat
  if (openedEarly) return openedEarly
  if (context.mailTab) return { type: 'mail', intent: { kind: 'search', query: cleanQuery(lead.replace(/[.!?]+$/, '')) } }
  // While an assistant conversation is active, anything that isn't a local command is a follow-up.
  if (context.assistantActive) return { type: 'question', prompt: original }
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
const MAIL_RULES =
  'Keep messages unread and make this a read-only check. State which accounts and date range you checked, ' +
  'and disclose any access limits.'

/**
 * The read-only request handed to the ChatGPT app for a mail intent when MIKO has
 * no mailbox of its own. ChatGPT reads the mail; MIKO never sees it.
 */
export function mailRequestFor(intent: MailIntent): string {
  if (intent.kind === 'recent' || intent.kind === 'important' || intent.kind === 'category') return MAIL_REQUEST
  if (intent.kind === 'unread') {
    return (
      'Show my unread email from the accounts currently connected to this ChatGPT account, newest first. ' +
      'For each message include the account, sender, subject, received date, a short summary, and a link to the message. ' +
      MAIL_RULES
    )
  }
  if (intent.kind === 'search') {
    return (
      `Search the email accounts currently connected to this ChatGPT account for: ${intent.query}. ` +
      'List matching messages newest first with the account, sender, subject, received date, a short summary, ' +
      'and a link to the message. This is a read-only search. ' +
      MAIL_RULES
    )
  }
  return ''
}

function isCheckMailInChatGpt(spoken: string): boolean {
  return /^(?:check|chk)\s+(?:my\s+)?(?:e-?mails?|mail|inbox)\s+(?:in|with|using)\s+(?:chat\s*-?\s*gpt|gpt)$/.test(spoken)
}

const CHATGPT_NAME = '(?:chat\\s*-?\\s*gpt|chat\\s*g\\s*p\\s*t|gpt)'

/** "type <text> in GPT" / "put this in ChatGPT: <text>". The text is kept exactly as written. */
function matchTypeInGpt(original: string): CommandResult | null {
  // Explicit composer targeting — including “dictate into GPT …” (not a MIKO command body).
  const verb = '(?:please\\s+)?(?:type|write|put|paste|enter|dictate)'
  const target = `(?:in|into)\\s+(?:the\\s+)?(?:interactive\\s+gpt|chatgpt\\s+web|${CHATGPT_NAME})(?:\\s+app)?`
  const unquote = (text: string): string => text.trim().replace(/^["'\u201c\u2018](.*)["'\u201d\u2019]$/s, '$1').trim()
  const colon = new RegExp(`^${verb}\\s+(?:this\\s+)?${target}\\s*[:,\\-]\\s*(.+)$`, 'is').exec(original)
  if (colon?.[1]) return { type: 'type-in-gpt', text: unquote(colon[1]) }
  if (new RegExp(`^${verb}\\s+(?:this\\s+|something\\s+)?${target}[.!]?$`, 'i').test(original)) {
    return { type: 'unknown', text: 'What should I type in ChatGPT? Say \u201ctype \u2026 in GPT\u201d.' }
  }
  // "type in gpt asking it to <request>" / "type in chatgpt to <request>" / "type in gpt <request>"
  const lead = new RegExp(
    `^${verb}\\s+${target}\\s+(?:(?:and\\s+)?(?:ask(?:ing)?|tell(?:ing)?)\\s+(?:it|him|her|gpt|chatgpt)\\s+(?:to\\s+)?|to\\s+|saying\\s+|that\\s+)?(.+)$`,
    'is'
  ).exec(original)
  if (lead?.[1]) return { type: 'type-in-gpt', text: unquote(lead[1]) }
  const inline = new RegExp(`^${verb}\\s+(.+?)\\s+${target}[.!]?$`, 'is').exec(original)
  if (inline?.[1]) return { type: 'type-in-gpt', text: unquote(inline[1]) }
  // Messages addressed to GPT: "hi gpt", "hey ChatGPT, …" (typed as-is), "gpt: …", "tell gpt to …".
  if (new RegExp(`^(?:hi|hey|hello|yo|ok|okay)\\s+${CHATGPT_NAME}\\b`, 'i').test(original)) {
    return { type: 'type-in-gpt', text: original.trim() }
  }
  const addressed = new RegExp(`^${CHATGPT_NAME}\\s*[,:]\\s*(.+)$`, 'is').exec(original)
  if (addressed?.[1]) return { type: 'type-in-gpt', text: addressed[1].trim() }
  const tell = new RegExp(`^tell\\s+${CHATGPT_NAME}\\s+(?:to\\s+)?(.+)$`, 'is').exec(original)
  if (tell?.[1]) return { type: 'type-in-gpt', text: tell[1].trim() }
  return null
}

/** "ask GPT <question>" / "ask ChatGPT, <question>". The question is kept exactly as written. */
function matchAskGpt(original: string): CommandResult | null {
  const match = new RegExp(`^(?:please\\s+)?ask\\s+${CHATGPT_NAME}\\b\\s*[,:\\-]?\\s*`, 'i').exec(original)
  if (!match) return null
  const question = original.slice(match[0].length).trim()
  if (!question) return { type: 'unknown', text: 'What should I ask? Say \u201cask GPT\u201d and then your question.' }
  return { type: 'ask-gpt', question }
}

/** Canonical WhatsApp token after app-slot normalization (never rewrite contact names). */
const WHATSAPP_NAME = 'WhatsApp'
/** App-slot spelling variants only: WhatsApp, whats app, Whatsaappp, … */
const WHATSAPP_APP_SLOT = '(?:whats\\s*app+|whats?a+p+)'

/**
 * True when raw is an unambiguous WhatsApp app-name spelling (app slot only).
 * Does not fuzzy-match contact names or message bodies.
 */
export function isWhatsAppAppName(raw: string): boolean {
  const compact = raw.toLowerCase().replace(/[\s._-]+/g, '')
  if (compact === 'wa') return true
  return /^whats?a+p+$/.test(compact)
}

/**
 * Normalize WhatsApp spelling in app-name slots only (open X / in X / X chat).
 * Contact names and message bodies are left unchanged.
 */
export function normalizeWhatsAppAppSlots(raw: string): string {
  let text = raw
  text = text.replace(new RegExp(`\\b(?:in|on)\\s+(${WHATSAPP_APP_SLOT})\\b`, 'gi'), (full, slot: string) =>
    isWhatsAppAppName(slot) ? full.replace(slot, WHATSAPP_NAME) : full
  )
  text = text.replace(
    new RegExp(`^(open|launch|start|bring\\s+up|fire\\s+up)\\s+(${WHATSAPP_APP_SLOT})\\b`, 'i'),
    (full, verb: string, slot: string) => (isWhatsAppAppName(slot) ? `${verb} ${WHATSAPP_NAME}` : full)
  )
  text = text.replace(new RegExp(`\\b(${WHATSAPP_APP_SLOT})\\s+chat\\b`, 'gi'), (full, slot: string) =>
    isWhatsAppAppName(slot) ? `${WHATSAPP_NAME} chat` : full
  )
  text = text.replace(new RegExp(`\\b(${WHATSAPP_APP_SLOT})\\s+alias(?:es)?\\b`, 'gi'), (full, slot: string) =>
    isWhatsAppAppName(slot) ? full.replace(slot, WHATSAPP_NAME) : full
  )
  return text
}

/** Strip a leading "for" left by “search for …”. */
function stripSearchFor(raw: string): string {
  return raw.replace(/^(?:for\s+)/i, '').trim()
}

/**
 * "open Mum in WhatsApp", "open WhatsApp and search for Mukundan",
 * "find Mukundan on WhatsApp", "Open Mukundan in Whatsaappp".
 */
function matchWhatsApp(original: string): CommandResult | null {
  const text = normalizeWhatsAppAppSlots(
    original
      .trim()
      .replace(/[.!,]+$/g, '')
      .replace(/^(?:please\s+)?(?:(?:can|could)\s+you\s+)?/i, '')
  )
  const forget = new RegExp(`^(?:forget|remove|delete)\\s+(?:the\\s+)?${WHATSAPP_NAME}\\s+alias\\s+(.+)$`, 'i').exec(text)
  if (forget?.[1]) {
    const alias = cleanContactQuery(forget[1])
    return alias ? { type: 'whatsapp-forget', alias } : { type: 'unknown', text: 'Which WhatsApp name should I forget?' }
  }
  if (new RegExp(`^(?:show|list)\\s+(?:my\\s+)?${WHATSAPP_NAME}\\s+aliases$`, 'i').test(text)) return { type: 'whatsapp-aliases' }
  const person = (raw: string, pendingDraft?: string): CommandResult | null => {
    const query = cleanContactQuery(stripSearchFor(raw.replace(/^(?:my|the)\s+/i, '').replace(/\s+chat$/i, '')))
    if (!query || isWhatsAppAppName(query) || /^whatsapp$/i.test(query)) return null
    return pendingDraft ? { type: 'whatsapp', query, pendingDraft } : { type: 'whatsapp', query }
  }

  // “Open WhatsApp and search for Mukundan” / “open WhatsApp and open Mukundan” —
  // dependent open+search plan; never pass the whole sentence to the app registry.
  // Contact-only (no draft): navigation must not invent a message.
  const openThenContact = new RegExp(
    `^(?:open|launch|start|bring\\s+up)\\s+${WHATSAPP_NAME}\\s*[,.]?\\s+(?:and\\s+|then\\s+)*(?:search(?:\\s+for)?|find|look\\s+for|open|message|go\\s+to)\\s+(.+)$`,
    'i'
  ).exec(text)
  if (openThenContact?.[1] && !/\band\s+(?:say|tell|type|write|draft|reply|send)\b/i.test(openThenContact[1])) {
    return person(openThenContact[1])
  }

  // “Open WhatsApp, go to Dad and say good morning.”
  const openWaGoTell = new RegExp(
    `^(?:open|launch|start|bring\\s+up)\\s+${WHATSAPP_NAME}\\s*[,.]?\\s+(?:and\\s+|then\\s+)*(?:go\\s+to|open|message|find)\\s+(.+?)\\s+(?:and\\s+)?(?:then\\s+)?(?:type|write|draft|say|tell(?:\\s+(?:him|her|them))?|reply(?:\\s+(?:saying|that|with))?|send)\\s+(.+)$`,
    'i'
  ).exec(text)
  if (openWaGoTell?.[1] && openWaGoTell[2]?.trim()) {
    const { rest } = detectNegations(openWaGoTell[2].trim())
    const draft = stripDraftInstructionFraming(rest || openWaGoTell[2].trim())
    if (draft) return person(openWaGoTell[1], draft)
    return person(openWaGoTell[1])
  }

  // “open Dad in WhatsApp and tell him …” / “… and reply saying …” —
  // navigate first; wrappers like “saying” stay out of the held draft.
  const openAndType = new RegExp(
    `^(?:open|message|find|search(?:\\s+for)?|go\\s+to)\\s+(.+?)\\s+(?:in|on)\\s+${WHATSAPP_NAME}\\s+(?:and\\s+)?(?:then\\s+)?(?:type|write|draft|say|tell(?:\\s+(?:him|her|them))?|reply(?:\\s+(?:saying|that|with))?|send)\\s+(.+)$`,
    'i'
  ).exec(text)
  if (openAndType?.[1] && openAndType[2]?.trim()) {
    const { rest } = detectNegations(openAndType[2].trim())
    if (/\bdon'?t\s+type\b/i.test(openAndType[2]) && !rest) return person(openAndType[1])
    const draft = stripDraftInstructionFraming(rest || openAndType[2].trim())
    if (!draft) return person(openAndType[1])
    return person(openAndType[1], draft)
  }
  const inApp = new RegExp(
    `^(?:open|message|find|search(?:\\s+for)?|look\\s+for)\\s+(.+?)\\s+(?:in|on)\\s+${WHATSAPP_NAME}$`,
    'i'
  ).exec(text)
  if (inApp?.[1]) return person(inApp[1])
  const withPerson = new RegExp(`^(?:open|start)\\s+(?:a\\s+)?${WHATSAPP_NAME}\\s+chat\\s+with\\s+(.+)$`, 'i').exec(text)
  if (withPerson?.[1]) return person(withPerson[1])
  return null
}

/**
 * After WhatsApp is the active messaging context:
 * - “search for Gayu Sis” / “find …” → contact search
 * - Bare “open Gayu Sis” is handled in routeCommand (catalog apps win; else contact)
 */
function matchWhatsAppContextFollowUp(lead: string): CommandResult | null {
  const text = lead.trim().replace(/[.!?]+$/g, '')
  const m = /^(?:search(?:\s+for)?|find|look\s+for)\s+(.+)$/i.exec(text)
  if (!m?.[1]) return null
  if (/\b(?:mail|email|inbox|gmail)\b/i.test(m[1])) return null
  if (isWhatsAppAppName(m[1]) || /^whatsapp$/i.test(m[1].trim())) return null
  const query = cleanContactQuery(stripSearchFor(m[1].replace(/^(?:my|the)\s+/i, '').replace(/\s+chat$/i, '')))
  if (!query || query.length > 60) return null
  return { type: 'whatsapp', query }
}

/**
 * “Open Gayu Sis” while messaging=whatsapp: known catalog apps still launch;
 * otherwise treat as a WhatsApp contact (never invent aliases).
 */
function matchOpenContactWhileMessaging(
  lead: string,
  catalog: CatalogApp[],
  spoken: string
): CommandResult | null {
  const text = lead.trim().replace(/[.!?]+$/g, '')
  // Navigation only — never invent a draft from “go to Dad” / “open Dad”.
  const m = /^(?:open|launch|start|message|go\s+to|switch\s+to)\s+(.+)$/i.exec(text)
  if (!m?.[1]) return null
  const raw = m[1].trim()
  if (!raw || /\band\s+/i.test(raw) || /\b(?:in|on)\s+/i.test(raw)) return null
  if (isWhatsAppAppName(raw) || /^whatsapp$/i.test(raw)) return null
  // Known apps / Chrome / sites already handled earlier; matchOpen catches Calculator etc.
  const asApp = matchOpen(spoken, catalog, {})
  if (asApp && asApp.type !== 'missing') return asApp
  const query = cleanContactQuery(raw.replace(/^(?:my|the)\s+/i, '').replace(/\s+chat$/i, ''))
  if (!query || query.length > 60 || isWhatsAppAppName(query)) return null
  return { type: 'whatsapp', query }
}

/** Dev / test diagnostics: normalized instruction, action, capability — no chat bodies. */
export function routeDiagnostics(
  raw: string,
  decision: CommandResult
): { normalized: string; action: string; capability: string } {
  const normalized = commandLead(raw).slice(0, 200)
  let capability: string = decision.type
  if (decision.type === 'whatsapp') capability = 'open_whatsapp_chat'
  else if (decision.type === 'whatsapp-reply') capability = decision.intent.refine ? 'refine_draft' : 'draft_whatsapp'
  else if (decision.type === 'whatsapp-summarize') capability = 'summarize_whatsapp'
  else if (decision.type === 'whatsapp-attachment') capability = 'fetch_whatsapp_attachment'
  else if (decision.type === 'launch' || decision.type === 'confirm') capability = 'open_application'
  else if (decision.type === 'missing') capability = 'open_application'
  else if (decision.type === 'cancel-workflow') capability = 'cancel_task'
  const action =
    decision.type === 'whatsapp'
      ? `whatsapp:${decision.query}`
      : decision.type === 'missing'
        ? `missing:${decision.name}`
        : decision.type === 'launch'
          ? `launch:${decision.appId}`
          : decision.type
  return { normalized, action, capability }
}

/** True when the open target is ChatGPT / GPT (not a saved chat name). */
function isChatGptOpenName(raw: string): boolean {
  const q = raw
    .trim()
    .toLowerCase()
    .replace(/^(?:the\s+|my\s+|a\s+)/, '')
    .replace(/\s+app$/, '')
    .replace(/\s+/g, ' ')
  return /^(?:chat\s*-?\s*gpt|chat\s*g\s*p\s*t|gpt)$/i.test(q)
}

/** “open YouTube” / “boot up that video site” — local browser action, not an app catalog miss. */
function matchOpenSite(lead: string): CommandResult | null {
  const m = /^(?:open|launch|start|run|go\s+to|visit|boot\s+up|fire\s+up|bring\s+up|pull\s+up)\s+(.+)$/i.exec(lead)
  if (!m?.[1]) return null
  // Profile-aware: “gmail.com in my Work Chrome profile”
  const chromeBit = splitChromeProfilePhrase(m[1])
  const afterProfile = (chromeBit.profileQuery ? chromeBit.rest : m[1]).replace(/\s+(?:for\s+me|please)$/i, '').trim()
  const { rest, browser } = splitBrowserPreference(afterProfile)
  const cleaned = rest.replace(/\s+(?:for\s+me|please)$/i, '').trim()
  const preferredBrowser = chromeBit.browser || browser
  // “Open ChatGPT in Chrome/Safari” → website + browser (not an app named “Chatgpt In Chrome”).
  // Bare “Open ChatGPT” stays for matchChatGpt → native app.
  if (!resolveSite(cleaned) && isChatGptOpenName(cleaned) && preferredBrowser) {
    return {
      type: 'open-url',
      url: CHATGPT_HOME,
      name: 'ChatGPT',
      browser: preferredBrowser,
      chromeProfileQuery: chromeBit.profileQuery
    }
  }
  const site = resolveSite(cleaned)
  if (!site) return null
  return {
    type: 'open-url',
    url: site.url,
    name: site.name,
    browser: preferredBrowser,
    chromeProfileQuery: chromeBit.profileQuery
  }
}

function closeSiteResult(site: { url: string; name: string }, all?: boolean): CommandResult {
  try {
    return { type: 'close-website', name: site.name, url: site.url, host: new URL(site.url).hostname, all }
  } catch {
    return { type: 'close-website', name: site.name, url: site.url, all }
  }
}

/** “close YouTube”, “get rid of every YouTube tab”, “close this tab”, “close it”. */
function matchCloseWebsite(lead: string, context: RouterContext): CommandResult | null {
  if (/^(?:close|quit)\s+(?:this\s+)?tab$/i.test(lead)) {
    return { type: 'close-website', name: 'this tab', thisTab: true }
  }
  const all =
    /^(?:close|quit|get\s+rid\s+of|ditch|kill|remove)\s+(?:all|every)\s+(.+?)\s+tabs?$/i.exec(lead) ||
    /^(?:close|quit)\s+all\s+(.+?)\s+tabs?$/i.exec(lead)
  if (all?.[1]) {
    const site = resolveSite(all[1].replace(/\s+tabs?$/i, '').trim())
    if (site) return closeSiteResult(site, true)
  }
  if (/^(?:close|quit)\s+(?:it|that)$/i.test(lead) && context.lastWebsite?.url) {
    return {
      type: 'close-website',
      name: context.lastWebsite.name,
      url: context.lastWebsite.url,
      host: (() => {
        try {
          return new URL(context.lastWebsite!.url).hostname
        } catch {
          return undefined
        }
      })()
    }
  }
  const closed = /^(?:close|quit|get\s+rid\s+of|ditch|kill|remove)\s+(.+)$/i.exec(lead)
  if (!closed?.[1]) return null
  // Don’t steal app quits (“close Chrome”, “close WhatsApp”).
  if (/^(?:chrome|safari|firefox|edge|brave|whats?app|chatgpt|miko|yourself|the\s+browser)$/i.test(closed[1].trim())) {
    return null
  }
  const { rest } = splitBrowserPreference(closed[1])
  const site = resolveSite(rest.replace(/^(?:all|every)\s+/i, '').replace(/\s+tabs?$/i, '').trim())
  if (!site) return null
  const wantsAll = /\b(?:all|every)\b/i.test(closed[1])
  return closeSiteResult(site, wantsAll || undefined)
}

function exactSavedChat(chats: SavedChat[], name: string): SavedChat | null {
  const needle = name.toLowerCase()
  return chats.find((chat) => chat.name.toLowerCase() === needle) ?? null
}

function phrase(original: string): string {
  return original
    .trim()
    .replace(/[.!,]+$/g, '')
    .replace(/^(?:please\s+)?(?:(?:can|could)\s+you\s+)?/i, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function matchChatGpt(spoken: string, chats: SavedChat[], messaging?: 'whatsapp' | null): CommandResult | null {
  // Bare app open — no browser suffix.
  if (new RegExp(`^(?:open|launch|start|show)\\s+(?:the\\s+)?${CHATGPT_NAME}(?:\\s+app)?$`, 'i').test(spoken)) {
    return { type: 'open-chatgpt' }
  }
  // “Open ChatGPT in Chrome” should already be handled by matchOpenSite; keep a safety net.
  const withBrowser = new RegExp(
    `^(?:open|launch|start|show)\\s+(?:the\\s+)?${CHATGPT_NAME}(?:\\s+app)?\\s+((?:in|with|using)\\s+.+)$`,
    'i'
  ).exec(spoken)
  if (withBrowser?.[1]) {
    const { browser } = splitBrowserPreference(`x ${withBrowser[1]}`.trim())
    if (browser) {
      return { type: 'open-url', url: CHATGPT_HOME, name: 'ChatGPT', browser }
    }
  }
  if (/^(?:show|list|open)\s+(?:my\s+)?saved\s+chats$/i.test(spoken) || /^(?:show|list)\s+my\s+chats$/i.test(spoken)) {
    return { type: 'list-chats' }
  }
  const opened = /^(?:open|go\s+to|switch\s+to)\s+(my\s+)?(.+?)(\s+(?:chat|conversation|project|gpt))?$/i.exec(spoken)
  if (!opened?.[2]) return null
  const name = opened[2].trim()
  // "open Muku chat": an exact saved chat wins. Otherwise a WhatsApp context, or a question.
  // "my" keeps the saved-chat wording, including a clear miss.
  if (!opened[1] && (opened[3]?.trim() === 'chat' || opened[3]?.trim() === 'conversation')) {
    if (new RegExp(`^${WHATSAPP_NAME}$`).test(name)) return null
    const exact = exactSavedChat(chats, name)
    if (exact) return { type: 'open-chat', name: exact.name, url: exact.url }
    if (messaging === 'whatsapp') return { type: 'whatsapp', query: name }
    return { type: 'chat-or-whatsapp', name }
  }
  const explicit = Boolean(opened[1] || opened[3])
  const found = resolveChat(chats, name)
  if (found.kind === 'one') return { type: 'open-chat', name: found.chat.name, url: found.chat.url }
  if (found.kind === 'many') return { type: 'chat-choices', text: 'Which chat should I open?', options: found.chats }
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
  return /^(how|what|why|when|who|where|which|explain|write|draft|compose|rewrite|summari[sz]e|tell me|give me|list|translate|suggest|define|describe|compare|generate|brainstorm|outline|proofread|rephrase|paraphrase|calculate|convert|recommend|say|create|make|plan|help me)\b/i.test(
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
  return matchPlay(spoken)
}

/** Exact play phrases only, so “play music” / “play <song>” keep going to Spotify. */
export function matchPlay(spoken: string): CommandResult | null {
  const text = spoken.replace(/[.!?]+$/g, '').replace(/^(?:hey\s+)?miko[,\s]+/, '').replace(/’/g, "'").trim()
  if (/^(?:let'?s\s+)?play\s+fetch$|^throw\s+(?:the|a|my)\s+(?:ball|stick)$|^go\s+fetch$/.test(text)) {
    return { type: 'play', activity: 'fetch' }
  }
  if (/^(?:let'?s\s+play|play\s+with\s+(?:me|miko)|play\s*time|open\s+play|show\s+play)$/.test(text)) {
    return { type: 'play', activity: null }
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
  if (!resolved.app.installed) return { type: 'missing', name: resolved.app.name, text: notInstalledText(resolved.app.name) }
  if (forced) return { type: 'force-close', appId: resolved.app.id, name: resolved.app.name }
  return { type: 'close', appId: resolved.app.id, name: resolved.app.name }
}

/**
 * Open / focus / switch apps. “Go to Cursor”, “Switch to Spotify”, “Bring WhatsApp forward”,
 * “Take me back to Chrome”, and bare “Open Calculator” share this path (before assistant fallback).
 * Negations and questions must not reach here as actions.
 */
function matchOpen(spoken: string, catalog: CatalogApp[], context: RouterContext = {}): CommandResult | null {
  // “Don’t switch to Cursor” / “never open Chrome” — leave for question/unknown, never launch.
  if (
    /^(?:don'?t|do\s+not|never)\s+(?:open|launch|start|go\s+to|switch\s+to|bring|take\s+me|focus|show)\b/i.test(
      spoken
    )
  ) {
    return null
  }

  // Bare “back” / “take me back” / “go back” → last verified external app.
  if (/^(?:(?:take\s+me|switch|go|come)\s+)?back(?:\s+please)?$/.test(spoken) || spoken === 'back') {
    const last = context.lastExternalApp?.name?.trim()
    if (!last) {
      return {
        type: 'unknown',
        text: 'I’m not sure which app to go back to. Name it — for example “go to Chrome”.'
      }
    }
    return resolveOpenTarget(last, last, catalog, null)
  }

  const bring = /^(?:bring|put)\s+(.+?)\s+(?:forward|to\s+(?:the\s+)?front|in\s+front)$/i.exec(spoken)
  const opened =
    bring ||
    /^(?:open|launch|start|show|focus|go\s+(?:back\s+)?to|switch\s+(?:back\s+)?to|take\s+me\s+(?:back\s+)?to)\s+(.+)$/i.exec(
      spoken
    )
  if (!opened?.[1]) return null
  // Compound open+search must not become an app-catalog miss (“Whatsapp And Search For …”).
  if (/\band\s+(?:then\s+)?(?:search|find|look\s+for|open|message)\b/i.test(opened[1])) return null
  const { rest, browser } = splitBrowserPreference(opened[1])
  // Prefer the name without “in Chrome” so browser never becomes part of a missing-app label.
  const appTarget = rest || opened[1]
  if (isChatGptOpenName(appTarget) && browser) {
    return { type: 'open-url', url: CHATGPT_HOME, name: 'ChatGPT', browser }
  }
  // Sites still prefer matchOpenSite (earlier). Keep a safety net for “go to youtube” if it reached here.
  const site = resolveSite(appTarget)
  if (site) return { type: 'open-url', url: site.url, name: site.name, browser }
  return resolveOpenTarget(appTarget, opened[1], catalog, browser)
}

function resolveOpenTarget(
  appTarget: string,
  rawOpened: string,
  catalog: CatalogApp[],
  browser: string | null
): CommandResult {
  void browser
  const appRaw = isWhatsAppAppName(appTarget) || isWhatsAppAppName(rawOpened) ? 'whatsapp' : appTarget
  const resolved = resolveApp(appRaw, catalog)
  if (resolved.kind === 'none') return { type: 'missing', name: resolved.label, text: `I can\u2019t find ${resolved.label}.` }
  if (resolved.kind === 'many') return choices(resolved.apps, 'open')
  return oneMatch(resolved.app)
}

function resolveApp(
  raw: string,
  catalog: CatalogApp[]
): { kind: 'one'; app: CatalogApp } | { kind: 'many'; apps: CatalogApp[] } | { kind: 'none'; label: string } {
  // Compare case-insensitively (voice/typed are normalized; lastExternalApp names may be Title Case).
  const query = raw
    .replace(/^(?:my|the)\s+/i, '')
    .trim()
    .toLowerCase()
  const full = raw.trim().toLowerCase()
  if (!query) return { kind: 'none', label: 'that' }
  // App-slot spelling only — map Whatsaappp → WhatsApp catalog entry.
  if (isWhatsAppAppName(query) || isWhatsAppAppName(full)) {
    const wa = catalog.find((app) => app.id === 'whatsapp' || aliases(app).includes('whatsapp'))
    if (wa) return { kind: 'one', app: wa }
  }
  const exact = catalog.filter((app) => aliases(app).some((alias) => alias === full || alias === query))
  if (exact.length === 1) return { kind: 'one', app: exact[0] }
  if (exact.length > 1) {
    const installed = exact.filter((app) => app.installed)
    if (installed.length === 1) return { kind: 'one', app: installed[0] }
    if (installed.length > 1) return { kind: 'many', apps: installed }
    // Known app, none installed → caller reports "isn't installed" (not a lookup miss).
    return { kind: 'one', app: exact[0] }
  }
  const loose = catalog.filter((app) => app.installed && nameHit(app, query))
  if (loose.length === 1) return { kind: 'one', app: loose[0] }
  if (loose.length > 1) return { kind: 'many', apps: loose }
  return { kind: 'none', label: titleCase(query) }
}

/** A known app (Calculator, WhatsApp…) that this computer doesn't have — not a lookup failure. */
export function notInstalledText(name: string): string {
  return `${name} isn\u2019t installed on this computer.`
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
  if (!app.installed) return { type: 'missing', name: app.name, text: notInstalledText(app.name) }
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
    case 'clear':
    case 'pet':
    case 'pet-choose':
    case 'type-in-gpt':
    case 'type-dest':
    case 'mail':
    case 'bridge-test':
    case 'bridge-new':
    case 'whatsapp':
    case 'whatsapp-forget':
    case 'whatsapp-aliases':
    case 'whatsapp-reply':
    case 'whatsapp-summarize':
    case 'whatsapp-attachment':
    case 'open-url':
    case 'chrome-profiles':
    case 'close-website':
    case 'cancel-workflow':
    case 'send-it':
    case 'feedback':
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
    case 'chat-or-whatsapp':
    case 'mail-or-app':
      return { kind: 'review', reason: 'ambiguous' }
    default:
      return { kind: 'review', reason: 'unclear' }
  }
}
