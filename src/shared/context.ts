/**
 * Explicit working context. Opening MIKO must not erase the external app the
 * owner was using. Revalidate before read/insert.
 *
 * Every typed/spoken turn should build a fresh ContextSnapshot from this
 * working state plus live UI flags — do not invent a second context system.
 */

import type { TaskPhase, ToneHint } from './actions.ts'
import type { TypeDestination } from './destination.ts'
import type { InteractiveGptDraftBinding } from './send-destination.ts'
import { gptDraftBindingFresh } from './send-destination.ts'
import type { FactSource } from './task-purpose.ts'
import { appendTaskHistoryPreferUnresolved } from './task-purpose.ts'
import type { RetrievedFileRef } from './whatsapp-attachments.ts'
import type { WhatsAppVisibleMessage } from './whatsapp-reply.ts'

export interface ExternalAppRef {
  name: string
  bundleId: string
  pid: number
  capturedAt: number
}

export interface BrowserTabRef {
  browser: 'chrome' | 'safari'
  window: number
  tab: number
  title: string
  url: string
  host: string
  capturedAt: number
}

export interface WhatsAppChatRef {
  header: string
  verifiedAt: number
  atLatest?: boolean
  source?: FactSource
}

export interface DraftRef {
  text: string
  chatName: string
  /** Exact text MIKO last inserted (for silent overwrite checks). */
  insertedText: string
  instruction: string
  tone: ToneHint
  updatedAt: number
  source?: FactSource
}

export interface ChoiceRef {
  purpose: string
  options: { id: string; name: string; detail?: string }[]
  /** Rest of the request held until a pick. */
  held?: { content?: string; tone?: ToneHint; kind?: string }
  createdAt: number
  /** Bumps when the option set is rebuilt — stale “second one” must refresh. */
  revision?: number
  source?: FactSource
}

export const CHOICE_TTL_MS = 30 * 60 * 1000

export function choiceExpired(choice: ChoiceRef | null | undefined, now = Date.now()): boolean {
  if (!choice) return true
  return now - choice.createdAt > CHOICE_TTL_MS
}

export interface SummarySourceRef {
  chatName: string
  messageIds: string[]
  capturedAt: number
  scope: 'incoming' | 'conversation' | 'visible'
}

export interface WorkingContext {
  /** Last non-MIKO app before the panel took focus. */
  lastExternalApp: ExternalAppRef | null
  /**
   * Captured editable field for “type here” — taken before MIKO steals focus.
   * Never the MIKO panel itself.
   */
  typeDestination: TypeDestination | null
  /** Held type draft while waiting on Paste now / choose destination. */
  typeDraft: { text: string; literal: boolean; updatedAt: number } | null
  whatsapp: WhatsAppChatRef | null
  /** Last website MIKO opened (for “close it” / “in Chrome”). */
  lastWebsite: { url: string; name: string; browser: string | null; openedAt: number } | null
  activeTab: BrowserTabRef | null
  selection: { text: string; app: string; captureId: string; capturedAt: number } | null
  draft: DraftRef | null
  choice: ChoiceRef | null
  summarySource: SummarySourceRef | null
  /** Last retrieved WhatsApp attachment (local file). */
  retrievedFile: RetrievedFileRef | null
  /** Pending attach destination while waiting on a choice. */
  pendingAttach: { path: string; filename: string; expectHeader?: string; taskId: string } | null
  /**
   * Last explicit MIKO insert into Interactive GPT (dictate / type-in-gpt / paste / transfer).
   * Visibility of the workspace alone never sets this.
   */
  interactiveGptDraft: InteractiveGptDraftBinding | null
  /** Active task id, if any. */
  taskId: string | null
  updatedAt: number
}

/** Compact completed/cancelled task for bounded history (reference resolution). */
export interface TaskHistoryEntry {
  id: string
  kinds: string[]
  original: string
  phase: TaskPhase
  summary: string
  at: number
  artifacts?: {
    waChat?: string
    filePath?: string
    fileName?: string
    draftChat?: string
    purpose?: string
    unresolvedQuery?: string
    heldDraft?: boolean
  }
}

export const MAX_TASK_HISTORY = 8

/**
 * Fresh per-turn snapshot. Built immediately before routing / interpret so
 * pronouns and “that file” / “shorter” bind to verified objects only.
 */
