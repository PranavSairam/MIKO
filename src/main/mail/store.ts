import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app, safeStorage } from 'electron'
import type { MailProvider } from '../../shared/mail'

/**
 * Mail credentials, main process only. Refresh tokens are encrypted with
 * Electron safeStorage (macOS Keychain key) before touching disk; if
 * encryption is unavailable nothing is stored. Access tokens live in memory.
 * The renderer never receives a token.
 */

export interface StoredAccount {
  provider: MailProvider
  email: string
  refreshToken: string
}

export interface OAuthClient {
  clientId: string
  clientSecret: string
}

function accountsFile(): string {
  return join(app.getPath('userData'), 'mail-accounts.enc')
}

export function canStoreSecurely(): boolean {
  return safeStorage.isEncryptionAvailable()
}

export function loadAccounts(): StoredAccount[] {
  const file = accountsFile()
  if (!existsSync(file) || !canStoreSecurely()) return []
  try {
    const parsed: unknown = JSON.parse(safeStorage.decryptString(readFileSync(file)))
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (row): row is StoredAccount =>
        !!row && row.provider === 'gmail' && typeof row.email === 'string' && typeof row.refreshToken === 'string'
    )
  } catch {
    return []
  }
}

export function saveAccounts(accounts: StoredAccount[]): boolean {
  if (!canStoreSecurely()) return false
  try {
    if (accounts.length === 0) {
      rmSync(accountsFile(), { force: true })
      return true
    }
    writeFileSync(accountsFile(), safeStorage.encryptString(JSON.stringify(accounts)), { mode: 0o600 })
    return true
  } catch {
    return false
  }
}

/**
 * Google OAuth "Desktop app" client, supplied by the owner (see PROJECT_LOG setup steps):
 * userData/mail-oauth.json  {"google": {"clientId": "…", "clientSecret": "…"}}
 * or MIKO_GOOGLE_CLIENT_ID / MIKO_GOOGLE_CLIENT_SECRET. Never committed.
 */
export function googleClient(): OAuthClient | null {
  const envId = process.env['MIKO_GOOGLE_CLIENT_ID']
  const envSecret = process.env['MIKO_GOOGLE_CLIENT_SECRET']
  if (envId && envSecret) return { clientId: envId, clientSecret: envSecret }
  // Pasted in the Mail tab: encrypted with safeStorage (Keychain).
  try {
    if (existsSync(clientFile()) && canStoreSecurely()) {
      const saved = JSON.parse(safeStorage.decryptString(readFileSync(clientFile()))) as Partial<OAuthClient>
      if (typeof saved.clientId === 'string' && typeof saved.clientSecret === 'string') {
        return { clientId: saved.clientId, clientSecret: saved.clientSecret }
      }
    }
  } catch {
    // Fall through to the plain file.
  }
  try {
    const parsed = JSON.parse(readFileSync(join(app.getPath('userData'), 'mail-oauth.json'), 'utf8')) as {
      google?: { clientId?: unknown; clientSecret?: unknown }
    }
    const id = parsed.google?.clientId
    const secret = parsed.google?.clientSecret
    if (typeof id === 'string' && id.endsWith('.apps.googleusercontent.com') && typeof secret === 'string' && secret) {
      return { clientId: id, clientSecret: secret }
    }
  } catch {
    // Not set up yet.
  }
  return null
}

function clientFile(): string {
  return join(app.getPath('userData'), 'mail-oauth.enc')
}

/** Store the owner's Google OAuth client, encrypted. Refuses when encryption is unavailable. */
export function saveGoogleClient(client: OAuthClient): boolean {
  if (!canStoreSecurely()) return false
  try {
    writeFileSync(clientFile(), safeStorage.encryptString(JSON.stringify(client)), { mode: 0o600 })
    return true
  } catch {
    return false
  }
}

export function clearGoogleClient(): void {
  rmSync(clientFile(), { force: true })
}

export function oauthConfigPath(): string {
  return join(app.getPath('userData'), 'mail-oauth.json')
}
