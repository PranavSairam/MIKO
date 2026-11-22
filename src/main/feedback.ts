/**
 * Feedback queue, submit, export. Never bundles owner credentials.
 * Endpoint URL and invite codes are not secrets that authorize admin access.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app, dialog } from 'electron'
import {
  buildDiagnostics,
  buildFeedbackPayload,
  emptyFeedbackDraft,
  formatFeedbackPreview,
  sanitizeIncomingPayload,
  type FeedbackDraft,
  type FeedbackLocalStatus,
  type FeedbackPayload,
  type FeedbackQueueItem,
  validateFeedbackDraft
} from '../shared/feedback'
import { buildId } from '../shared/build-info'

const MAX_QUEUE = 40
const MAX_ATTEMPTS = 8

function queuePath(): string {
  return join(app.getPath('userData'), 'feedback-queue.json')
}

function configPath(): string {
  return join(app.getPath('userData'), 'feedback-config.json')
}

export interface FeedbackConfig {
  /** HTTPS endpoint, e.g. https://feedback.example.com/v1/reports */
  endpoint: string
  /** Tester invite code (revocable server-side). Stored locally after entry. */
  inviteCode: string
}

function readQueue(): FeedbackQueueItem[] {
  try {
    const parsed: unknown = JSON.parse(readFileSync(queuePath(), 'utf8'))
    if (!Array.isArray(parsed)) return []
    return parsed
      .map((row) => {
        if (!row || typeof row !== 'object') return null
        const r = row as Record<string, unknown>
        const payload = sanitizeIncomingPayload(r.payload)
        if (!payload) return null
        const status = ['pending', 'sent', 'failed', 'exported'].includes(String(r.status))
          ? (r.status as FeedbackLocalStatus)
          : 'pending'
        return {
          payload,
          status,
          attempts: typeof r.attempts === 'number' ? r.attempts : 0,
          lastError: typeof r.lastError === 'string' ? r.lastError.slice(0, 200) : '',
          updatedAt: typeof r.updatedAt === 'number' ? r.updatedAt : Date.now(),
          remoteId: typeof r.remoteId === 'string' ? r.remoteId : null
        } satisfies FeedbackQueueItem
      })
      .filter((x): x is FeedbackQueueItem => Boolean(x))
      .slice(0, MAX_QUEUE)
  } catch {
    return []
  }
}

function writeQueue(items: FeedbackQueueItem[]): void {
  writeFileSync(queuePath(), JSON.stringify(items.slice(0, MAX_QUEUE), null, 2), { mode: 0o600 })
}

export function getFeedbackConfig(): FeedbackConfig {
  try {
    const parsed: unknown = JSON.parse(readFileSync(configPath(), 'utf8'))
    if (!parsed || typeof parsed !== 'object') return { endpoint: defaultEndpoint(), inviteCode: '' }
    const o = parsed as Record<string, unknown>
    return {
      endpoint: typeof o.endpoint === 'string' ? o.endpoint.trim().slice(0, 300) : defaultEndpoint(),
      inviteCode: typeof o.inviteCode === 'string' ? o.inviteCode.trim().slice(0, 64) : ''
    }
  } catch {
    return { endpoint: defaultEndpoint(), inviteCode: '' }
  }
}

export function setFeedbackConfig(partial: Partial<FeedbackConfig>): FeedbackConfig {
  const cur = getFeedbackConfig()
  const next: FeedbackConfig = {
    endpoint: partial.endpoint !== undefined ? partial.endpoint.trim().slice(0, 300) : cur.endpoint,
    inviteCode: partial.inviteCode !== undefined ? partial.inviteCode.trim().slice(0, 64) : cur.inviteCode
  }
  writeFileSync(configPath(), JSON.stringify(next, null, 2), { mode: 0o600 })
  return next
}

function defaultEndpoint(): string {
  // Baked at package time via env; empty means local-only / export until hosting is configured.
  return (process.env['MIKO_FEEDBACK_URL'] || '').trim().slice(0, 300)
}

export function listFeedbackQueue(): FeedbackQueueItem[] {
  return readQueue()
}

export function deleteFeedbackItem(id: string): FeedbackQueueItem[] {
  const next = readQueue().filter((item) => item.payload.id !== id)
  writeQueue(next)
  return next
}

