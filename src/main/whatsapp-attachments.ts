/**
 * WhatsApp attachment list / save / clipboard / paste via miko-ax.
 * Never reads WhatsApp databases or credentials.
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import { shell } from 'electron'
import { axHelperPath } from './ax'
import { cancelWhatsApp } from './whatsapp'
import {
  filterAttachments,
  parseDocumentBubble,
  pickLatest,
  type AttachmentDirection,
  type ParsedAttachmentBubble,
  type WhatsAppAttachmentIntent
} from '../shared/whatsapp-attachments'

export type AttachmentListResult =
  | {
      status: 'listed'
      header: string
      attachments: ParsedAttachmentBubble[]
      atLatest: boolean
      visibleOnly: true
      reason: string
      composerText: string
    }
  | { status: 'failed' | 'permission' | 'lost-focus' | 'cancelled' | 'unsupported'; header: string; reason: string; attachments: [] }

export type AttachmentSaveResult = {
  status:
    | 'saved'
    | 'candidate'
    | 'failed'
    | 'switched'
    | 'missing'
    | 'cancelled'
    | 'permission'
    | 'lost-focus'
    | 'unsupported'
  header: string
  reason: string
  path: string
  filename: string
  bytes: number
  /** True only when this path was produced by a new WhatsApp Save-to-Downloads write (or an explicit user accept). */
  verified: boolean
  provenance: 'ax-new-file' | 'user-accepted-candidate' | 'unverified-candidate' | 'none'
}

/** Session-proven downloads: attachmentId → local path from a verified AX save or user accept. */
const provenByAttachment = new Map<string, { path: string; bytes: number; at: number }>()
const provenPaths = new Set<string>()

export function markAttachmentProven(attachmentId: string, path: string, bytes: number): void {
  if (!attachmentId || !path) return
  provenByAttachment.set(attachmentId, { path, bytes, at: Date.now() })
  provenPaths.add(path)
}

export function isProvenAttachmentPath(path: string, attachmentId?: string): boolean {
  if (path && provenPaths.has(path)) return true
  if (attachmentId) {
    const row = provenByAttachment.get(attachmentId)
    if (row && row.path === path) return true
  }
  return false
}

export function listDownloadCandidates(filename: string): { path: string; bytes: number; filename: string }[] {
  const safe = filename.replace(/[/\\:\0]/g, '_').trim()
  if (!safe) return []
  const dir = downloadsFolder()
  const stem = safe.includes('.') ? safe.slice(0, safe.lastIndexOf('.')) : safe
  const ext = safe.includes('.') ? safe.slice(safe.lastIndexOf('.') + 1) : ''
  const out: { path: string; bytes: number; filename: string }[] = []
  try {
    for (const name of readdirSync(dir)) {
      const nStem = name.includes('.') ? name.slice(0, name.lastIndexOf('.')) : name
      const nExt = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1) : ''
      if (ext && nExt.toLowerCase() !== ext.toLowerCase()) continue
      if (name !== safe && nStem !== stem && !nStem.startsWith(stem + ' (')) continue
      const full = join(dir, name)
      try {
        const st = statSync(full)
        if (st.isFile() && st.size > 0) out.push({ path: full, bytes: st.size, filename: name })
      } catch {
        /* skip */
      }
    }
  } catch {
    return []
  }
  return out.sort((a, b) => a.filename.localeCompare(b.filename))
}

export type ClipboardFileResult = {
  status: 'copied' | 'failed'
  reason: string
  path: string
  filename: string
  bytes: number
  verified: boolean
}

export type PasteFileResult = {
  status: 'attached' | 'failed' | 'switched' | 'cancelled' | 'permission' | 'lost-focus'
  header: string
  reason: string
  path: string
  filename: string
  verified: boolean
  composerText: string
}

let child: ChildProcess | null = null
let generation = 0

export function cancelAttachmentWork(): void {
  generation += 1
  child?.kill('SIGTERM')
  child = null
  cancelWhatsApp()
}

