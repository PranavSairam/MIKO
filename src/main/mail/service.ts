import { app, shell } from 'electron'
import { gmailWebUrl } from '../../shared/gmail'
import {
  PAGE_SIZE,
  classifyImportance,
  gmailQuery,
  mergeNewest,
  type Importance,
  type ImportanceRules,
  type MailAccount,
  type MailFilter,
  type MailMessage,
  type MailSummary
} from '../../shared/mail'
import { mailRules } from '../settings'
import { HttpError, ReconnectError, getMessage, getSummary, listIds, refresh, revoke, signIn } from './google'
import { PREVIEW_ACCOUNTS, previewMatches, previewMessages } from './preview'
import { canStoreSecurely, googleClient, loadAccounts, oauthConfigPath, saveAccounts } from './store'

/** Mail for the panel: accounts, paged lists across accounts, read-only message view. */

export interface MailStatus {
  accounts: MailAccount[]
  /** Google OAuth client configured (or preview mode). */
  configured: boolean
  preview: boolean
  secureStorage: boolean
  setupPath: string
}

export interface ListRequest {
  listId: string
  more: boolean
  filter: MailFilter
  query: string
  /** 'all' or one account email. */
  account: string
  unreadOnly: boolean
}

export type ListedMail = MailSummary & { importance: Importance }

export interface ListResult {
  listId: string
  items: ListedMail[]
  done: boolean
  errors: { account: string; kind: 'reconnect' | 'error'; message: string }[]
}

interface Cursor {
  pageToken: string | null
  done: boolean
  buffer: ListedMail[]
}

const PREVIEW = process.env['MIKO_MAIL_PREVIEW'] === '1' && !app.isPackaged
const PREVIEW_EXPIRED = process.env['MIKO_MAIL_PREVIEW_EXPIRE'] ?? ''
const MAX_PAGES_PER_CALL = 5
const tokens = new Map<string, { accessToken: string; expiresAt: number }>()
const reconnect = new Set<string>()
const lists = new Map<string, { request: ListRequest; cursors: Record<string, Cursor> }>()

export function mailStatus(): MailStatus {
  const accounts: MailAccount[] = PREVIEW
    ? PREVIEW_ACCOUNTS.map((email) => ({ email, provider: 'gmail', status: email === PREVIEW_EXPIRED ? 'reconnect' : 'ok' }))
    : loadAccounts().map((a) => ({ email: a.email, provider: a.provider, status: reconnect.has(a.email) ? 'reconnect' : 'ok' }))
  return {
    accounts,
    configured: PREVIEW || googleClient() !== null,
    preview: PREVIEW,
    secureStorage: canStoreSecurely(),
    setupPath: oauthConfigPath()
  }
}

export async function connectAccount(loginHint?: string): Promise<{ ok: boolean; reason: string; email?: string }> {
  if (PREVIEW) return { ok: false, reason: 'Preview mode uses sample mail only.' }
  const client = googleClient()
  if (!client) return { ok: false, reason: 'Gmail isn’t set up yet. See the setup steps in PROJECT_LOG.md.' }
  if (!canStoreSecurely()) return { ok: false, reason: 'Secure storage (Keychain) isn’t available, so MIKO won’t store mail access.' }
  try {
    const result = await signIn(client, loginHint)
    const accounts = loadAccounts().filter((a) => a.email.toLowerCase() !== result.email.toLowerCase())
    accounts.push({ provider: 'gmail', email: result.email, refreshToken: result.refreshToken })
    if (!saveAccounts(accounts)) return { ok: false, reason: 'Could not store the sign-in securely.' }
    tokens.set(result.email, { accessToken: result.accessToken, expiresAt: result.expiresAt })
    reconnect.delete(result.email)
    lists.clear()
    return { ok: true, reason: '', email: result.email }
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : 'Sign-in failed.' }
  }
}

export async function disconnectAccount(email: string): Promise<boolean> {
  if (PREVIEW) return false
  const accounts = loadAccounts()
  const found = accounts.find((a) => a.email === email)
  if (!found) return false
  await revoke(found.refreshToken)
  tokens.delete(email)
  reconnect.delete(email)
  lists.clear()
  return saveAccounts(accounts.filter((a) => a.email !== email))
}

async function token(email: string, force = false): Promise<string> {
  const cached = tokens.get(email)
  if (!force && cached && cached.expiresAt - 60_000 > Date.now()) return cached.accessToken
  const client = googleClient()
  const stored = loadAccounts().find((a) => a.email === email)
  if (!client || !stored) throw new ReconnectError(email)
  const next = await refresh(client, email, stored.refreshToken)
  tokens.set(email, next)
  reconnect.delete(email)
  return next.accessToken
}

/** Runs a Gmail call, refreshing once on 401; marks the account for reconnect when Google refuses. */
async function withToken<T>(email: string, call: (accessToken: string) => Promise<T>): Promise<T> {
  try {
    try {
      return await call(await token(email))
    } catch (error) {
      if (error instanceof HttpError && error.status === 401) return await call(await token(email, true))
      throw error
    }
  } catch (error) {
    if (error instanceof ReconnectError || (error instanceof HttpError && error.status === 401)) {
      reconnect.add(email)
      tokens.delete(email)
      throw new ReconnectError(email)
    }
    throw error
  }
}

