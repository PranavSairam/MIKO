/**
 * AI interpretation layer for unfamiliar wording → validated ActionPlan.
 * Never accepts shell commands, scripts, IPC names, or executable code.
 */

import { availableKinds } from './capabilities.ts'
import {
  detectNegations,
  newActionId,
  toneFromText,
  type ActionKind,
  type ActionPlan,
  type ActionStep,
  type ToneHint
} from './actions.ts'
import type { CorrectionExample, MikoStructuredPreferences } from './preferences.ts'

const ALLOWED = new Set<string>([
  'open_application',
  'close_application',
  'open_website',
  'close_website',
  'close_browser_tab',
  'search_whatsapp_contacts',
  'open_whatsapp_chat',
  'summarize_whatsapp',
  'list_whatsapp_attachments',
  'fetch_whatsapp_attachment',
  'copy_file',
  'attach_file',
  'draft_whatsapp',
  'refine_draft',
  'search_mail',
  'prepare_mail_reply',
  'summarize_text',
  'rewrite_text',
  'cancel_task',
  'ask_assistant',
  'clarify',
  'unsupported'
])

export interface InterpretContext {
  platform: 'darwin' | 'win32'
  waChat?: string | null
  lastWebsite?: string | null
  preferredBrowser?: string | null
  examples?: CorrectionExample[]
  preferences?: MikoStructuredPreferences | null
}

/** Prompt asking the model for a JSON action plan only. */
export function interpretPrompt(text: string, ctx: InterpretContext): string {
  const kinds = availableKinds(ctx.platform).filter((k) => ALLOWED.has(k))
  const examples = (ctx.examples ?? [])
    .slice(0, 3)
    .map((e) => `- “${e.wording}” → ${e.actionKind}${e.targetAlias ? ` (target: ${e.targetAlias})` : ''}`)
    .join('\n')
  const prefLine = ctx.preferences
    ? `Preferred browser: ${ctx.preferences.preferredBrowser || 'unset'}. Writing tone: ${ctx.preferences.writingTone || 'natural'}.`
    : ''
  return [
    'Map the user request to a JSON action plan for the MIKO desktop assistant.',
    'Return ONLY a JSON object with this shape:',
    '{"steps":[{"kind":"...","app":null,"target":null,"content":null,"tone":null,"scope":null,"browser":null,"url":null}],"clarification":null}',
    '',
    `Allowed kind values: ${kinds.join(', ')}.`,
    'Rules:',
    '- Do not invent kinds outside the allowlist.',
    '- Put contact names only in "target". Put what the user wants to communicate in "content" as a drafting instruction (preserve casing of names/facts). "content" is NOT the final WhatsApp text — MIKO rewrites tell/say/ask/let-her-know framing into a direct message.',
    '- Prefer compound plans: open_whatsapp_chat then draft_whatsapp.',
    '- summarize_whatsapp is read-only (composer unchanged). draft_whatsapp never sends. Never press Send or Return to submit.',
    '- fetch_whatsapp_attachment downloads a visible document only; never upload file contents to the model.',
    '- attach_file pastes a file unsent; never press Send.',
    '- If unclear, use kind clarify with clarification set to one short question.',
    '- Never output shell commands, scripts, code, or IPC channel names.',
    prefLine ? `\nApproved preferences (not training data):\n${prefLine}` : '',
    examples ? `\nApproved correction examples (not training data):\n${examples}` : '',
    ctx.waChat ? `\nVerified WhatsApp chat: ${ctx.waChat}` : '',
    ctx.lastWebsite ? `\nLast opened website: ${ctx.lastWebsite}` : '',
    '',
    'User request:',
    text.slice(0, 2000)
  ]
    .filter(Boolean)
    .join('\n')
}

function asTone(v: unknown): ToneHint {
  if (v === 'formal' || v === 'professional' || v === 'friendly' || v === 'polite' || v === 'shorter' || v === 'longer' || v === 'casual' || v === 'natural') {
    return v
  }
  return null
}

function asScope(v: unknown): ActionStep['scope'] {
  if (v === 'incoming' || v === 'conversation' || v === 'selection' || v === 'visible') return v
  return null
}