export function previewFeedback(
  draft: FeedbackDraft,
  opts?: { actionType?: string | null; errorCode?: string | null }
): { ok: true; preview: string; payload: FeedbackPayload } | { ok: false; reason: string } {
  const check = validateFeedbackDraft(draft)
  if (!check.ok) return check
  const diagnostics = buildDiagnostics({
    platform: process.platform,
    arch: process.arch,
    buildId: buildId(process.env['MIKO_BUILD_ID']),
    actionType: opts?.actionType,
    errorCode: opts?.errorCode
  })
  const payload = buildFeedbackPayload(draft, diagnostics)
  return { ok: true, preview: formatFeedbackPreview(payload), payload }
}

export async function submitFeedback(
  draft: FeedbackDraft,
  opts?: { actionType?: string | null; errorCode?: string | null; clientKey?: string }
): Promise<{ ok: boolean; reason: string; item: FeedbackQueueItem | null; delivered: boolean }> {
  const check = validateFeedbackDraft(draft)
  if (!check.ok) return { ok: false, reason: check.reason, item: null, delivered: false }

  const config = getFeedbackConfig()
  const invite = draft.inviteCode.trim() || config.inviteCode
  if (invite && invite !== config.inviteCode) setFeedbackConfig({ inviteCode: invite })

  const diagnostics = buildDiagnostics({
    platform: process.platform,
    arch: process.arch,
    buildId: process.env['MIKO_BUILD_ID'],
    actionType: opts?.actionType,
    errorCode: opts?.errorCode
  })
  const payload = buildFeedbackPayload(
    { ...draft, inviteCode: invite },
    diagnostics,
    opts?.clientKey ? { clientKey: opts.clientKey } : undefined
  )

  const queue = readQueue()
  const existing = queue.find((q) => q.payload.clientKey === payload.clientKey)
  if (existing?.status === 'sent') {
    return { ok: true, reason: 'Already submitted.', item: existing, delivered: true }
  }

  const item: FeedbackQueueItem = existing
    ? { ...existing, payload: { ...payload, id: existing.payload.id, clientKey: existing.payload.clientKey }, status: 'pending', updatedAt: Date.now() }
    : {
        payload,
        status: 'pending',
        attempts: 0,
        lastError: '',
        updatedAt: Date.now(),
        remoteId: null
      }

  const nextQueue = existing
    ? queue.map((q) => (q.payload.clientKey === item.payload.clientKey ? item : q))
    : [item, ...queue].slice(0, MAX_QUEUE)
  writeQueue(nextQueue)

  if (!config.endpoint) {
    const failed = {
      ...item,
      status: 'failed' as const,
      lastError: 'No remote feedback inbox. Use Preview + Export report, then share the file with the owner.',
      updatedAt: Date.now()
    }
    writeQueue(nextQueue.map((q) => (q.payload.id === failed.payload.id ? failed : q)))
    return {
      ok: false,
      reason: failed.lastError,
      item: failed,
      delivered: false
    }
  }

  const result = await postReport(config.endpoint, invite, item.payload)
  const updated: FeedbackQueueItem = result.ok
    ? {
        ...item,
        status: 'sent',
        attempts: item.attempts + 1,
        lastError: '',
        updatedAt: Date.now(),
        remoteId: result.remoteId
      }
    : {
        ...item,
        status: 'failed',
        attempts: item.attempts + 1,
        lastError: result.reason,
        updatedAt: Date.now()
      }
  writeQueue(nextQueue.map((q) => (q.payload.id === item.payload.id ? updated : q)))
  return {
    ok: result.ok,
    // Only claim delivery when the remote inbox actually accepted the report.
    reason: result.ok ? 'Feedback sent to the owner’s private inbox.' : result.reason,
    item: updated,
    delivered: result.ok
  }
}

export async function retryFeedback(id: string): Promise<{ ok: boolean; reason: string; item: FeedbackQueueItem | null }> {
  const queue = readQueue()
  const item = queue.find((q) => q.payload.id === id)
  if (!item) return { ok: false, reason: 'Report not found.', item: null }
  if (item.status === 'sent') return { ok: true, reason: 'Already sent.', item }
  if (item.attempts >= MAX_ATTEMPTS) {
    return { ok: false, reason: 'Too many attempts. Export or delete this report.', item }
  }
  const draft = emptyFeedbackDraft({
    kind: item.payload.kind,
    happened: item.payload.happened,
    expected: item.payload.expected,
    contact: item.payload.contact,
    includeLastCommand: Boolean(item.payload.lastCommand),
    lastCommand: item.payload.lastCommand || '',
    screenshotDataUrl: item.payload.screenshotDataUrl || '',
    inviteCode: getFeedbackConfig().inviteCode
  })
  const result = await submitFeedback(draft, {
    actionType: item.payload.diagnostics.actionType,
    errorCode: item.payload.diagnostics.errorCode,
    clientKey: item.payload.clientKey
  })
  return { ok: result.ok, reason: result.reason, item: result.item }
}

