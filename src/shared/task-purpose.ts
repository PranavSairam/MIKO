/**
 * Structured purpose for an in-flight task — extends TaskRecord / WorkingContext
 * without a second context system. Clarification answers bind here first.
 */

import type { ToneHint } from './actions.ts'
import { cleanContactQuery, parseChooserIndex, parseWaRecipientCorrection } from './whatsapp.ts'

/** Where a contextual fact came from — never invent verified IDs. */
export type FactSource = 'explicit' | 'observed' | 'preference' | 'inference'

export type ClarificationKind =
  | 'recipient'
  | 'chooser'
  | 'time'
  | 'browser'
  | 'attachment'
  | 'ambiguous_ref'
  | 'resume'
  /** “Send in ChatGPT or WhatsApp?” */
  | 'send_destination'

export interface PendingClarification {
  kind: ClarificationKind
  /** Short question shown to the owner. */
  question: string
  /** Option ids/names when kind is chooser / attachment / browser. */
  options?: { id: string; name: string; detail?: string }[]
  /** Held instruction while waiting (recipient / ambiguous). */
  held?: HeldWaDraft | null
  createdAt: number
  /** Soft expiry — after this, ask whether to resume instead of acting. */
  expiresAt?: number
}

/** Held open+tell / draft payload until a chat is verified. */
export interface HeldWaDraft {
  instruction: string
  tone?: ToneHint
  pronoun?: 'him' | 'her' | 'them'
  literal?: boolean
  source: FactSource
}

/** Compact purpose kept on TaskRecord while the task is live or suspended. */
export interface TaskPurpose {
  /** Owner’s original goal line (unchanged casing). */
  goal: string
  /** Verified destination when known (WhatsApp header, etc.). */
  destination?: string | null
  destinationSource?: FactSource
  /** Unresolved recipient / search query. */
  unresolvedQuery?: string | null
  /** Message instruction retained across failed searches. */
  heldDraft?: HeldWaDraft | null
  /** Active clarification, if any. */
  clarification?: PendingClarification | null
  /** Completed step kinds. */
  completedSteps: string[]
  /** Next step kind when known. */
  nextStep?: string | null
  /** Bumps when context objects change mid-task. */
  revision: number
  /** Suspended across an unrelated general question. */
  suspended?: boolean
  updatedAt: number
}

export const CLARIFICATION_TTL_MS = 30 * 60 * 1000

export function createPurpose(goal: string, partial?: Partial<TaskPurpose>): TaskPurpose {
  return {
    goal: goal.slice(0, 500),
    destination: partial?.destination ?? null,
    destinationSource: partial?.destinationSource,
    unresolvedQuery: partial?.unresolvedQuery ?? null,
    heldDraft: partial?.heldDraft ?? null,
    clarification: partial?.clarification ?? null,
    completedSteps: partial?.completedSteps ?? [],
    nextStep: partial?.nextStep ?? null,
    revision: partial?.revision ?? 1,
    suspended: partial?.suspended ?? false,
    updatedAt: Date.now()
  }
}

export function bumpPurposeRevision(purpose: TaskPurpose, patch?: Partial<TaskPurpose>): TaskPurpose {
  return {
    ...purpose,
    ...patch,
    revision: purpose.revision + 1,
    updatedAt: Date.now()
  }
}

export function heldDraftFromInstruction(
  instruction: string,
  opts?: { tone?: ToneHint; pronoun?: 'him' | 'her' | 'them'; literal?: boolean }
): HeldWaDraft {
  return {
    instruction: instruction.trim(),
    tone: opts?.tone ?? null,
    pronoun: opts?.pronoun,
    literal: opts?.literal === true,
    source: 'explicit'
  }
}

export function clarificationExpired(c: PendingClarification, now = Date.now()): boolean {
  if (!c.expiresAt) return now - c.createdAt > CLARIFICATION_TTL_MS
  return now > c.expiresAt
}

export type ClarificationAnswer =
  | { kind: 'recipient'; query: string }
  | { kind: 'chooser'; optionId: string; name: string }
  | { kind: 'time'; choice: string }
  | { kind: 'browser'; browser: 'chrome' | 'safari' }
  | { kind: 'attachment'; label: 'pdf' | 'file' | 'image' | 'other'; text: string }
  | { kind: 'cancel' }
  | { kind: 'start_over' }
  | { kind: 'go_back' }
  | { kind: 'resume_yes' }
  | { kind: 'resume_no' }
  | { kind: 'unrelated' }