function runHelper(args: string[], input = '', timeoutMs = 25000): Promise<Record<string, unknown>> {
  const path = axHelperPath()
  if (!path) return Promise.resolve({ ok: false, status: 'failed', reason: 'MIKO’s Accessibility helper isn’t available.' })
  const gen = ++generation
  child?.kill('SIGTERM')
  return new Promise((resolve) => {
    const proc = spawn(path, args, { shell: false, stdio: ['pipe', 'pipe', 'ignore'] })
    child = proc
    let out = ''
    const timer = setTimeout(() => {
      proc.kill('SIGTERM')
      resolve({ ok: false, status: 'failed', reason: 'The Accessibility helper timed out.' })
    }, timeoutMs)
    proc.stdout?.on('data', (c: Buffer) => {
      out += c.toString('utf8')
    })
    proc.once('close', () => {
      clearTimeout(timer)
      if (gen !== generation) {
        resolve({ ok: false, status: 'cancelled', reason: 'Cancelled.' })
        return
      }
      try {
        resolve(JSON.parse(out.trim().split('\n').pop() || '{}') as Record<string, unknown>)
      } catch {
        resolve({ ok: false, status: 'failed', reason: 'Bad helper response.' })
      }
    })
    proc.stdin?.end(input)
  })
}

function parseListed(payload: Record<string, unknown>): AttachmentListResult {
  const header = typeof payload.header === 'string' ? payload.header.slice(0, 80) : ''
  const status = typeof payload.status === 'string' ? payload.status : 'failed'
  if (status !== 'listed') {
    const failStatus =
      status === 'permission' || status === 'lost-focus' || status === 'cancelled' || status === 'unsupported'
        ? status
        : 'failed'
    return {
      status: failStatus,
      header,
      reason: typeof payload.reason === 'string' ? payload.reason.slice(0, 400) : 'I couldn’t list attachments.',
      attachments: []
    }
  }
  const raw = Array.isArray(payload.attachments) ? payload.attachments : []
  const attachments: ParsedAttachmentBubble[] = []
  for (const row of raw.slice(0, 24)) {
    if (!row || typeof row !== 'object') continue
    const r = row as Record<string, unknown>
    const fromHelper =
      typeof r.raw === 'string'
        ? parseDocumentBubble(r.raw)
        : typeof r.filename === 'string'
          ? {
              id: typeof r.id === 'string' ? r.id : `att-${attachments.length}`,
              filename: r.filename.slice(0, 180),
              kind: typeof r.kind === 'string' ? r.kind.slice(0, 20) : 'file',
              detail: typeof r.detail === 'string' && r.detail ? r.detail.slice(0, 80) : null,
              time: typeof r.time === 'string' && r.time ? r.time.slice(0, 40) : null,
              mine: r.mine === true,
              raw: typeof r.raw === 'string' ? r.raw.slice(0, 600) : String(r.filename)
            }
          : null
    if (fromHelper) attachments.push(fromHelper)
  }
  return {
    status: 'listed',
    header,
    attachments,
    atLatest: payload.atLatest !== false,
    visibleOnly: true,
    reason: attachments.length
      ? `Latest visible attachment${attachments.length === 1 ? '' : 's'} in “${header}” (visible messages only — not full chat history).`
      : `No downloadable documents in the visible messages of “${header}”.`,
    composerText: typeof payload.composerText === 'string' ? payload.composerText.slice(0, 4000) : ''
  }
}

export async function listWhatsAppAttachments(): Promise<AttachmentListResult> {
  if (process.platform !== 'darwin') {
    return {
      status: 'unsupported',
      header: '',
      reason: 'WhatsApp attachment retrieval isn’t available on Windows yet.',
      attachments: []
    }
  }
  const payload = await runHelper(['whatsapp-attachments'], '', 12000)
  return parseListed(payload)
}

