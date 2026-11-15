/**
 * Explicit working context. Opening MIKO must not erase the external app the
 * owner was using. Revalidate before read/insert.
 */

import type { ToneHint } from './actions.ts'
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
}

export interface DraftRef {
  text: string
  chatName: string
  /** Exact text MIKO last inserted (for silent overwrite checks). */
  insertedText: string
  instruction: string
  tone: ToneHint
  updatedAt: number
}

export interface ChoiceRef {
  purpose: string
  options: { id: string; name: string; detail?: string }[]
  /** Rest of the request held until a pick. */
  held?: { content?: string; tone?: ToneHint; kind?: string }
  createdAt: number
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
  /** Active task id, if any. */
  taskId: string | null
  updatedAt: number
}

export function emptyContext(): WorkingContext {
  return {
    lastExternalApp: null,
    whatsapp: null,
    lastWebsite: null,
    activeTab: null,
    selection: null,
    draft: null,
    choice: null,
    summarySource: null,
    retrievedFile: null,
    pendingAttach: null,
    taskId: null,
    updatedAt: Date.now()
  }
}

const STALE_MS = 30 * 60 * 1000

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
