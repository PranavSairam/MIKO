/**
 * Update status types for the private-beta channel.
 *
 * Zero-budget default: manual download link (unsigned builds never auto-install).
 * Later / signed: electron-updater + generic HTTPS feed (code preserved in main/updater.ts).
 */

export const UPDATE_CHANNEL = 'beta'

export type UpdateMode = 'manual' | 'auto'

export type UpdatePhase =
  | 'idle'
  | 'disabled'
  | 'checking'
  | 'available'
  | 'not-available'
  | 'downloading'
  | 'download-opened'
  | 'ready'
  | 'installed'
  | 'error'
  | 'offline'

export interface UpdateStatus {
  phase: UpdatePhase
  mode: UpdateMode
  channel: string
  currentVersion: string
  availableVersion: string | null
  progressPercent: number | null
  message: string
  /** Version already offered; suppress repeat “ready” / available noise for the same build. */
  silencedVersion: string | null
  lastCheckedAt: number | null
  packaged: boolean
  /** True when this build is not Developer ID–signed (auto-install disabled). */
  unsigned: boolean
  /** Human-readable block reason for auto-install, if any. */
  installBlockedReason: string | null
  /** Direct DMG/ZIP or shared-folder URL for manual updates. */
  downloadUrl: string | null
}

export function emptyUpdateStatus(partial?: Partial<UpdateStatus>): UpdateStatus {
  return {
    phase: 'idle',
    mode: 'manual',
    channel: UPDATE_CHANNEL,
    currentVersion: '0.0.0',
    availableVersion: null,
    progressPercent: null,
    message: '',
    silencedVersion: null,
    lastCheckedAt: null,
    packaged: false,
    unsigned: true,
    installBlockedReason: null,
    downloadUrl: null,
    ...partial
  }
}

/** Recoverable MIKO-owned state flushed before an update restart / app replace. */
export interface UpdateHandoff {
  at: number
  fromVersion: string
  toVersion: string | null
  /** External/state-changing actions cancelled — must not replay after relaunch. */
  cancelledActionKinds: string[]
  /** Optional composer draft text owned by MIKO (not WhatsApp send). */
  draftText: string
  prefsFlushed: boolean
}

export const SETTINGS_SCHEMA_VERSION = 2

/** Compare dotted numeric versions; true if remote is strictly newer than local. */
export function isNewerVersion(remote: string, local: string): boolean {
  const parse = (v: string): number[] =>
    String(v)
      .trim()
      .replace(/^v/i, '')
      .split(/[.+-]/)
      .map((p) => {
        const n = Number.parseInt(p, 10)
        return Number.isFinite(n) ? n : 0
      })
  const a = parse(remote)
  const b = parse(local)
  const len = Math.max(a.length, b.length)
  for (let i = 0; i < len; i++) {
    const x = a[i] ?? 0
    const y = b[i] ?? 0
    if (x > y) return true
    if (x < y) return false
  }
  return false
}

/** Shape of optional latest.json next to a shared DMG (zero-budget). */
export interface LatestManifest {
  version: string
  downloadUrl: string
  notes?: string
}

export function parseLatestManifest(raw: unknown): LatestManifest | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const version = typeof o.version === 'string' ? o.version.trim() : ''
  const downloadUrl = typeof o.downloadUrl === 'string' ? o.downloadUrl.trim() : ''
  if (!version || !/^https?:\/\//i.test(downloadUrl)) return null
  const notes = typeof o.notes === 'string' ? o.notes.trim().slice(0, 500) : undefined
  return { version, downloadUrl, ...(notes ? { notes } : {}) }
}