export async function saveWhatsAppAttachment(opts: {
  expectHeader: string
  filename: string
  id?: string
  /**
   * Accept a previously surfaced unverified Downloads candidate after the owner chooses it.
   * Filename/size alone never auto-prove provenance.
   */
  acceptCandidatePath?: string
}): Promise<AttachmentSaveResult> {
  if (process.platform !== 'darwin') {
    return {
      status: 'failed',
      header: '',
      reason: 'WhatsApp attachment save isn’t available on Windows yet.',
      path: '',
      filename: '',
      bytes: 0,
      verified: false,
      provenance: 'none'
    }
  }
  if (opts.acceptCandidatePath) {
    const path = opts.acceptCandidatePath.slice(0, 1024)
    const allowed = listDownloadCandidates(opts.filename).some((c) => c.path === path)
    if (!allowed || !existsSync(path)) {
      return {
        status: 'failed',
        header: opts.expectHeader.slice(0, 80),
        reason: 'That Downloads candidate isn’t available anymore.',
        path: '',
        filename: '',
        bytes: 0,
        verified: false,
        provenance: 'none'
      }
    }
    try {
      const st = statSync(path)
      if (!st.isFile() || st.size <= 0) {
        return {
          status: 'failed',
          header: opts.expectHeader.slice(0, 80),
          reason: 'That Downloads candidate isn’t a readable file.',
          path: '',
          filename: '',
          bytes: 0,
          verified: false,
          provenance: 'none'
        }
      }
      if (opts.id) markAttachmentProven(opts.id, path, st.size)
      else provenPaths.add(path)
      return {
        status: 'saved',
        header: opts.expectHeader.slice(0, 80),
        reason: `Using Downloads candidate “${basename(path)}” — you accepted it; provenance was not proven by a fresh WhatsApp save.`,
        path,
        filename: basename(path),
        bytes: st.size,
        verified: true,
        provenance: 'user-accepted-candidate'
      }
    } catch {
      return {
        status: 'failed',
        header: opts.expectHeader.slice(0, 80),
        reason: 'That Downloads candidate isn’t readable.',
        path: '',
        filename: '',
        bytes: 0,
        verified: false,
        provenance: 'none'
      }
    }
  }

  // If we already proved this attachment id this session, reuse that path only.
  if (opts.id) {
    const proven = provenByAttachment.get(opts.id)
    if (proven && existsSync(proven.path)) {
      try {
        const st = statSync(proven.path)
        if (st.isFile() && st.size > 0) {
          return {
            status: 'saved',
            header: opts.expectHeader.slice(0, 80),
            reason: `Reusing session-proven file “${basename(proven.path)}” from this chat’s download.`,
            path: proven.path,
            filename: basename(proven.path),
            bytes: st.size,
            verified: true,
            provenance: 'ax-new-file'
          }
        }
      } catch {
        /* fall through */
      }
    }
  }

  const payload = await runHelper(
    ['whatsapp-attachment-save'],
    JSON.stringify({
      expectHeader: opts.expectHeader.slice(0, 80),
      filename: opts.filename.slice(0, 180),
      id: opts.id?.slice(0, 64) || ''
    }),
    30000
  )
  const status = typeof payload.status === 'string' ? payload.status : 'failed'
  const path = typeof payload.path === 'string' ? payload.path.slice(0, 1024) : ''
  let bytes = typeof payload.bytes === 'number' ? payload.bytes : 0
  let onDisk = false
  if (path && existsSync(path)) {
    try {
      const st = statSync(path)
      if (st.isFile() && st.size > 0) {
        bytes = st.size
        onDisk = true
      }
    } catch {
      onDisk = false
    }
  }

  if (status === 'candidate' && onDisk) {
    return {
      status: 'candidate',
      header: typeof payload.header === 'string' ? payload.header.slice(0, 80) : '',
      reason:
        typeof payload.reason === 'string'
          ? payload.reason.slice(0, 400)
          : 'A same-named Downloads file exists, but provenance isn’t proven.',
      path,
      filename: typeof payload.filename === 'string' ? payload.filename.slice(0, 180) : basename(path),
      bytes,
      verified: false,
      provenance: 'unverified-candidate'
    }
  }

  const verified = status === 'saved' && onDisk && payload.verified === true
  if (verified && opts.id) markAttachmentProven(opts.id, path, bytes)
  else if (verified) provenPaths.add(path)

  return {
    status: (['saved', 'candidate', 'switched', 'missing', 'cancelled', 'permission', 'lost-focus', 'unsupported'].includes(
      status
    )
      ? status
      : 'failed') as AttachmentSaveResult['status'],
    header: typeof payload.header === 'string' ? payload.header.slice(0, 80) : '',
    reason: typeof payload.reason === 'string' ? payload.reason.slice(0, 400) : '',
    path: verified || status === 'candidate' ? path : '',
    filename: typeof payload.filename === 'string' ? payload.filename.slice(0, 180) : basename(path || opts.filename),
    bytes,
    verified,
    provenance: verified ? 'ax-new-file' : status === 'candidate' ? 'unverified-candidate' : 'none'
  }
}