async function inBatches<T, R>(items: T[], size: number, run: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = []
  for (let i = 0; i < items.length; i += size) out.push(...(await Promise.all(items.slice(i, i + size).map(run))))
  return out
}

/** Fetch one more page for an account, already classified and filtered. */
async function fetchPage(email: string, request: ListRequest, cursor: Cursor, rules: ImportanceRules): Promise<void> {
  const keep = (m: MailSummary): ListedMail | null => {
    const importance = classifyImportance(m, rules)
    if (request.filter === 'important' && !importance.important) return null
    if (request.unreadOnly && !m.unread) return null
    return { ...m, importance }
  }
  if (PREVIEW) {
    if (email === PREVIEW_EXPIRED) throw new ReconnectError(email)
    const q = gmailQuery(request.filter, request.query)
    const all = previewMessages().filter((m) => m.account === email && previewMatches(m, q))
    const start = Number(cursor.pageToken ?? 0)
    const page = all.slice(start, start + PAGE_SIZE)
    cursor.pageToken = String(start + PAGE_SIZE)
    cursor.done = start + PAGE_SIZE >= all.length
    for (const m of page) {
      const { html: _h, text: _t, cc: _c, ...summary } = m
      const listed = keep(summary)
      if (listed) cursor.buffer.push(listed)
    }
    return
  }
  const page = await withToken(email, (t) => listIds(t, request.filter, request.query, cursor.pageToken, PAGE_SIZE))
  cursor.pageToken = page.next
  cursor.done = page.next === null
  const summaries = await inBatches(page.ids, 8, (id) => withToken(email, (t) => getSummary(t, email, id)))
  for (const m of summaries) {
    const listed = keep(m)
    if (listed) cursor.buffer.push(listed)
  }
}

export async function listMail(request: ListRequest): Promise<ListResult> {
  const status = mailStatus()
  let state = request.more ? lists.get(request.listId) : undefined
  if (!state) {
    const emails = status.accounts.map((a) => a.email).filter((e) => request.account === 'all' || e === request.account)
    state = { request, cursors: Object.fromEntries(emails.map((e) => [e, { pageToken: null, done: false, buffer: [] }])) }
    lists.set(request.listId, state)
    while (lists.size > 6) lists.delete(lists.keys().next().value as string)
  }
  const rules = mailRules()
  const errors: ListResult['errors'] = []
  await Promise.all(
    Object.entries(state.cursors).map(async ([email, cursor]) => {
      let pages = 0
      try {
        while (!cursor.done && cursor.buffer.length < PAGE_SIZE && pages < MAX_PAGES_PER_CALL) {
          await fetchPage(email, state.request, cursor, rules)
          pages += 1
        }
      } catch (error) {
        cursor.done = true
        errors.push(
          error instanceof ReconnectError
            ? { account: email, kind: 'reconnect', message: `Sign-in for ${email} expired. Reconnect to keep reading it.` }
            : { account: email, kind: 'error', message: `Couldn’t load ${email}: ${error instanceof Error ? error.message : 'unknown error'}` }
        )
      }
    })
  )
  const merged = mergeNewest(
    Object.fromEntries(Object.entries(state.cursors).map(([e, c]) => [e, c.buffer])) as Record<string, MailSummary[]>,
    PAGE_SIZE
  )
  for (const [email, rest] of Object.entries(merged.rest)) state.cursors[email].buffer = rest as ListedMail[]
  const done = Object.values(state.cursors).every((c) => c.done && c.buffer.length === 0)
  return { listId: request.listId, items: merged.take as ListedMail[], done, errors }
}

function splitKey(key: string): { account: string; id: string } | null {
  const match = /^gmail:([^:]+@[^:]+):([0-9a-zA-Z]+)$/.exec(key)
  if (!match) return null
  const known = mailStatus().accounts.some((a) => a.email === match[1])
  return known ? { account: match[1], id: match[2] } : null
}

/** Full message, read-only (messages.get does not change UNREAD). */
export async function readMail(key: string): Promise<{ ok: true; message: MailMessage } | { ok: false; reason: string; reconnect?: string }> {
  const parts = splitKey(key)
  if (!parts) return { ok: false, reason: 'That message isn’t available.' }
  try {
    if (PREVIEW) {
      const found = previewMessages().find((m) => m.key === key)
      return found ? { ok: true, message: found } : { ok: false, reason: 'That message isn’t available.' }
    }
    return { ok: true, message: await withToken(parts.account, (t) => getMessage(t, parts.account, parts.id)) }
  } catch (error) {
    if (error instanceof ReconnectError) return { ok: false, reason: `Sign-in for ${parts.account} expired.`, reconnect: parts.account }
    return { ok: false, reason: error instanceof Error ? error.message : 'Couldn’t open the message.' }
  }
}

/** Opens the message in Gmail on the web for its own account. Gmail may mark it read. */
export async function openOriginal(key: string): Promise<boolean> {
  const parts = splitKey(key)
  if (!parts) return false
  const url = gmailWebUrl(parts.account, parts.id)
  if (!url) return false
  return shell.openExternal(url).then(
    () => true,
    () => false
  )
}
