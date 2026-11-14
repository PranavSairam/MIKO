/** Parsing Gmail API message resources (users.messages.get). Pure; works in main and tests. */
import type { MailMessage } from './mail.ts'

interface GmailPart {
  mimeType?: string
  filename?: string
  headers?: { name?: string; value?: string }[]
  body?: { data?: string; size?: number }
  parts?: GmailPart[]
}

export interface GmailRaw {
  id?: string
  threadId?: string
  labelIds?: string[]
  snippet?: string
  internalDate?: string
  payload?: GmailPart
}

export function decodeBase64Url(data: string): string {
  const b64 = data.replace(/-/g, '+').replace(/_/g, '/')
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4)
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes)
}

export function parseAddress(raw: string): { name: string; email: string } {
  const value = raw.trim()
  const angle = /^(.*?)<([^<>@\s]+@[^<>\s]+)>\s*$/.exec(value)
  if (angle) return { name: angle[1].trim().replace(/^"|"$/g, '').trim(), email: angle[2].trim() }
  return { name: '', email: value }
}

/** Addresses in a header like To/Cc, lower-cased. Splits on commas outside quotes. */
export function addressList(raw: string): string[] {
  const out: string[] = []
  let current = ''
  let quoted = false
  for (const ch of raw) {
    if (ch === '"') quoted = !quoted
    if (ch === ',' && !quoted) {
      out.push(current)
      current = ''
    } else current += ch
  }
  if (current.trim()) out.push(current)
  return out.map((part) => parseAddress(part).email.toLowerCase()).filter(Boolean)
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", apos: "'", nbsp: ' ' }

export function decodeEntities(text: string): string {
  return text
    .replace(/&(amp|lt|gt|quot|#39|apos|nbsp);/g, (_m, name: string) => ENTITIES[name] ?? _m)
    .replace(/&#(\d{1,6});/g, (_m, code: string) => String.fromCodePoint(Number(code)))
}

function header(part: GmailPart | undefined, name: string): string {
  const lower = name.toLowerCase()
  return part?.headers?.find((h) => (h.name ?? '').toLowerCase() === lower)?.value ?? ''
}

function collectBodies(part: GmailPart | undefined, found: { html: string; text: string }): void {
  if (!part) return
  if (part.filename) return // attachments are not rendered
  const type = (part.mimeType ?? '').toLowerCase()
  if (part.body?.data && type === 'text/html' && !found.html) found.html = decodeBase64Url(part.body.data)
  else if (part.body?.data && type === 'text/plain' && !found.text) found.text = decodeBase64Url(part.body.data)
  for (const child of part.parts ?? []) collectBodies(child, found)
}

/** Builds MIKO's message from a Gmail resource (format=full or metadata). Bodies are empty for metadata. */
export function parseGmailMessage(raw: GmailRaw, account: string): MailMessage {
  const id = String(raw.id ?? '')
  const payload = raw.payload
  const from = parseAddress(header(payload, 'From'))
  const to = header(payload, 'To')
  const me = account.toLowerCase()
  const bodies = { html: '', text: '' }
  collectBodies(payload, bodies)
  const labels = Array.isArray(raw.labelIds) ? raw.labelIds.filter((l): l is string => typeof l === 'string') : []
  const date = Number(raw.internalDate)
  return {
    key: `gmail:${account}:${id}`,
    provider: 'gmail',
    account,
    id,
    threadId: String(raw.threadId ?? ''),
    from: from.name || from.email,
    fromEmail: from.email,
    to,
    cc: header(payload, 'Cc'),
    replyTo: header(payload, 'Reply-To'),
    subject: header(payload, 'Subject') || '(no subject)',
    snippet: decodeEntities(raw.snippet ?? ''),
    date: Number.isFinite(date) ? date : 0,
    unread: labels.includes('UNREAD'),
    labels,
    directToMe: addressList(to).includes(me),
    html: bodies.html,
    text: bodies.text
  }
}

/** Gmail web link for one message in the given account (authuser by address, so multi-account works). */
export function gmailWebUrl(account: string, messageId: string): string | null {
  if (!/^[0-9a-f]{6,32}$/i.test(messageId)) return null
  return `https://mail.google.com/mail/u/${encodeURIComponent(account)}/#all/${messageId}`
}