export async function copyFileToClipboard(path: string): Promise<ClipboardFileResult> {
  if (process.platform !== 'darwin') {
    return { status: 'failed', reason: 'File clipboard isn’t available on Windows yet.', path: '', filename: '', bytes: 0, verified: false }
  }
  if (!path || path.includes('\0') || path.includes('..')) {
    return { status: 'failed', reason: 'That file path isn’t one I can copy.', path: '', filename: '', bytes: 0, verified: false }
  }
  const payload = await runHelper(['clipboard-file'], path.slice(0, 1024), 8000)
  const ok = payload.status === 'copied' && payload.ok !== false
  return {
    status: ok ? 'copied' : 'failed',
    reason: typeof payload.reason === 'string' ? payload.reason.slice(0, 400) : ok ? 'Copied.' : 'Clipboard failed.',
    path: ok ? path : '',
    filename: typeof payload.filename === 'string' ? payload.filename : basename(path),
    bytes: typeof payload.bytes === 'number' ? payload.bytes : 0,
    verified: payload.verified === true
  }
}

export async function pasteFileIntoWhatsApp(opts: {
  expectHeader: string
  path: string
}): Promise<PasteFileResult> {
  if (process.platform !== 'darwin') {
    return {
      status: 'failed',
      header: '',
      reason: 'WhatsApp file attach isn’t available on Windows yet.',
      path: '',
      filename: '',
      verified: false,
      composerText: ''
    }
  }
  const payload = await runHelper(
    ['paste-file'],
    JSON.stringify({ expectHeader: opts.expectHeader.slice(0, 80), path: opts.path.slice(0, 1024) }),
    20000
  )
  const status = typeof payload.status === 'string' ? payload.status : 'failed'
  return {
    status: (['attached', 'switched', 'cancelled', 'permission', 'lost-focus'].includes(status)
      ? status
      : 'failed') as PasteFileResult['status'],
    header: typeof payload.header === 'string' ? payload.header.slice(0, 80) : '',
    reason: typeof payload.reason === 'string' ? payload.reason.slice(0, 400) : '',
    path: opts.path,
    filename: typeof payload.filename === 'string' ? payload.filename.slice(0, 180) : basename(opts.path),
    verified: payload.verified === true && status === 'attached',
    composerText: typeof payload.composerText === 'string' ? payload.composerText.slice(0, 4000) : ''
  }
}

export function revealInFinder(path: string): boolean {
  if (!path || !existsSync(path)) return false
  shell.showItemInFolder(path)
  return true
}

export function openLocalFile(path: string): Promise<string> {
  if (!path || !existsSync(path)) return Promise.resolve('That file isn’t on disk.')
  return shell.openPath(path)
}

export function selectAttachmentsForIntent(
  listed: Extract<AttachmentListResult, { status: 'listed' }>,
  intent: WhatsAppAttachmentIntent
): { matches: ParsedAttachmentBubble[]; pick: ParsedAttachmentBubble | null; label: string } {
  const matches = filterAttachments(listed.attachments, intent)
  const dir =
    intent.direction === 'incoming' ? 'incoming' : intent.direction === 'outgoing' ? 'outgoing' : 'matching'
  const label = `Latest visible ${dir} attachment (visible messages only)`
  if (matches.length === 0) return { matches, pick: null, label }
  if (matches.length === 1) return { matches, pick: matches[0]!, label }
  if (intent.latest) return { matches, pick: pickLatest(matches), label }
  return { matches, pick: null, label }
}

export function downloadsFolder(): string {
  return join(homedir(), 'Downloads')
}

export type { AttachmentDirection }
