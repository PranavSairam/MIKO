/**
 * WhatsApp attachment intents and document-bubble parsing (pure).
 * Visible-only listing is labelled as such — never claim full history search.
 */

export type AttachmentOp =
  | 'fetch'
  | 'save-downloads'
  | 'show-finder'
  | 'open'
  | 'copy-file'
  | 'copy-filename'
  | 'copy-path'
  | 'attach-here'
  | 'attach-elsewhere'

export type AttachmentDirection = 'incoming' | 'outgoing' | 'any'

export interface WhatsAppAttachmentIntent {
  op: AttachmentOp
  /** Prefer PDF / document / any file. */
  kind: 'pdf' | 'document' | 'file' | 'any'
  direction: AttachmentDirection
  /** Prefer the latest matching attachment. */
  latest: boolean
  /** Explicit filename fragment when spoken (“Freshnet…”). */
  nameHint?: string
}

export interface ParsedAttachmentBubble {
  /** Stable id from the raw AX description (not a filesystem path). */
  id: string
  filename: string
  kind: string
  detail: string | null
  time: string | null
  mine: boolean
  raw: string
}

export interface RetrievedFileRef {
  path: string
  filename: string
  bytes: number
  chatName: string
  attachmentId: string
  retrievedAt: number
  /** Visible-only vs claimed full history. */
  scopeLabel: 'latest-visible' | 'selected'
}

const DOC_EXT = /\.(pdf|docx?|xlsx?|pptx?|txt|csv|zip|rar|7z|pages|numbers|key)$/i

/** Parse a WhatsApp document bubble AX description. */
export function parseDocumentBubble(raw: string): ParsedAttachmentBubble | null {
  const clean = raw
    .replace(/\u200e/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!clean) return null
  // Skip ordinary text / media that aren’t downloadable documents.
  if (/^(?:your\s+)?(?:photo|video|gif|sticker|contact|audio|voice message|poll|event|location)\b/i.test(clean)) {
    return null
  }
  if (!/^(?:your\s+)?document\b/i.test(clean) && !DOC_EXT.test(clean)) return null

  const mine = /^your\s+document\b/i.test(clean) || /,\s*sent to\s+/i.test(clean)
  // Document, Name.pdf, 25 pages, 12:52 AM, Received from …
  const parts = clean.split(',').map((p) => p.trim()).filter(Boolean)
  let filename = ''
  let detail: string | null = null
  let time: string | null = null
  for (const part of parts) {
    if (/^(?:your\s+)?document$/i.test(part)) continue
    if (/received from|sent to|received in/i.test(part)) continue
    if (/^(?:red|blue|grey|gray|muted|pinned)$/i.test(part)) continue
    if (DOC_EXT.test(part) || /\.[a-z0-9]{2,5}$/i.test(part)) {
      if (!filename) filename = part.replace(/^document\s+/i, '').trim()
      continue
    }
    if (/\d{1,2}:\d{2}/.test(part) || /(?:am|pm)$/i.test(part)) {
      time = part
      continue
    }
    if (/\b(?:pages?|kb|mb|gb)\b/i.test(part) || /^\d+(\.\d+)?\s*(?:kb|mb|gb)$/i.test(part)) {
      detail = part
      continue
    }
  }
  if (!filename) {
    const m = /\b([\w .()\[\]_-]+\.(?:pdf|docx?|xlsx?|pptx?|txt|csv|zip))\b/i.exec(clean)
    if (m?.[1]) filename = m[1].trim()
  }
  if (!filename) return null
  const kind = (filename.split('.').pop() || 'file').toLowerCase()
  const id = simpleId(`${mine ? 'out' : 'in'}|${filename}|${time || ''}|${detail || ''}|${clean.slice(0, 80)}`)
  return { id, filename, kind, detail, time, mine, raw: clean.slice(0, 600) }
}

function simpleId(s: string): string {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return `att-${(h >>> 0).toString(16)}`
}

export function filterAttachments(
  items: ParsedAttachmentBubble[],
  intent: WhatsAppAttachmentIntent
): ParsedAttachmentBubble[] {
  let out = items.slice()
  if (intent.direction === 'incoming') out = out.filter((a) => !a.mine)
  if (intent.direction === 'outgoing') out = out.filter((a) => a.mine)
  if (intent.kind === 'pdf') out = out.filter((a) => /\.pdf$/i.test(a.filename) || a.kind === 'pdf')
  if (intent.kind === 'document') {
    out = out.filter((a) => DOC_EXT.test(a.filename) || /document/i.test(a.raw))
  }
  if (intent.nameHint) {
    const q = intent.nameHint.toLowerCase()
    out = out.filter((a) => a.filename.toLowerCase().includes(q))
  }
  return out
}

/** Pick the latest in list order (WhatsApp AX walk is typically older→newer). */
export function pickLatest(items: ParsedAttachmentBubble[]): ParsedAttachmentBubble | null {
  if (items.length === 0) return null
  return items[items.length - 1] ?? null
}