async function writeExportFile(payload: FeedbackPayload): Promise<{ ok: boolean; reason: string; path: string }> {
  const { canceled, filePath } = await dialog.showSaveDialog({
    title: 'Export feedback report',
    defaultPath: `miko-feedback-${payload.id}.md`,
    filters: [
      { name: 'Markdown', extensions: ['md'] },
      { name: 'JSON', extensions: ['json'] }
    ]
  })
  if (canceled || !filePath) return { ok: false, reason: 'Export cancelled.', path: '' }
  const body = filePath.endsWith('.json')
    ? JSON.stringify(payload, null, 2)
    : (await import('../shared/feedback')).feedbackToMarkdown(payload)
  writeFileSync(filePath, body, { mode: 0o600 })
  return {
    ok: true,
    reason: 'Exported. Send this file to the MIKO owner yourself (Messages, email, AirDrop). Not delivered automatically.',
    path: filePath
  }
}

export async function exportFeedback(id: string): Promise<{ ok: boolean; reason: string; path: string }> {
  const item = readQueue().find((q) => q.payload.id === id)
  if (!item) return { ok: false, reason: 'Report not found.', path: '' }
  const result = await writeExportFile(item.payload)
  if (!result.ok) return result
  const queue = readQueue().map((q) =>
    q.payload.id === id ? { ...q, status: 'exported' as const, updatedAt: Date.now() } : q
  )
  writeQueue(queue)
  return result
}

/** Build + export a report from the current form without claiming remote delivery. */
export async function exportFeedbackDraft(
  draft: FeedbackDraft,
  opts?: { actionType?: string | null; errorCode?: string | null }
): Promise<{ ok: boolean; reason: string; path: string; item: FeedbackQueueItem | null }> {
  const check = validateFeedbackDraft(draft)
  if (!check.ok) return { ok: false, reason: check.reason, path: '', item: null }
  const diagnostics = buildDiagnostics({
    platform: process.platform,
    arch: process.arch,
    buildId: buildId(process.env['MIKO_BUILD_ID']),
    actionType: opts?.actionType,
    errorCode: opts?.errorCode
  })
  const payload = buildFeedbackPayload(draft, diagnostics)
  const result = await writeExportFile(payload)
  if (!result.ok) return { ...result, item: null }
  const item: FeedbackQueueItem = {
    payload,
    status: 'exported',
    attempts: 0,
    lastError: '',
    updatedAt: Date.now(),
    remoteId: null
  }
  const queue = readQueue().filter((q) => q.payload.clientKey !== payload.clientKey)
  writeQueue([item, ...queue].slice(0, MAX_QUEUE))
  return { ...result, item }
}

async function postReport(
  endpoint: string,
  inviteCode: string,
  payload: FeedbackPayload
): Promise<{ ok: true; remoteId: string } | { ok: false; reason: string }> {
  if (!/^https:\/\//i.test(endpoint) && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//i.test(endpoint)) {
    return { ok: false, reason: 'Feedback endpoint must be HTTPS (or local http://127.0.0.1 for testing).' }
  }
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 20_000)
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-miko-invite': inviteCode,
        'x-miko-client-key': payload.clientKey
      },
      body: JSON.stringify({
        ...payload,
        // Never send fields outside the schema
        screenshotDataUrl: payload.screenshotDataUrl
      }),
      signal: controller.signal
    })
    clearTimeout(timer)
    const text = await res.text()
    let json: Record<string, unknown> = {}
    try {
      json = text ? (JSON.parse(text) as Record<string, unknown>) : {}
    } catch {
      json = {}
    }
    if (res.status === 409 && typeof json.id === 'string') {
      return { ok: true, remoteId: json.id }
    }
    if (!res.ok) {
      const reason =
        typeof json.error === 'string'
          ? json.error.slice(0, 200)
          : `Server returned ${res.status}.`
      return { ok: false, reason }
    }
    return { ok: true, remoteId: typeof json.id === 'string' ? json.id : payload.id }
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Network error'
    return { ok: false, reason: msg.slice(0, 200) }
  }
}

/** Ensure feedback dir exists (queue file created lazily). */
export function ensureFeedbackStore(): void {
  mkdirSync(app.getPath('userData'), { recursive: true })
  if (!existsSync(queuePath())) writeQueue([])
}