export interface ContextSnapshot {
  takenAt: number
  platform: 'darwin' | 'win32'
  messaging: 'whatsapp' | null
  waChat: string | null
  waDraftActive: boolean
  draft: DraftRef | null
  retrievedFile: {
    filename: string
    path: string
    chatName: string
    retrievedAt: number
  } | null
  lastWebsite: { url: string; name: string; browser: string | null } | null
  selectionFresh: boolean
  selectionApp: string | null
  summarySource: SummarySourceRef | null
  pendingUrl: { url: string; name: string } | null
  recentTasks: TaskHistoryEntry[]
  activeTaskId: string | null
  mailTab: boolean
  assistantActive: boolean
  /** Fresh pending Interactive GPT draft binding (explicit insert only). */
  interactiveGptDraft: InteractiveGptDraftBinding | null
}

export type ResolvedReference =
  | { kind: 'pronoun'; pronoun: 'him' | 'her' | 'them'; chatName: string }
  | { kind: 'file'; filename: string; path: string; chatName: string }
  | { kind: 'draft_refine'; change: string; chatName: string }
  | { kind: 'website'; name: string; url: string }
  | { kind: 'ambiguous'; question: string }
  | { kind: 'unresolved'; reason: string }

export function emptyContext(): WorkingContext {
  return {
    lastExternalApp: null,
    typeDestination: null,
    typeDraft: null,
    whatsapp: null,
    lastWebsite: null,
    activeTab: null,
    selection: null,
    draft: null,
    choice: null,
    summarySource: null,
    retrievedFile: null,
    pendingAttach: null,
    interactiveGptDraft: null,
    taskId: null,
    updatedAt: Date.now()
  }
}

const STALE_MS = 30 * 60 * 1000
const FILE_FRESH_MS = 60 * 60 * 1000
const SELECTION_FRESH_MS = 10 * 60 * 1000

export function isFresh(at: number, now = Date.now(), maxAge = STALE_MS): boolean {
  return now - at >= 0 && now - at <= maxAge
}

/** Hostname without leading www. for domain-boundary matching. */
export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./i, '').toLowerCase()
  } catch {
    return ''
  }
}

/** True when tab host equals or is a subdomain of the site host (not the reverse). */
export function hostMatchesSite(tabHost: string, siteHost: string): boolean {
  const t = tabHost.replace(/^www\./i, '').toLowerCase()
  const s = siteHost.replace(/^www\./i, '').toLowerCase()
  if (!t || !s) return false
  return t === s || t.endsWith('.' + s)
}

export function messagesFingerprint(messages: WhatsAppVisibleMessage[]): string[] {
  return messages.map((m, i) => `${i}:${m.mine ? 'out' : 'in'}:${m.text.slice(0, 40)}`)
}

export function appendTaskHistory(
  history: TaskHistoryEntry[],
  entry: TaskHistoryEntry,
  max = MAX_TASK_HISTORY
): TaskHistoryEntry[] {
  return appendTaskHistoryPreferUnresolved(history, entry, Math.max(1, max))
}

export function buildContextSnapshot(input: {
  working: WorkingContext
  platform: 'darwin' | 'win32'
  messaging: 'whatsapp' | null
  waChat: string | null
  waDraftActive: boolean
  /** Live panel draft when WorkingContext.draft is stale. */
  liveDraft?: DraftRef | null
  pendingUrl?: { url: string; name: string } | null
  recentTasks?: TaskHistoryEntry[]
  activeTaskId?: string | null
  mailTab?: boolean
  assistantActive?: boolean
  now?: number
}): ContextSnapshot {
  const now = input.now ?? Date.now()
  const file = input.working.retrievedFile
  const fileFresh =
    file && file.path && isFresh(file.retrievedAt, now, FILE_FRESH_MS)
      ? {
          filename: file.filename,
          path: file.path,
          chatName: file.chatName || input.waChat || '',
          retrievedAt: file.retrievedAt
        }
      : null
  const sel = input.working.selection
  const selectionFresh = Boolean(sel && isFresh(sel.capturedAt, now, SELECTION_FRESH_MS))
  const draft = input.liveDraft ?? input.working.draft
  const draftLive =
    draft && (input.waDraftActive || isFresh(draft.updatedAt, now, STALE_MS)) ? draft : input.waDraftActive ? draft : null
  const website = input.working.lastWebsite
  return {
    takenAt: now,
    platform: input.platform,
    messaging: input.messaging,
    waChat: input.waChat || input.working.whatsapp?.header || null,
    waDraftActive: input.waDraftActive,
    draft: draftLive,
    retrievedFile: fileFresh,
    lastWebsite: website
      ? { url: website.url, name: website.name, browser: website.browser }
      : null,
    selectionFresh,
    selectionApp: selectionFresh && sel ? sel.app : null,
    summarySource:
      input.working.summarySource && isFresh(input.working.summarySource.capturedAt, now, STALE_MS)
        ? input.working.summarySource
        : null,
    pendingUrl: input.pendingUrl ?? null,
    recentTasks: (input.recentTasks ?? []).slice(-MAX_TASK_HISTORY),
    activeTaskId: input.activeTaskId ?? input.working.taskId,
    mailTab: Boolean(input.mailTab),
    assistantActive: Boolean(input.assistantActive),
    interactiveGptDraft: gptDraftBindingFresh(input.working.interactiveGptDraft, now)
      ? input.working.interactiveGptDraft
      : null
  }
}