/** Parse “start over” / “go back” / cancel-scoped phrases. */
export function parseTaskControl(raw: string): ClarificationAnswer | null {
  const t = raw.trim().replace(/[.!?]+$/g, '')
  if (/^(?:start\s+over|begin\s+again|restart(?:\s+that)?)$/i.test(t)) return { kind: 'start_over' }
  if (/^(?:go\s+back|back\s+up|previous\s+step)$/i.test(t)) return { kind: 'go_back' }
  if (
    /^(?:leave it|never mind|nevermind|cancel(?:\s+that)?|stop that|forget it|scratch that|abort that|drop it|skip that)$/i.test(
      t
    )
  ) {
    return { kind: 'cancel' }
  }
  return null
}

/**
 * Resolve a short answer against the active clarification — before assistant fallback.
 * Returns `unrelated` when the text does not answer the pending question.
 */
export function resolveClarificationAnswer(
  raw: string,
  clarification: PendingClarification | null | undefined
): ClarificationAnswer {
  const control = parseTaskControl(raw)
  if (control) return control
  if (!clarification) return { kind: 'unrelated' }

  const text = raw.trim().replace(/[.!?]+$/g, '')
  if (!text) return { kind: 'unrelated' }

  if (clarification.kind === 'resume') {
    if (/^(?:yes|y|yeah|yep|resume|continue|pick\s+it\s+up)$/i.test(text)) return { kind: 'resume_yes' }
    if (/^(?:no|n|nope|discard|drop\s+it|forget\s+it)$/i.test(text)) return { kind: 'resume_no' }
    return { kind: 'unrelated' }
  }

  if (clarification.kind === 'recipient') {
    const query = parseWaRecipientCorrection(text)
    if (query) return { kind: 'recipient', query }
    return { kind: 'unrelated' }
  }

  if (clarification.kind === 'chooser' && clarification.options?.length) {
    const index = parseChooserIndex(text, clarification.options.length)
    if (index !== null) {
      const opt = clarification.options[index]
      if (opt) return { kind: 'chooser', optionId: opt.id, name: opt.name }
    }
    const named = clarification.options.find((o) => o.name.toLowerCase() === text.toLowerCase())
    if (named) return { kind: 'chooser', optionId: named.id, name: named.name }
    // “No, the PDF” style attachment disambiguation when options look like files.
    const attach = parseAttachmentCorrection(text)
    if (attach) {
      const hit = clarification.options.find((o) =>
        attach.label === 'pdf'
          ? /\.pdf\b/i.test(o.name) || /pdf/i.test(o.detail || '')
          : new RegExp(attach.label, 'i').test(o.name)
      )
      if (hit) return { kind: 'chooser', optionId: hit.id, name: hit.name }
      return { kind: 'attachment', ...attach }
    }
    return { kind: 'unrelated' }
  }

  if (clarification.kind === 'time') {
    if (clarification.options?.length) {
      const index = parseChooserIndex(text, clarification.options.length)
      if (index !== null) {
        const opt = clarification.options[index]
        if (opt) return { kind: 'time', choice: opt.name }
      }
      const named = clarification.options.find((o) => o.name.toLowerCase() === text.toLowerCase())
      if (named) return { kind: 'time', choice: named.name }
    }
    if (/^(?:tomorrow|today|tonight|monday|tuesday|wednesday|thursday|friday|saturday|sunday|next\s+week|this\s+week|afternoon|morning|evening|\d{1,2}(?::\d{2})?\s*(?:am|pm)?)/i.test(text)) {
      return { kind: 'time', choice: text }
    }
    return { kind: 'unrelated' }
  }

  if (clarification.kind === 'browser') {
    if (/\bchrome\b/i.test(text)) return { kind: 'browser', browser: 'chrome' }
    if (/\bsafari\b/i.test(text)) return { kind: 'browser', browser: 'safari' }
    return { kind: 'unrelated' }
  }

  if (clarification.kind === 'attachment') {
    const attach = parseAttachmentCorrection(text)
    if (attach) return { kind: 'attachment', ...attach }
    return { kind: 'unrelated' }
  }

  if (clarification.kind === 'send_destination') {
    if (/^(?:chat\s*-?\s*gpt|chatgpt|gpt|interactive\s+gpt)$/i.test(text)) {
      return { kind: 'chooser', optionId: 'chatgpt', name: 'ChatGPT' }
    }
    if (/^whats?app$/i.test(text)) {
      return { kind: 'chooser', optionId: 'whatsapp', name: 'WhatsApp' }
    }
    if (clarification.options?.length) {
      const index = parseChooserIndex(text, clarification.options.length)
      if (index !== null) {
        const opt = clarification.options[index]
        if (opt) return { kind: 'chooser', optionId: opt.id, name: opt.name }
      }
      const named = clarification.options.find(
        (o) => o.name.toLowerCase() === text.toLowerCase() || text.toLowerCase().includes(o.name.toLowerCase())
      )
      if (named) return { kind: 'chooser', optionId: named.id, name: named.name }
    }
    return { kind: 'unrelated' }
  }

  if (clarification.kind === 'ambiguous_ref') {
    // Owner named which object — treat as free-text choice among options when present.
    if (clarification.options?.length) {
      const index = parseChooserIndex(text, clarification.options.length)
      if (index !== null) {
        const opt = clarification.options[index]
        if (opt) return { kind: 'chooser', optionId: opt.id, name: opt.name }
      }
      const named = clarification.options.find(
        (o) => o.name.toLowerCase() === text.toLowerCase() || text.toLowerCase().includes(o.name.toLowerCase())
      )
      if (named) return { kind: 'chooser', optionId: named.id, name: named.name }
      // Free-text answers for “who does her/him refer to?”
      if (
        clarification.options.some((o) => o.id === 'recipient' || o.id === 'someone-else') &&
        /(?:the\s+)?(?:person\s+i(?:'|’)?m\s+messaging|recipient|them|the\s+chat)\b/i.test(text)
      ) {
        const opt = clarification.options.find((o) => o.id === 'recipient')
        if (opt) return { kind: 'chooser', optionId: opt.id, name: opt.name }
      }
      if (
        clarification.options.some((o) => o.id === 'someone-else') &&
        /someone\s+else|another\s+person|a\s+different\s+person|not\s+(?:them|the\s+recipient)/i.test(text)
      ) {
        const opt = clarification.options.find((o) => o.id === 'someone-else')
        if (opt) return { kind: 'chooser', optionId: opt.id, name: opt.name }
      }
    }
    return { kind: 'unrelated' }
  }

  return { kind: 'unrelated' }
}

function parseAttachmentCorrection(text: string): { label: 'pdf' | 'file' | 'image' | 'other'; text: string } | null {
  const m =
    /^(?:no,?\s+)?(?:the\s+)?(pdf|file|document|image|photo|picture)(?:\s+one)?$/i.exec(text) ||
    /^(?:no,?\s+)?(?:use\s+)?(?:the\s+)?(pdf|file|document|image)(?:\s+please)?$/i.exec(text)
  if (!m?.[1]) return null
  const raw = m[1].toLowerCase()
  const label: 'pdf' | 'file' | 'image' | 'other' =
    raw === 'pdf' ? 'pdf' : raw === 'image' || raw === 'photo' || raw === 'picture' ? 'image' : raw === 'document' || raw === 'file' ? 'file' : 'other'
  return { label, text }
}

/**
 * “Actually, next week” / “change that to Friday” — revise timing in an instruction
 * instead of appending both commitments.
 */
export function reviseInstructionTiming(instruction: string, correction: string): string | null {
  const t = correction.trim().replace(/[.!?]+$/g, '')
  // Day / schedule tokens only — not morning/afternoon/evening (those are parts of day).
  // Non-global: avoid RegExp lastIndex bugs from .test() then .replace() on /g.
  const day =
    /\b(?:tomorrow|today|tonight|next\s+week|this\s+week|this\s+weekend|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i
  const partOfDay = /\b(?:morning|afternoon|evening)\b/i

  // “Not tomorrow, Friday” / “not tomorrow — next week” replaces only the negated token.
  const notTiming =
    /^not\s+(tomorrow|today|tonight|next\s+week|this\s+week|this\s+weekend|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\s*[,—–-]?\s*(.+)$/i.exec(
      t
    )
  if (notTiming?.[1] && notTiming?.[2]) {
    const negated = notTiming[1]
    const replacement = notTiming[2].trim().replace(/^(?:on\s+|this\s+)/i, '')
    if (!replacement) return null
    const negatedRe = new RegExp(`\\b${negated.replace(/\s+/g, '\\s+')}\\b`, 'i')
    if (negatedRe.test(instruction)) {
      return instruction.replace(negatedRe, replacement).replace(/\s+/g, ' ').trim()
    }
    if (day.test(instruction)) {
      return instruction.replace(day, replacement).replace(/\s+/g, ' ').trim()
    }
    return `${instruction.replace(/[.!?]+$/g, '').trim()} ${replacement}`.replace(/\s+/g, ' ').trim()
  }

  const m =
    /^(?:actually[, ]+|instead[, ]+|change\s+that\s+to\s+|make\s+it\s+|no[, ]+)(.+)$/i.exec(t) ||
    /^(?:next\s+week|tomorrow|today|tonight|this\s+weekend|monday|tuesday|wednesday|thursday|friday|saturday|sunday)$/i.exec(t)
  if (!m) return null
  const replacement = (m[1] || m[0]).trim()
  if (!replacement) return null
  // “Make it shorter / more formal” etc. are draft refines, not schedule changes.
  if (
    /^(?:shorter|longer|casual|formal|polite|friendlier|more\s+\w+|less\s+\w+)$/i.test(replacement) &&
    !day.test(replacement) &&
    !partOfDay.test(replacement)
  ) {
    return null
  }

  if (day.test(instruction)) {
    return instruction.replace(day, replacement).replace(/\s+/g, ' ').trim()
  }
  // Only swap part-of-day when the correction is also a part-of-day.
  if (partOfDay.test(instruction) && partOfDay.test(replacement)) {
    return instruction.replace(partOfDay, replacement).replace(/\s+/g, ' ').trim()
  }
  // No prior day timing — append once as the intended schedule.
  return `${instruction.replace(/[.!?]+$/g, '').trim()} ${replacement}`.replace(/\s+/g, ' ').trim()
}

/** Compact purpose line for history when older turns are trimmed. */
export function purposeSummary(purpose: TaskPurpose | null | undefined): string {
  if (!purpose) return ''
  const bits = [purpose.goal.slice(0, 80)]
  if (purpose.unresolvedQuery) bits.push(`waiting:${purpose.unresolvedQuery.slice(0, 40)}`)
  if (purpose.destination) bits.push(`dest:${purpose.destination.slice(0, 40)}`)
  if (purpose.heldDraft?.instruction) bits.push('held-draft')
  if (purpose.clarification) bits.push(`ask:${purpose.clarification.kind}`)
  if (purpose.suspended) bits.push('suspended')
  return bits.join(' · ').slice(0, 120)
}

/** Prefer keeping unresolved / needs_choice / suspended entries when trimming history. */
export function appendTaskHistoryPreferUnresolved<T extends { id: string; phase: string; at: number }>(
  history: T[],
  entry: T,
  max: number
): T[] {
  const next = [...history.filter((h) => h.id !== entry.id), entry]
  if (next.length <= max) return next
  const unresolved = new Set([
    'needs_choice',
    'understanding',
    'generating',
    'executing',
    'verifying',
    'reading_context',
    'suspended'
  ])
  const out: T[] = []
  const seen = new Set<string>()
  const take = (h: T): void => {
    if (seen.has(h.id) || out.length >= max) return
    seen.add(h.id)
    out.push(h)
  }
  // Newest entry always; then unresolved goals (so a stuck recipient wait isn’t dropped);
  // then newest remaining by time.
  take(entry)
  for (const h of next) {
    if (unresolved.has(h.phase) && h.id !== entry.id) take(h)
  }
  for (const h of [...next].sort((a, b) => b.at - a.at)) take(h)
  return out.sort((a, b) => a.at - b.at)
}

/** Safe contact query helper for purpose updates. */
export function purposeQuery(raw: string): string | null {
  return cleanContactQuery(raw)
}

/**
 * “No, this is for B” / “this is for Mum” — retarget the current draft recipient.
 * Returns null when the text is unrelated.
 */
export function parseRecipientRetarget(raw: string): string | null {
  const t = raw.trim().replace(/[.!?]+$/g, '')
  const m =
    /^(?:no,?\s+)?(?:this\s+is\s+)?(?:for|to)\s+(.+)$/i.exec(t) ||
    /^(?:no,?\s+)?(?:send|address)\s+(?:this|it|that)\s+to\s+(.+)$/i.exec(t) ||
    /^(?:no,?\s+)?(?:change\s+(?:the\s+)?(?:recipient|chat)\s+to)\s+(.+)$/i.exec(t)
  if (!m?.[1]) return null
  const rawName = m[1].trim()
  if (/^(?:him|her|them|you|it)$/i.test(rawName)) return null
  if (/^me$/i.test(rawName)) return 'Me'
  return cleanContactQuery(rawName)
}