/** Validate model JSON into an ActionPlan or null. */
export function parseInterpretResult(raw: string, original: string, _source: 'typed' | 'voice' = 'typed'): ActionPlan | null {
  const trimmed = raw.trim()
  const fence = /^```(?:json)?\s*([\s\S]*?)```$/i.exec(trimmed)
  const body = fence?.[1]?.trim() || trimmed
  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch {
    const start = body.indexOf('{')
    const end = body.lastIndexOf('}')
    if (start < 0 || end <= start) return null
    try {
      parsed = JSON.parse(body.slice(start, end + 1))
    } catch {
      return null
    }
  }
  const obj = parsed as { steps?: unknown; clarification?: unknown }
  if (!Array.isArray(obj.steps) || obj.steps.length === 0 || obj.steps.length > 6) return null
  const steps: ActionStep[] = []
  for (const row of obj.steps) {
    const s = row as Record<string, unknown>
    const kind = typeof s.kind === 'string' ? s.kind : ''
    if (!ALLOWED.has(kind)) return null
    steps.push({
      kind: kind as ActionKind,
      app: typeof s.app === 'string' ? s.app.slice(0, 80) : null,
      target: typeof s.target === 'string' ? s.target.slice(0, 80) : null,
      content: typeof s.content === 'string' ? s.content.slice(0, 2000) : null,
      tone: asTone(s.tone),
      scope: asScope(s.scope),
      browser: typeof s.browser === 'string' ? s.browser.slice(0, 40) : null,
      url: typeof s.url === 'string' ? s.url.slice(0, 2000) : null
    })
  }
  const clarification = typeof obj.clarification === 'string' ? obj.clarification.slice(0, 200) : null
  return {
    id: newActionId(),
    source: 'interpreted',
    original,
    steps,
    clarification,
    pending: null
  }
}

/** Deterministic compound plan for well-known shapes (no model). */
export function tryDeterministicPlan(raw: string, source: 'typed' | 'voice'): ActionPlan | null {
  const { send, type, reply, rest } = detectNegations(raw)
  const text = rest
    .replace(/[.!,]+$/g, '')
    .replace(/^(?:ok(?:ay)?|please)\s+/i, '')
    .replace(/^(?:can|could)\s+you\s+/i, '')
    .trim()
  const openTell =
    /^(?:open|message|find)\s+(.+?)\s+(?:in|on)\s+whats?\s*a+p+\s+(?:and\s+)?(?:then\s+)?(?:tell(?:\s+(?:him|her|them))?|type|say|reply(?:\s+with)?)\s+(.+)$/i.exec(
      text
    ) ||
    /^(?:ping|nudge|message|msg|text)\s+(.+?)\s+(?:on|in)\s+(?:wa|whats?\s*a+p+)\s+(?:that|saying|with)\s+(.+)$/i.exec(text) ||
    /^(?:ping|nudge|message|msg|text)\s+(.+?)\s+(?:on|in)\s+(?:wa|whats?\s*a+p+)\s+(.+)$/i.exec(text)
  if (openTell?.[1] && openTell[2] && !type) {
    const { tone, rest: content } = toneFromText(openTell[2].trim())
    return {
      id: newActionId(),
      source,
      original: raw,
      steps: [
        { kind: 'open_whatsapp_chat', target: openTell[1].trim(), dependsOn: [] },
        {
          kind: 'draft_whatsapp',
          target: openTell[1].trim(),
          content,
          tone,
          negations: { send, reply },
          dependsOn: [0]
        }
      ],
      clarification: null,
      pending: { content, tone, kind: 'draft_whatsapp' }
    }
  }
  // “Open WhatsApp and search for Mukundan” — open/focus then contact search (no draft).
  const openThenSearch =
    /^(?:open|launch|start)\s+whats?\s*a+p+\s+(?:and\s+)?(?:then\s+)?(?:search(?:\s+for)?|find|look\s+for|open)\s+(.+)$/i.exec(
      text
    )
  if (openThenSearch?.[1]) {
    const target = openThenSearch[1].replace(/^(?:for\s+)/i, '').trim()
    if (target) {
      return {
        id: newActionId(),
        source,
        original: raw,
        steps: [{ kind: 'open_whatsapp_chat', target, dependsOn: [] }],
        clarification: null,
        pending: null
      }
    }
  }
  return null
}

export type InterpretRouteDecision = {
  type: string
  text?: string
}

/**
 * When deterministic routing leaves work unresolved, MIKO should call the schema-validated
 * AI interpreter — including some “question” shapes that are really local paraphrases.
 * This is structural (context + wording classes), not a list of eval phrases.
 */
export function shouldTryInterpreter(
  decision: InterpretRouteDecision,
  text: string,
  context: {
    waChat?: string | null
    messaging?: 'whatsapp' | null
    waDraftActive?: boolean
    pendingUrl?: { url: string; name: string } | null
  } = {}
): boolean {
  if (decision.type === 'unknown') return true
  const t = text.trim()
  // App-catalog misses must not block interpretation of messaging/open+search phrasing.
  if (
    decision.type === 'missing' &&
    /\b(?:whats?\s*a+p+|search\s+for|find|look\s+for)\b/i.test(t) &&
    /\b(?:open|launch|start|search|find|in|on)\b/i.test(t)
  ) {
    return true
  }
  if (decision.type !== 'question' && decision.type !== 'ask-gpt') return false
  if (context.waDraftActive && /\b(?:draft|shorter|briefer|trim|tighten|formal|polite|rewrite)\b/i.test(t)) return true
  if (
    (context.waChat || context.messaging === 'whatsapp') &&
    /\b(?:chat|thread|message|scoop|gist|recap|tldr|rundown|update)\b/i.test(t)
  ) {
    return true
  }
  if (context.pendingUrl && /\b(?:chrome|safari|firefox|edge|brave|browser)\b/i.test(t)) return true
  return false
}