/**
 * Resolve pronouns / “that file” / “shorter” / “close it” against verified snapshot objects.
 * Returns ambiguities instead of guessing when several cats… (or files) could match.
 */
/** Drafts that “make it shorter” could mean — more than one → ask, don’t guess. */
export function draftRefineCandidates(snap: ContextSnapshot): { chatName: string }[] {
  const out: { chatName: string }[] = []
  const seen = new Set<string>()
  if (snap.draft?.chatName) {
    seen.add(snap.draft.chatName.toLowerCase())
    out.push({ chatName: snap.draft.chatName })
  }
  for (const h of [...snap.recentTasks].reverse()) {
    const chat = h.artifacts?.draftChat
    if (chat && !seen.has(chat.toLowerCase())) {
      seen.add(chat.toLowerCase())
      out.push({ chatName: chat })
    }
  }
  return out
}

export function resolveRequestReferences(text: string, snap: ContextSnapshot): ResolvedReference[] {
  const t = text.trim()
  if (!t) return []
  const out: ResolvedReference[] = []

  const bareCopyIt = /^copy\s+(?:it|that|this)\.?$/i.test(t)
  const wantsFile =
    /\b(?:that|this|the)\s+(?:file|pdf|document|attachment)\b/i.test(t) ||
    /\b(?:copy|attach|save|open|show)\s+(?:it|that|this)\b/i.test(t) ||
    /\battach\s+it\b/i.test(t) ||
    /\bcopy\s+(?:this|that)\s+file\b/i.test(t)
  if (wantsFile) {
    const otherPlausible =
      bareCopyIt &&
      (Boolean(snap.draft?.text) ||
        snap.recentTasks.some(
          (h) =>
            h.kinds.includes('ask_assistant') ||
            /assistant|bridge|answer|96|math/i.test(h.summary) ||
            /what is|times|×/i.test(h.original)
        ))
    if (bareCopyIt && snap.retrievedFile && otherPlausible) {
      out.push({
        kind: 'ambiguous',
        question: `Copy the file “${snap.retrievedFile.filename}”, or something else from the last answer?`
      })
    } else if (snap.retrievedFile) {
      out.push({
        kind: 'file',
        filename: snap.retrievedFile.filename,
        path: snap.retrievedFile.path,
        chatName: snap.retrievedFile.chatName
      })
    } else {
      out.push({
        kind: 'unresolved',
        reason: 'No verified file in context. Fetch or download an attachment first.'
      })
    }
  }

  const refine =
    /^(?:make\s+(?:that|it|the\s+(?:draft|message|reply))\s+)?(shorter|longer|briefer|tighter|more\s+\w+|less\s+\w+|friendlier|politer|simpler|formal|casual|friendly|polite|professional)$/i.exec(
      t
    ) ||
    /^(?:trim|tighten|shorten)\s+(?:that|it|the\s+(?:draft|message|reply))(?:\s+(?:down|a\s+bit|a\s+little))?$/i.test(t)
  if (refine || /\b(?:shorter|briefer|more\s+formal|more\s+polite)\b/i.test(t)) {
    const draftCandidates = draftRefineCandidates(snap)
    if (draftCandidates.length > 1) {
      out.push({
        kind: 'ambiguous',
        question: 'Which draft should I change — the one for “' + draftCandidates.map((c) => c.chatName).join('” or “') + '”?'
      })
    } else if (draftCandidates.length === 1 || (snap.waDraftActive && snap.draft?.chatName)) {
      const chatName = draftCandidates[0]?.chatName || snap.draft!.chatName
      const change =
        typeof refine === 'object' && refine?.[1]
          ? /^(shorter|longer|briefer|tighter)$/i.test(refine[1])
            ? refine[1].toLowerCase() === 'briefer' || refine[1].toLowerCase() === 'tighter'
              ? 'shorter'
              : refine[1].toLowerCase()
            : refine[1].toLowerCase().startsWith('more ')
              ? refine[1].toLowerCase()
              : `more ${refine[1].toLowerCase()}`
          : /\bshorter|briefer|tighter\b/i.test(t)
            ? 'shorter'
            : /\bmore\s+formal\b/i.test(t)
              ? 'more formal'
              : /\bmore\s+polite\b/i.test(t)
                ? 'more polite'
                : 'shorter'
      out.push({ kind: 'draft_refine', change, chatName })
    } else if (/\b(?:draft|shorter|briefer|formal|polite)\b/i.test(t) && !snap.waDraftActive) {
      out.push({ kind: 'unresolved', reason: 'There’s no WhatsApp draft to refine yet.' })
    }
  }

  const pronoun = /\b(?:tell|ask|message|reply\s+to|let)\s+(him|her|them)\b/i.exec(t)?.[1]?.toLowerCase() as
    | 'him'
    | 'her'
    | 'them'
    | undefined
  if (pronoun) {
    if (snap.waChat) {
      out.push({ kind: 'pronoun', pronoun, chatName: snap.waChat })
    } else {
      out.push({
        kind: 'ambiguous',
        question: `Which WhatsApp chat should “${pronoun}” refer to? Open the chat, or name the contact.`
      })
    }
  }

  if (/\b(?:close\s+it|close\s+that|in\s+(?:chrome|safari))\b/i.test(t) && snap.lastWebsite) {
    out.push({ kind: 'website', name: snap.lastWebsite.name, url: snap.lastWebsite.url })
  }

  return out
}

