/**
 * Discover Chrome profiles from local metadata and launch by directory id.
 * Reads only Local State profile.info_cache (+ avatar image files).
 * Never reads passwords, cookies, history, or auth tokens.
 * Never modifies Chrome’s files.
 */
import { execFile, spawn } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join, resolve, sep } from 'node:path'
import { promisify } from 'node:util'
import {
  isValidChromeDirectoryId,
  profileInitials,
  safeHttpUrl,
  withDuplicateLabels,
  type ChromeProfileView
} from '../shared/chrome-profiles'

const execFileAsync = promisify(execFile)

/**
 * Start chrome.exe without waiting for it to exit. When Chrome isn’t running yet, chrome.exe
 * becomes the browser process and never exits, so execFile would time out and kill it.
 * Resolves once the process really started; rejects if it couldn’t be spawned.
 */
function startDetached(exe: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    let child
    try {
      child = spawn(exe, args, { detached: true, stdio: 'ignore', shell: false, windowsHide: false })
    } catch (error) {
      reject(error)
      return
    }
    child.once('error', reject)
    child.once('spawn', () => {
      child.unref()
      resolve()
    })
  })
}
const MAX_AVATAR_BYTES = 400_000

export type ChromeProfilesListResult =
  | {
      status: 'ok'
      profiles: ChromeProfileView[]
      chromePath: string
      platform: NodeJS.Platform
      note: string
    }
  | {
      status: 'unreadable'
      profiles: []
      reason: string
      fallbacks: { id: 'profile-picker' | 'normal'; label: string }[]
      platform: NodeJS.Platform
    }
  | {
      status: 'missing'
      profiles: []
      reason: string
      platform: NodeJS.Platform
    }

export type ChromeLaunchResult = {
  ok: boolean
  directoryId: string
  displayName: string
  url: string
  reason: string
  /** Honest limit: launch returned; frontmost profile is not verified via tab APIs. */
  verified: false
  verificationNote: string
}

type CacheEntry = {
  directoryId: string
  displayName: string
  avatarFile: string | null
  accent: string | null
}

function chromeUserDataDir(): string | null {
  if (process.platform === 'darwin') {
    return join(homedir(), 'Library', 'Application Support', 'Google', 'Chrome')
  }
  if (process.platform === 'win32') {
    const local = process.env.LOCALAPPDATA
    if (!local) return null
    return join(local, 'Google', 'Chrome', 'User Data')
  }
  return null
}

function chromeExecutable(): string | null {
  if (process.platform === 'darwin') {
    const candidates = [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      join(homedir(), 'Applications', 'Google Chrome.app', 'Contents', 'MacOS', 'Google Chrome')
    ]
    return candidates.find((p) => existsSync(p)) || null
  }
  if (process.platform === 'win32') {
    const candidates = [
      join(process.env.PROGRAMFILES || 'C:\\Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe'),
      join(process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)', 'Google', 'Chrome', 'Application', 'chrome.exe'),
      join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe')
    ]
    return candidates.find((p) => p && existsSync(p)) || null
  }
  return null
}

function colorFromChromeInt(value: unknown): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  // Chrome stores SkColor as signed 32-bit ARGB.
  const u = value >>> 0
  const r = (u >> 16) & 0xff
  const g = (u >> 8) & 0xff
  const b = u & 0xff
  return `rgb(${r}, ${g}, ${b})`
}

function readAvatarDataUrl(userData: string, directoryId: string, fileName: string | null): string | null {
  if (!fileName || fileName.includes('..') || fileName.includes('/') || fileName.includes('\\')) return null
  const profileDir = resolve(userData, directoryId)
  if (!profileDir.startsWith(resolve(userData) + sep) && profileDir !== resolve(userData)) return null
  const full = join(profileDir, fileName)
  if (!existsSync(full)) return null
  try {
    const st = statSync(full)
    if (!st.isFile() || st.size <= 0 || st.size > MAX_AVATAR_BYTES) return null
    const buf = readFileSync(full)
    const lower = fileName.toLowerCase()
    const mime = lower.endsWith('.jpg') || lower.endsWith('.jpeg') ? 'image/jpeg' : 'image/png'
    return `data:${mime};base64,${buf.toString('base64')}`
  } catch {
    return null
  }
}