export function parseAttachmentIntent(raw: string): WhatsAppAttachmentIntent | null {
  const text = raw
    .trim()
    .replace(/[.!,]+$/g, '')
    .replace(/^(?:please\s+)?(?:(?:can|could)\s+you\s+)?/i, '')
    .replace(/\s+/g, ' ')
  if (!text) return null

  const lower = text.toLowerCase()

  // Follow-ups that need an already-retrieved file in context.
  if (/^(?:copy\s+(?:the\s+)?(?:file|document|pdf)|copy\s+it(?:\s+as\s+a\s+file)?)$/i.test(text)) {
    return { op: 'copy-file', kind: 'any', direction: 'any', latest: true }
  }
  if (/^(?:copy\s+(?:the\s+)?filename)$/i.test(text)) {
    return { op: 'copy-filename', kind: 'any', direction: 'any', latest: true }
  }
  if (/^(?:copy\s+(?:the\s+)?(?:file\s+)?path|copy\s+path)$/i.test(text)) {
    return { op: 'copy-path', kind: 'any', direction: 'any', latest: true }
  }
  if (/^(?:show\s+(?:it|that|the\s+file)\s+in\s+finder|reveal\s+(?:it|that|the\s+file)|show\s+in\s+finder)$/i.test(text)) {
    return { op: 'show-finder', kind: 'any', direction: 'any', latest: true }
  }
  if (/^(?:open\s+(?:it|that|the\s+file|the\s+pdf|the\s+document))$/i.test(text)) {
    return { op: 'open', kind: 'any', direction: 'any', latest: true }
  }
  if (
    /^(?:attach\s+it\s+here|paste\s+(?:that|the|this)\s+file\s+into\s+(?:this\s+)?chat|attach\s+(?:that|the|this)\s+file\s+here)$/i.test(
      text
    )
  ) {
    return { op: 'attach-here', kind: 'any', direction: 'any', latest: true }
  }
  if (/^(?:attach\s+(?:it|that|the\s+file)\s+elsewhere|attach\s+elsewhere)$/i.test(text)) {
    return { op: 'attach-elsewhere', kind: 'any', direction: 'any', latest: true }
  }
  if (/^(?:save\s+(?:it|that|the\s+file)\s+to\s+downloads|save\s+to\s+downloads)$/i.test(text)) {
    return { op: 'save-downloads', kind: 'any', direction: 'any', latest: true }
  }

  const fetchLike =
    /\b(?:fetch|download|get|grab|save|retrieve|pull)\b/i.test(lower) ||
    /\b(?:copy\s+this\s+file)\b/i.test(lower)
  if (!fetchLike && !/\b(?:latest|last)\s+(?:file|pdf|document|attachment)\b/i.test(lower)) {
    return null
  }
  // Avoid stealing mail/app commands.
  if (/\b(?:mail|email|gmail|chrome|safari)\b/i.test(lower) && !/\bwhats?app\b/i.test(lower)) {
    if (!/\b(?:file|pdf|document|attachment)\b/i.test(lower)) return null
  }

  let op: AttachmentOp = 'fetch'
  if (/\bsave\s+(?:it\s+)?to\s+downloads\b/i.test(lower) || /\bdownload\b/i.test(lower)) op = 'save-downloads'
  if (/\bcopy\s+this\s+file\b/i.test(lower) || /\bcopy\s+(?:the\s+)?file\b/i.test(lower)) op = 'copy-file'
  if (/\bshow\s+(?:it\s+)?in\s+finder\b/i.test(lower)) op = 'show-finder'
  if (/\battach\b/i.test(lower) || /\bpaste\s+that\s+file\b/i.test(lower)) op = 'attach-here'

  let kind: WhatsAppAttachmentIntent['kind'] = 'any'
  if (/\bpdf\b/i.test(lower)) kind = 'pdf'
  else if (/\b(?:document|doc|file|attachment)\b/i.test(lower)) kind = 'document'

  let direction: AttachmentDirection = 'any'
  if (/\b(?:they|them|he|she)\s+sent\b/i.test(lower) || /\bincoming\b/i.test(lower) || /\bthey\s+sent\b/i.test(lower)) {
    direction = 'incoming'
  }
  if (
    /\bi\s+sent\b/i.test(lower) ||
    /\bmy\s+(?:last\s+|latest\s+)?(?:file|pdf|document)\b/i.test(lower) ||
    /\boutgoing\b/i.test(lower)
  ) {
    direction = 'outgoing'
  }
  // “the last document they sent” → incoming
  if (/\bthey\s+sent\b/i.test(lower) || /\bsent\s+(?:me|to\s+me)\b/i.test(lower)) direction = 'incoming'

  const latest = /\b(?:latest|last|recent)\b/i.test(lower) || /^(?:fetch|download|get)\s+(?:the\s+)?(?:file|pdf|document)/i.test(lower)

  let nameHint: string | undefined
  const named = /(?:file|pdf|document)\s+(?:named|called)\s+(.+)$/i.exec(text)
  if (named?.[1]) nameHint = named[1].trim()

  return { op, kind, direction, latest, nameHint }
}

/** Unique destination path under Downloads — never overwrite silently. */
export function uniqueDownloadPath(downloadsDir: string, filename: string, exists: (p: string) => boolean): string {
  const safe = filename.replace(/[/\\:\0]/g, '_').trim() || 'attachment'
  const join = (dir: string, name: string) => `${dir.replace(/\/$/, '')}/${name}`
  let candidate = join(downloadsDir, safe)
  if (!exists(candidate)) return candidate
  const dot = safe.lastIndexOf('.')
  const stem = dot > 0 ? safe.slice(0, dot) : safe
  const ext = dot > 0 ? safe.slice(dot) : ''
  for (let i = 1; i < 200; i++) {
    candidate = join(downloadsDir, `${stem} (${i})${ext}`)
    if (!exists(candidate)) return candidate
  }
  return join(downloadsDir, `${stem}-${Date.now()}${ext}`)
}