/** One-line verified objects for interpret / logs (no private message bodies). */
export function formatSnapshotForPrompt(snap: ContextSnapshot): string {
  const lines: string[] = ['Verified context (bind pronouns and “that/it” only to these objects):']
  if (snap.waChat) lines.push(`- WhatsApp chat: ${snap.waChat}`)
  if (snap.draft?.chatName) {
    lines.push(
      `- Active WhatsApp draft in “${snap.draft.chatName}” (${snap.draft.text ? 'has text' : 'empty body'}; unsent until the owner sends).`
    )
  }
  if (snap.interactiveGptDraft) {
    lines.push(
      `- Interactive GPT draft pending (explicit ${snap.interactiveGptDraft.source}; workspace ${snap.interactiveGptDraft.partition}; unsent until “Send it”).`
    )
  }
  if (snap.retrievedFile) {
    lines.push(`- Retrieved file: “${snap.retrievedFile.filename}” from “${snap.retrievedFile.chatName}”.`)
  }
  if (snap.lastWebsite) lines.push(`- Last website: ${snap.lastWebsite.name} (${snap.lastWebsite.url})`)
  if (snap.selectionFresh) lines.push(`- Fresh text selection from ${snap.selectionApp || 'an app'}.`)
  if (snap.summarySource) {
    lines.push(`- Last summary source: “${snap.summarySource.chatName}” (${snap.summarySource.scope}).`)
  }
  if (snap.pendingUrl) lines.push(`- Pending site open: ${snap.pendingUrl.name}`)
  if (snap.recentTasks.length) {
    lines.push('- Recent tasks (newest last):')
    for (const h of snap.recentTasks.slice(-4)) {
      lines.push(`  • ${h.kinds.join('+') || 'task'} → ${h.phase}: ${h.summary.slice(0, 80)}`)
    }
  }
  const unresolved = snap.recentTasks.filter((h) => h.phase === 'needs_choice' || h.phase === 'suspended')
  if (unresolved.length) {
    lines.push('- Unresolved / suspended goals (do not invent destinations):')
    for (const h of unresolved.slice(-3)) {
      lines.push(`  • ${h.summary.slice(0, 100)}`)
    }
  }
  if (lines.length === 1) lines.push('- (none — ask a short clarify question if a referent is needed)')
  return lines.join('\n')
}