function loadCache(userData: string): CacheEntry[] | null {
  const localState = join(userData, 'Local State')
  if (!existsSync(localState)) return null
  try {
    const raw = JSON.parse(readFileSync(localState, 'utf8')) as {
      profile?: { info_cache?: Record<string, Record<string, unknown>>; profiles_order?: string[] }
    }
    const cache = raw.profile?.info_cache
    if (!cache || typeof cache !== 'object') return null
    const order = Array.isArray(raw.profile?.profiles_order) ? raw.profile!.profiles_order! : Object.keys(cache)
    const out: CacheEntry[] = []
    const seen = new Set<string>()
    for (const key of [...order, ...Object.keys(cache)]) {
      if (seen.has(key) || !isValidChromeDirectoryId(key)) continue
      const meta = cache[key]
      if (!meta || typeof meta !== 'object') continue
      if (meta.is_ephemeral === true) continue
      const dirPath = join(userData, key)
      if (!existsSync(dirPath)) continue
      try {
        if (!statSync(dirPath).isDirectory()) continue
      } catch {
        continue
      }
      const displayName =
        typeof meta.name === 'string' && meta.name.trim()
          ? meta.name.trim().slice(0, 80)
          : key === 'Default'
            ? 'Person 1'
            : key
      const avatarFile =
        typeof meta.gaia_picture_file_name === 'string' && meta.gaia_picture_file_name.trim()
          ? basename(meta.gaia_picture_file_name.trim())
          : null
      seen.add(key)
      out.push({
        directoryId: key,
        displayName,
        avatarFile,
        accent: colorFromChromeInt(meta.profile_highlight_color)
      })
    }
    return out
  } catch {
    return null
  }
}

export function listChromeProfiles(savedDefaultDirectoryId?: string | null): ChromeProfilesListResult {
  const platform = process.platform
  if (platform !== 'darwin' && platform !== 'win32') {
    return {
      status: 'missing',
      profiles: [],
      reason: 'Chrome profile discovery isn’t available on this platform yet.',
      platform
    }
  }
  const exe = chromeExecutable()
  const userData = chromeUserDataDir()
  if (!exe || !userData || !existsSync(userData)) {
    return {
      status: 'missing',
      profiles: [],
      reason: platform === 'win32' ? 'I couldn’t find Google Chrome on this PC.' : 'I couldn’t find Google Chrome on this Mac.',
      platform
    }
  }
  const cache = loadCache(userData)
  if (!cache) {
    return {
      status: 'unreadable',
      profiles: [],
      reason: 'I couldn’t read Chrome’s local profile list. Nothing was invented.',
      fallbacks: [
        { id: 'profile-picker', label: 'Chrome’s profile picker' },
        { id: 'normal', label: 'Open Chrome normally' }
      ],
      platform
    }
  }
  const saved = savedDefaultDirectoryId && isValidChromeDirectoryId(savedDefaultDirectoryId) ? savedDefaultDirectoryId : null
  const labeled = withDuplicateLabels(cache)
  const profiles: ChromeProfileView[] = labeled.map((row) => ({
    directoryId: row.directoryId,
    displayName: row.displayName,
    secondaryLabel: row.secondaryLabel,
    initials: profileInitials(row.displayName),
    avatarDataUrl: readAvatarDataUrl(userData, row.directoryId, row.avatarFile),
    accent: row.accent,
    isSavedDefault: saved === row.directoryId
  }))
  return {
    status: 'ok',
    profiles,
    chromePath: exe,
    platform,
    note:
      ''
  }
}

/** Same profile + URL requested again while the first launch is still starting: one launch, one answer. */
const inflight = new Map<string, Promise<ChromeLaunchResult>>()

export function launchChromeProfile(opts: { directoryId: string; url?: string | null; displayName?: string | null }): Promise<ChromeLaunchResult> {
  const key = `${opts.directoryId}\n${opts.url ?? ''}`
  const running = inflight.get(key)
  if (running) return running
  const work = launchChromeProfileOnce(opts).finally(() => {
    // Keep a short window so a double-click that lands just after the launch still doesn't repeat it.
    setTimeout(() => inflight.delete(key), 1500)
  })
  inflight.set(key, work)
  return work
}

/** A short, readable launch error (first line of stderr / the error message). */
function launchError(error: unknown): string {
  const e = error as { stderr?: unknown; message?: unknown; code?: unknown }
  const text = typeof e?.stderr === 'string' && e.stderr.trim() ? e.stderr : typeof e?.message === 'string' ? e.message : ''
  const line = text.split(/\r?\n/).map((l) => l.trim()).find(Boolean) ?? ''
  return line.replace(/\/Users\/[^/\s]+/g, '~').slice(0, 160)
}

