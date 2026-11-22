/**
 * Parse open → navigate → type plans without feeding the whole sentence into app lookup.
 * Typed and voice share the same shapes.
 */

import { detectNegations, newActionId, toneFromText, type ActionPlan, type ActionStep, type ToneHint } from './actions.ts'

export type TypeContentKind = 'literal' | 'polish' | 'recipient' | 'from-selection'

export interface TypeIntent {
  /** Ordered plan steps (open / new chat / insert / omnibox / choose). */
  plan: ActionPlan
  /** Text to insert (after tone strip); may still need model polish. */
  content: string
  contentKind: TypeContentKind
  tone: ToneHint
  /** Explicit submit requested (ask ChatGPT / send) — only via verified submit path. */
  submit: boolean
  /** Destination hint from the phrase. */
  destinationHint:
    | 'chatgpt'
    | 'omnibox'
    | 'notes'
    | 'here'
    | 'whatsapp'
    | 'choose'
    | null
}

function stripLead(raw: string): string {
  return raw
    .trim()
    .replace(/[.!,]+$/g, '')
    .replace(/^(?:ok(?:ay)?|please)\s+/i, '')
    .replace(/^(?:can|could)\s+you\s+/i, '')
    .trim()
}

function unquote(text: string): string {
  return text.trim().replace(/^["'\u201c\u2018](.*)["'\u201d\u2019]$/s, '$1').trim()
}

/** “Type exactly: …” — preserve verbatim. (WA “Draft:” stays on the WhatsApp path.) */
export function parseLiteralType(raw: string): { content: string } | null {
  const m = /^(?:type|write|put|paste|enter)\s+exactly\s*[:\-]?\s*(.+)$/is.exec(stripLead(raw))
  if (!m?.[1]) return null
  return { content: unquote(m[1]) }
}

/**
 * Compound / contextual type plans.
 * Returns null when the phrase is not a type-destination request.
 */
export function parseTypeIntent(raw: string, source: 'typed' | 'voice' = 'typed'): TypeIntent | null {
  const { send, type: dontType, reply, rest } = detectNegations(raw)
  if (dontType) return null
  const text = stripLead(rest)
  if (!text) return null

  const literal = parseLiteralType(text)
  if (literal) {
    return buildIntent({
      source,
      original: raw,
      content: literal.content,
      contentKind: 'literal',
      tone: null,
      submit: false,
      destinationHint: null,
      steps: [{ kind: 'insert_text', content: literal.content, app: null, target: 'active-or-choose' }]
    })
  }

  // “Open ChatGPT and ask it to summarize this.” (before generic type — “ask” ≠ type)
  const openGptAsk =
    /^(?:open|launch|start)\s+(?:the\s+)?(?:chat\s*gpt|chatgpt)(?:\s+app)?\s+(?:and\s+)?(?:then\s+)?ask(?:\s+it)?(?:\s+to)?\s+(.+)$/i.exec(
      text
    )
  if (openGptAsk?.[1]) {
    const body = openGptAsk[1].trim()
    const fromSelection = /\bthis\b|\bit\b|\bselection\b/i.test(body)
    return buildIntent({
      source,
      original: raw,
      content: body,
      contentKind: fromSelection ? 'from-selection' : 'polish',
      tone: null,
      submit: true,
      destinationHint: 'chatgpt',
      steps: [
        { kind: 'open_application', app: 'chatgpt', dependsOn: [] },
        {
          kind: 'insert_text',
          app: 'chatgpt',
          content: body,
          scope: fromSelection ? 'selection' : null,
          negations: { send: false },
          dependsOn: [0]
        }
      ]
    })
  }

  // “Open ChatGPT, start a new chat, and type …”
  const openGptNewType =
    /^(?:open|launch|start|show)\s+(?:the\s+)?(?:chat\s*gpt|chatgpt)(?:\s+app)?\s*[,.]?\s*(?:and\s+)?(?:(?:then\s+)?(?:start\s+(?:a\s+)?|create\s+(?:a\s+)?|open\s+(?:a\s+)?)?new\s+(?:chat|conversation|thread)\s*[,.]?\s*(?:and\s+)?)?(?:then\s+)?(?:type|write|put|paste|enter)\s+(.+)$/i.exec(
      text
    )
  if (openGptNewType?.[1]) {
    const body = openGptNewType[1].trim()
    const { tone, rest: content } = toneFromText(unquote(body.replace(/^(?:it\s+to\s+)/i, '')))
    const wantsNew = /new\s+(?:chat|conversation|thread)/i.test(text)
    const steps: ActionStep[] = [
      { kind: 'open_application', app: 'chatgpt', dependsOn: [] },
      ...(wantsNew ? [{ kind: 'chatgpt_new_chat' as const, dependsOn: [0] }] : []),
      {
        kind: 'insert_text',
        app: 'chatgpt',
        content,
        tone,
        negations: { send, reply },
        dependsOn: wantsNew ? [1] : [0]
      }
    ]
    return buildIntent({
      source,
      original: raw,
      content,
      contentKind: 'polish',
      tone,
      submit: false,
      destinationHint: 'chatgpt',
      steps
    })
  }

  // Contextual “New chat.” (ChatGPT destination already active — caller binds)
  if (/^(?:new\s+(?:chat|conversation|thread)|start\s+(?:a\s+)?new\s+(?:chat|conversation))$/i.test(text)) {
    return buildIntent({
      source,
      original: raw,
      content: '',
      contentKind: 'literal',
      tone: null,
      submit: false,
      destinationHint: 'chatgpt',
      steps: [{ kind: 'chatgpt_new_chat' }]
    })
  }

  // “Type this in Chrome’s address bar: youtube.com”
  const omnibox =
    /^(?:type|write|put|paste|enter)\s+(?:this\s+)?(?:in(?:to)?\s+)?(?:chrome(?:'s|’s)?\s+)?(?:the\s+)?(?:address|url|omnibox)\s+bar\s*[:\-]?\s*(.+)$/i.exec(
      text
    ) ||
    /^(?:type|write|put|paste|enter)\s+(.+?)\s+(?:in(?:to)?\s+)?(?:chrome(?:'s|’s)?\s+)?(?:the\s+)?(?:address|url|omnibox)\s+bar$/i.exec(
      text
    )
  if (omnibox?.[1]) {
    const content = unquote(omnibox[1])
    return buildIntent({
      source,
      original: raw,
      content,
      contentKind: 'literal',
      tone: null,
      submit: false,
      destinationHint: 'omnibox',
      steps: [{ kind: 'focus_omnibox', content, browser: 'chrome' }]
    })
  }

  // “Write in Notes that …” / “Type in Notes: …”
  const notes =
    /^(?:write|type|put|note)\s+(?:in(?:to)?\s+)?notes?\s+(?:that\s+|:\s*)(.+)$/i.exec(text) ||
    /^(?:write|type)\s+(?:a\s+)?note\s+(?:that\s+|:\s*|saying\s+)(.+)$/i.exec(text)
  if (notes?.[1]) {
    const { tone, rest: content } = toneFromText(unquote(notes[1]))
    return buildIntent({
      source,
      original: raw,
      content,
      contentKind: tone ? 'polish' : 'literal',
      tone,
      submit: false,
      destinationHint: 'notes',
      steps: [
        { kind: 'open_application', app: 'notes', dependsOn: [] },
        { kind: 'insert_text', app: 'notes', content, tone, dependsOn: [0] }
      ]
    })
  }

  // “Type here: …”
  const here =
    /^(?:type|write|put|paste|enter)\s+(?:it\s+)?here\s*[:\-]?\s*(.+)$/is.exec(text) ||
    /^(?:type|write|put|paste|enter)\s+(.+?)\s+here$/is.exec(text)
  if (here?.[1]) {
    const content = unquote(here[1])
    return buildIntent({
      source,
      original: raw,
      content,
      contentKind: 'literal',
      tone: null,
      submit: false,
      destinationHint: 'here',
      steps: [{ kind: 'insert_text', content, target: 'here' }]
    })
  }

  // Contextual follow-up “Type help me plan…” when a typing destination is already active
  // (caller must check destination context — we only match short type phrases without an app).
  // Never steal WhatsApp Draft:/attach/paste-file, or motion “type left”.
  if (/\b(?:file|pdf|attachment|document)\b/i.test(text) && /^(?:paste|attach|fetch|copy|save)\b/i.test(text)) {
    return null
  }
  const bareType =
    /^(?:type|write|enter)\s*[:\-]?\s*(.+)$/is.exec(text) ||
    /^(?:type|write)\s+(.+)$/is.exec(text)
  // Never steal “type in GPT …” — that belongs to matchTypeInGpt (exact prompt text).
  const namesGptTarget = /\b(?:whats?\s*app|chatgpt|chat\s*gpt|chrome|notes|safari)\b/i.test(text) ||
    /\bin(?:to)?\s+(?:the\s+)?(?:chat\s*-?\s*gpt|gpt)\b/i.test(text) ||
    /^(?:type|write|put|paste|enter)\s+(?:this\s+)?(?:in(?:to)?\s+)?(?:the\s+)?(?:chat\s*-?\s*gpt|gpt)\b/i.test(text)
  if (bareType?.[1] && !namesGptTarget) {
    const body = unquote(bareType[1])
    // Avoid stealing “type left” motion — those are handled earlier in the router.
    if (/^(?:left|right|a\s+little|home|back)\b/i.test(body)) return null
    const { tone, rest: content } = toneFromText(body)
    return buildIntent({
      source,
      original: raw,
      content,
      contentKind: 'literal',
      tone,
      submit: false,
      destinationHint: null,
      steps: [{ kind: 'insert_text', content, target: 'active-or-choose', tone }]
    })
  }

  // “Paste now” / “Choose where to type”
  if (/^(?:paste\s+now|insert\s+now|type\s+it\s+now)$/i.test(text)) {
    return buildIntent({
      source,
      original: raw,
      content: '',
      contentKind: 'literal',
      tone: null,
      submit: false,
      destinationHint: 'choose',
      steps: [{ kind: 'insert_text', target: 'focused-now' }]
    })
  }
  if (/^(?:choose\s+where\s+to\s+type|where\s+should\s+i\s+type|pick\s+(?:a|the)\s+(?:destination|field))$/i.test(text)) {
    return buildIntent({
      source,
      original: raw,
      content: '',
      contentKind: 'literal',
      tone: null,
      submit: false,
      destinationHint: 'choose',
      steps: [{ kind: 'choose_type_destination' }]
    })
  }

  return null
}

function buildIntent(opts: {
  source: 'typed' | 'voice'
  original: string
  content: string
  contentKind: TypeContentKind
  tone: ToneHint
  submit: boolean
  destinationHint: TypeIntent['destinationHint']
  steps: ActionStep[]
}): TypeIntent {
  return {
    plan: {
      id: newActionId(),
      source: opts.source,
      original: opts.original,
      steps: opts.steps,
      clarification: null,
      pending: opts.content
        ? { content: opts.content, tone: opts.tone, kind: opts.steps.find((s) => s.kind === 'insert_text')?.kind ?? 'insert_text' }
        : null
    },
    content: opts.content,
    contentKind: opts.contentKind,
    tone: opts.tone,
    submit: opts.submit,
    destinationHint: opts.destinationHint
  }
}

/** Whether a follow-up “type …” / “new chat” should bind to an active typing destination. */
export function isTypeFollowUp(raw: string): boolean {
  const t = stripLead(raw)
  if (/^(?:new\s+(?:chat|conversation|thread)|start\s+(?:a\s+)?new\s+(?:chat|conversation))$/i.test(t)) return true
  // “Type in GPT …” is a ChatGPT prompt handoff, not a contextual follow-up into the last field.
  if (/\bin(?:to)?\s+(?:the\s+)?(?:chat\s*-?\s*gpt|gpt)\b/i.test(t)) return false
  if (/^(?:type|write|put|paste|enter)\b/i.test(t) && !/\bwhats?\s*app\b/i.test(t)) return true
  if (/^(?:paste\s+now|insert\s+now|choose\s+where\s+to\s+type)$/i.test(t)) return true
  return false
}
