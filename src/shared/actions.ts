/**
 * Typed action plans shared by typed and spoken requests.
 * Message content is never title-cased or stripped while matching.
 */

export type ActionKind =
  | 'open_application'
  | 'close_application'
  | 'open_website'
  | 'close_website'
  | 'close_browser_tab'
  | 'list_browser_tabs'
  | 'search_whatsapp_contacts'
  | 'open_whatsapp_chat'
  | 'read_whatsapp_messages'
  | 'summarize_whatsapp'
  | 'list_whatsapp_attachments'
  | 'fetch_whatsapp_attachment'
  | 'copy_file'
  | 'attach_file'
  | 'draft_whatsapp'
  | 'insert_whatsapp_draft'
  | 'refine_draft'
  | 'search_mail'
  | 'read_mail_thread'
  | 'prepare_mail_reply'
  | 'read_selected_text'
  | 'replace_selected_text'
  | 'summarize_text'
  | 'rewrite_text'
  /** Launch/focus ChatGPT then create a new chat (verified empty composer). */
  | 'chatgpt_new_chat'
  /** Insert into a verified editable destination without sending. */
  | 'insert_text'
  /** Focus browser address bar and set text without navigating. */
  | 'focus_omnibox'
  /** Ask the owner to pick/focus where to type, then Paste now. */
  | 'choose_type_destination'
  | 'cancel_task'
  | 'ask_assistant'
  | 'clarify'
  | 'unsupported'

export type ToneHint = 'formal' | 'professional' | 'friendly' | 'polite' | 'shorter' | 'longer' | 'casual' | 'natural' | null

/** One step in a multi-step plan. */
export interface ActionStep {
  kind: ActionKind
  /** App id or browser id when known. */
  app?: string | null
  /** Contact, chat, tab, or resource name — never the message body. */
  target?: string | null
  /** Exact user message / instruction content (original casing). */
  content?: string | null
  tone?: ToneHint
  /** Incoming-only vs full conversation for summaries. */
  scope?: 'incoming' | 'conversation' | 'selection' | 'visible' | null
  /** Browser preference: chrome, safari, … */
  browser?: string | null
  /** Site URL when resolved. */
  url?: string | null
  /** Do not send / do not type flags from negation. */
  negations?: { send?: boolean; type?: boolean; reply?: boolean }
  /** Depends on earlier step indices succeeding. */
  dependsOn?: number[]
}

export interface ActionPlan {
  /** Unique id assigned when the plan starts executing. */
  id: string
  source: 'typed' | 'voice' | 'interpreted'
  /** Original user text, unchanged. */
  original: string
  steps: ActionStep[]
  /** Short clarification question when a step cannot proceed. */
  clarification?: string | null
  /** Held content while waiting on a choice (recipient, tab). */
  pending?: { content?: string; tone?: ToneHint; kind?: ActionKind } | null
}

export type TaskPhase =
  | 'understanding'
  | 'needs_choice'
  | 'reading_context'
  | 'generating'
  | 'executing'
  | 'verifying'
  /** Unrelated general question mid-task — purpose retained until resume or cancel. */
  | 'suspended'
  | 'completed'
  | 'cancelled'
  | 'failed'

export function newActionId(): string {
  return `act-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

/** Detect common negation phrases without mutating the rest of the text. */
export function detectNegations(raw: string): { send: boolean; type: boolean; reply: boolean; rest: string } {
  let rest = raw.trim()
  let send = false
  let type = false
  let reply = false
  if (/\bdon'?t\s+send\b|\bdo\s+not\s+send\b|\bnever\s+send\b/i.test(rest)) {
    send = true
    rest = rest.replace(/\b(?:and\s+)?(?:please\s+)?(?:don'?t|do\s+not|never)\s+send(?:\s+it)?\b/gi, ' ').replace(/\s+/g, ' ').trim()
  }
  if (/\bdon'?t\s+type\b|\bdo\s+not\s+type\b|\bbut\s+don'?t\s+type\b/i.test(rest)) {
    type = true
    rest = rest.replace(/\b(?:and\s+|but\s+)?(?:please\s+)?(?:don'?t|do\s+not)\s+type(?:\s+anything)?\b/gi, ' ').replace(/\s+/g, ' ').trim()
  }
  if (/\bdon'?t\s+reply\b|\bdo\s+not\s+reply\b|\bsummarize,?\s+don'?t\s+reply\b/i.test(rest)) {
    reply = true
    rest = rest.replace(/\b(?:and\s+)?(?:please\s+)?(?:don'?t|do\s+not)\s+reply\b/gi, ' ').replace(/\s+/g, ' ').trim()
  }
  return { send, type, reply, rest }
}

export function toneFromText(raw: string): { tone: ToneHint; rest: string } {
  const m =
    /^(.+?)(?:,\s*|\s+)(?:professionally|formally|in\s+a\s+(?:formal|professional|friendly|polite|casual)\s+(?:way|tone|style)|more\s+(?:formal|friendly|polite)|keep\s+it\s+(?:proper|polite|formal|professional|friendly|casual)|friendly|politely)$/i.exec(
      raw.trim()
    )
  if (!m?.[1]) return { tone: null, rest: raw.trim() }
  const tag = m[0].slice(m[1].length).toLowerCase()
  let tone: ToneHint = 'formal'
  if (/friend/.test(tag)) tone = 'friendly'
  else if (/polite/.test(tag)) tone = 'polite'
  else if (/casual/.test(tag)) tone = 'casual'
  else if (/professional/.test(tag)) tone = 'professional'
  else if (/proper/.test(tag)) tone = 'formal'
  return { tone, rest: m[1].trim().replace(/[,\s]+$/, '') }
}
