import { createHash, randomBytes } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import { shell } from 'electron'
import { gmailQuery, type MailFilter } from '../../shared/mail'
import { parseGmailMessage, type GmailRaw } from '../../shared/gmail'
import type { MailMessage, MailSummary } from '../../shared/mail'
import type { OAuthClient } from './store'

/**
 * Google OAuth for installed apps (PKCE + loopback redirect on 127.0.0.1) and
 * a minimal read-only Gmail client. Scope: gmail.readonly only. Viewing uses
 * messages.get, which never changes labels, so unread state is preserved.
 */

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke'
const API = 'https://gmail.googleapis.com/gmail/v1/users/me'
export const GMAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly'
const SIGN_IN_TIMEOUT_MS = 5 * 60 * 1000

export class ReconnectError extends Error {
  constructor(public account: string) {
    super('Sign-in expired')
  }
}

function base64Url(buffer: Buffer): string {
  return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** Opens Google's consent page in the browser and waits for the loopback redirect. */
export async function signIn(client: OAuthClient, loginHint?: string): Promise<{ email: string; refreshToken: string; accessToken: string; expiresAt: number }> {
  const verifier = base64Url(randomBytes(32))
  const challenge = base64Url(createHash('sha256').update(verifier).digest())
  const state = base64Url(randomBytes(16))
  const { server, port } = await listen()
  const redirectUri = `http://127.0.0.1:${port}`
  try {
    const url = new URL(AUTH_URL)
    url.search = new URLSearchParams({
      client_id: client.clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: GMAIL_SCOPE,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      state,
      access_type: 'offline',
      prompt: 'consent',
      ...(loginHint ? { login_hint: loginHint } : {})
    }).toString()
    const codePromise = waitForCode(server, state)
    await shell.openExternal(url.toString())
    const code = await codePromise
    const token = await postForm(TOKEN_URL, {
      code,
      client_id: client.clientId,
      client_secret: client.clientSecret,
      code_verifier: verifier,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri
    })
    const scopes = String(token.scope ?? '').split(' ')
    if (!scopes.includes(GMAIL_SCOPE)) throw new Error('Gmail read access was not granted.')
    if (typeof token.refresh_token !== 'string' || typeof token.access_token !== 'string') {
      throw new Error('Google did not return a refresh token.')
    }
    const profile = (await getJson(`${API}/profile`, token.access_token)) as { emailAddress?: unknown }
    if (typeof profile.emailAddress !== 'string') throw new Error('Could not read the mailbox address.')
    return {
      email: profile.emailAddress,
      refreshToken: token.refresh_token,
      accessToken: token.access_token,
      expiresAt: Date.now() + Number(token.expires_in ?? 3000) * 1000
    }
  } finally {
    server.close()
  }
}

export async function refresh(client: OAuthClient, account: string, refreshToken: string): Promise<{ accessToken: string; expiresAt: number }> {
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: client.clientId,
      client_secret: client.clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token'
    })
  })
  const body = (await response.json().catch(() => ({}))) as { access_token?: unknown; expires_in?: unknown; error?: unknown }
  if (!response.ok || typeof body.access_token !== 'string') {
    if (body.error === 'invalid_grant' || response.status === 400 || response.status === 401) throw new ReconnectError(account)
    throw new Error(`Token refresh failed (${response.status}).`)
  }
  return { accessToken: body.access_token, expiresAt: Date.now() + Number(body.expires_in ?? 3000) * 1000 }
}

export async function revoke(refreshToken: string): Promise<void> {
  await fetch(`${REVOKE_URL}?token=${encodeURIComponent(refreshToken)}`, { method: 'POST' }).catch(() => undefined)
}

/** One page of message ids for a Gmail search, newest first. */
export async function listIds(
  token: string,
  filter: MailFilter,
  search: string,
  pageToken: string | null,
  max: number
): Promise<{ ids: string[]; next: string | null }> {
  const params = new URLSearchParams({ q: gmailQuery(filter, search), maxResults: String(max) })
  if (pageToken) params.set('pageToken', pageToken)
  const body = (await getJson(`${API}/messages?${params}`, token)) as { messages?: { id?: unknown }[]; nextPageToken?: unknown }
  const ids = (body.messages ?? []).map((m) => m.id).filter((id): id is string => typeof id === 'string')
  return { ids, next: typeof body.nextPageToken === 'string' ? body.nextPageToken : null }
}

export async function getSummary(token: string, account: string, id: string): Promise<MailSummary> {
  const params = new URLSearchParams({ format: 'metadata' })
  for (const h of ['From', 'To', 'Cc', 'Subject', 'Date']) params.append('metadataHeaders', h)
  const raw = (await getJson(`${API}/messages/${encodeURIComponent(id)}?${params}`, token)) as GmailRaw
  const { html: _h, text: _t, cc: _c, replyTo: _r, ...summary } = parseGmailMessage(raw, account)
  return summary
}

export async function getMessage(token: string, account: string, id: string): Promise<MailMessage> {
  const raw = (await getJson(`${API}/messages/${encodeURIComponent(id)}?format=full`, token)) as GmailRaw
  return parseGmailMessage(raw, account)
}

/** Every message of a thread, oldest first (threads.get never changes labels). */
export async function getThread(token: string, account: string, threadId: string): Promise<MailMessage[]> {
  const raw = (await getJson(`${API}/threads/${encodeURIComponent(threadId)}?format=full`, token)) as { messages?: GmailRaw[] }
  return (raw.messages ?? []).map((m) => parseGmailMessage(m, account)).sort((a, b) => a.date - b.date)
}

export class HttpError extends Error {
  constructor(public status: number) {
    super(`Gmail request failed (${status}).`)
  }
}

async function getJson(url: string, token: string): Promise<unknown> {
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
  if (!response.ok) throw new HttpError(response.status)
  return response.json()
}

async function postForm(url: string, form: Record<string, string>): Promise<Record<string, unknown>> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(form)
  })
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>
  if (!response.ok) throw new Error(`Google sign-in failed: ${String(body.error_description ?? body.error ?? response.status)}`)
  return body
}

function listen(): Promise<{ server: Server; port: number }> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (address && typeof address === 'object') resolve({ server, port: address.port })
      else reject(new Error('No loopback port'))
    })
  })
}

const PAGE = (title: string): string =>
  `<!doctype html><meta charset="utf-8"><title>MIKO</title><body style="font:16px -apple-system,sans-serif;padding:40px">${title}</body>`

function waitForCode(server: Server, state: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Sign-in timed out.')), SIGN_IN_TIMEOUT_MS)
    server.on('request', (req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      const code = url.searchParams.get('code')
      const error = url.searchParams.get('error')
      if (!code && !error) {
        res.writeHead(404).end()
        return
      }
      clearTimeout(timer)
      if (url.searchParams.get('state') !== state) {
        res.writeHead(400, { 'Content-Type': 'text/html' }).end(PAGE('Sign-in did not match. Close this tab and try again from MIKO.'))
        reject(new Error('Sign-in state did not match.'))
        return
      }
      if (error || !code) {
        res.writeHead(200, { 'Content-Type': 'text/html' }).end(PAGE('MIKO was not connected. You can close this tab.'))
        reject(new Error(error === 'access_denied' ? 'Access was not granted.' : 'Sign-in failed.'))
        return
      }
      res.writeHead(200, { 'Content-Type': 'text/html' }).end(PAGE('MIKO is connected to Gmail (read-only). You can close this tab.'))
      resolve(code)
    })
  })
}