async function launchChromeProfileOnce(opts: {
  directoryId: string
  url?: string | null
  displayName?: string | null
}): Promise<ChromeLaunchResult> {
  const listed = listChromeProfiles()
  const verificationNote = '(Chrome accepted the launch; I can’t see which profile’s window is in front, so that part isn’t checked.)'

  if (listed.status !== 'ok') {
    return {
      ok: false,
      directoryId: '',
      displayName: '',
      url: '',
      reason: listed.status === 'unreadable' ? listed.reason : listed.reason,
      verified: false,
      verificationNote
    }
  }

  if (!isValidChromeDirectoryId(opts.directoryId)) {
    return {
      ok: false,
      directoryId: '',
      displayName: '',
      url: '',
      reason: 'That isn’t a valid Chrome profile id.',
      verified: false,
      verificationNote
    }
  }

  const live = listed.profiles.find((p) => p.directoryId === opts.directoryId)
  if (!live) {
    return {
      ok: false,
      directoryId: opts.directoryId,
      displayName: opts.displayName || opts.directoryId,
      url: '',
      reason: `I couldn’t find “${opts.displayName || opts.directoryId}” anymore. Refreshing the list.`,
      verified: false,
      verificationNote
    }
  }

  const url = opts.url ? safeHttpUrl(opts.url) : null
  if (opts.url && !url) {
    return {
      ok: false,
      directoryId: live.directoryId,
      displayName: live.displayName,
      url: '',
      reason: 'That isn’t a web address I can open.',
      verified: false,
      verificationNote
    }
  }

  const exe = chromeExecutable()
  if (!exe) {
    return {
      ok: false,
      directoryId: live.directoryId,
      displayName: live.displayName,
      url: url || '',
      reason: 'Google Chrome isn’t installed.',
      verified: false,
      verificationNote
    }
  }

  const profileArg = `--profile-directory=${live.directoryId}`
  try {
    if (process.platform === 'darwin') {
      // -n asks for a new instance; Chrome’s singleton forwards to the running process
      // and opens a window for this profile without closing other profile windows.
      // -a with the bundle path (not the name) so a Chrome in ~/Applications works too.
      const bundle = exe.replace(/\/Contents\/MacOS\/Google Chrome$/, '')
      const args = ['-na', bundle, '--args', profileArg]
      if (url) args.push(url)
      await execFileAsync('/usr/bin/open', args, { timeout: 15_000, shell: false })
    } else {
      // Chrome’s singleton forwards to a running instance and opens a window for this profile.
      const args = [profileArg]
      if (url) args.push(url)
      await startDetached(exe, args)
    }
    const where = url ? ` with ${new URL(url).hostname}` : ''
    return {
      ok: true,
      directoryId: live.directoryId,
      displayName: live.displayName,
      url: url || '',
      reason: `Started Chrome with the “${live.displayName}” profile${where}.`,
      verified: false,
      verificationNote
    }
  } catch (error) {
    const detail = launchError(error)
    return {
      ok: false,
      directoryId: live.directoryId,
      displayName: live.displayName,
      url: url || '',
      reason: `I couldn’t launch Chrome as “${live.displayName}”${detail ? ` (${detail})` : ''}. Nothing else was opened.`,
      verified: false,
      verificationNote
    }
  }
}

/** Fallback launches when Local State is unreadable — never invents profiles. */
export async function launchChromeFallback(kind: 'profile-picker' | 'normal', url?: string | null): Promise<ChromeLaunchResult> {
  const safe = url ? safeHttpUrl(url) : null
  const verificationNote =
    'Opened Chrome without a MIKO-selected profile directory. Profile ownership was not verified.'
  try {
    if (process.platform === 'darwin') {
      const args =
        kind === 'profile-picker'
          ? ['-na', 'Google Chrome', '--args', '--profile-picker', ...(safe ? [safe] : [])]
          : safe
            ? ['-a', 'Google Chrome', safe]
            : ['-a', 'Google Chrome']
      await execFileAsync('/usr/bin/open', args, { timeout: 15_000, shell: false })
    } else {
      const exe = chromeExecutable()
      if (!exe) throw new Error('missing')
      const args = kind === 'profile-picker' ? ['--profile-picker'] : []
      if (safe) args.push(safe)
      await startDetached(exe, args)
    }
    return {
      ok: true,
      directoryId: '',
      displayName: kind === 'profile-picker' ? 'Chrome profile picker' : 'Chrome',
      url: safe || '',
      reason:
        kind === 'profile-picker'
          ? 'Opened Chrome’s own profile picker.'
          : 'Opened Chrome normally (no MIKO profile selection).',
      verified: false,
      verificationNote
    }
  } catch {
    return {
      ok: false,
      directoryId: '',
      displayName: '',
      url: safe || '',
      reason: 'I couldn’t open Chrome.',
      verified: false,
      verificationNote
    }
  }
}
