/**
 * Private-beta updates.
 *
 * Zero-budget (default for unsigned packaged builds):
 *   - Never auto-download / auto-install
 *   - Check optional latest.json; open a configurable Download latest link
 *   - Phases: available → download-opened → installed (after replace + relaunch)
 *
 * Signed builds (Developer ID): keep electron-updater generic HTTPS feed path
 * for later — not used until the app is actually Developer ID–signed.
 *
 * Official auto-update docs: https://www.electron.build/docs/features/auto-update/
 */

import { app, shell } from 'electron'
import electronUpdater from 'electron-updater'
import { execFileSync } from 'node:child_process'
import { appendFileSync, existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  emptyUpdateStatus,
  isNewerVersion,
  parseLatestManifest,
  UPDATE_CHANNEL,
  type UpdateMode,
  type UpdateStatus
} from '../shared/updater'
import { UPDATE_FEED_URL } from '../shared/update-feed-url'
import { MANUAL_RELEASE_URL } from '../shared/manual-release-url'
import {
  downloadOpenedMessage,
  installedKeptSettingsMessage,
  replaceAppReminder,
  restartBlockedReason,
  unsignedUpdateInstructions
} from '../shared/platform-copy'
import { IPC } from '../shared/api'
import { postToPet } from './pet-window'
import { prepareForUpdateRestart } from './session-flush'

const { autoUpdater } = electronUpdater

const PERIOD_MS = 4 * 60 * 60 * 1000
const STARTUP_DELAY_MS = 12_000

let status: UpdateStatus = emptyUpdateStatus()
let periodTimer: NodeJS.Timeout | null = null
let started = false
let draftProvider: (() => string) | null = null
let autoWired = false
let mode: UpdateMode = 'manual'
let unsigned = true

function logLine(message: string): void {
  try {
    const line = `${new Date().toISOString()} ${message}\n`
    appendFileSync(join(app.getPath('userData'), 'updater.log'), line, { mode: 0o600 })
  } catch {
    // Never block on logging.
  }
}

function silencePath(): string {
  return join(app.getPath('userData'), 'update-silence.json')
}

function manualConfigPath(): string {
  return join(app.getPath('userData'), 'manual-release.json')
}

function pendingManualPath(): string {
  return join(app.getPath('userData'), 'manual-update-pending.json')
}

function loadSilenced(): string | null {
  try {
    if (!existsSync(silencePath())) return null
    const parsed = JSON.parse(readFileSync(silencePath(), 'utf8')) as { version?: unknown }
    return typeof parsed.version === 'string' ? parsed.version : null
  } catch {
    return null
  }
}

function saveSilenced(version: string | null): void {
  try {
    writeFileSync(
      silencePath(),
      JSON.stringify(version ? { version, at: Date.now() } : { version: null }, null, 2),
      { mode: 0o600 }
    )
  } catch {
    // Ignore.
  }
}

/** Detect Developer ID Application signature (not Apple Development). */
export function isDeveloperIdSigned(): boolean {
  if (process.platform !== 'darwin' || !app.isPackaged) return false
  try {
    const result = execFileSync('codesign', ['-dv', '--verbose=4', process.execPath], {
      encoding: 'utf8',
      timeout: 8000
    })
    return /Authority=Developer ID Application/i.test(result)
  } catch (error) {
    const err = error as { stderr?: string; stdout?: string; message?: string }
    const text = `${err.stderr || ''}${err.stdout || ''}${err.message || ''}`
    return /Authority=Developer ID Application/i.test(text)
  }
}

interface ManualReleaseConfig {
  downloadUrl: string
  latestJsonUrl: string
}

function readManualConfigFile(): ManualReleaseConfig {
  try {
    if (!existsSync(manualConfigPath())) return { downloadUrl: '', latestJsonUrl: '' }
    const parsed = JSON.parse(readFileSync(manualConfigPath(), 'utf8')) as Record<string, unknown>
    return {
      downloadUrl: typeof parsed.downloadUrl === 'string' ? parsed.downloadUrl.trim() : '',
      latestJsonUrl: typeof parsed.latestJsonUrl === 'string' ? parsed.latestJsonUrl.trim() : ''
    }
  } catch {
    return { downloadUrl: '', latestJsonUrl: '' }
  }
}

function resolvedManualConfig(): ManualReleaseConfig {
  const file = readManualConfigFile()
  const envDownload = (process.env['MIKO_MANUAL_RELEASE_URL'] || MANUAL_RELEASE_URL || '').trim()
  const envLatest = (process.env['MIKO_LATEST_JSON_URL'] || '').trim()
  return {
    downloadUrl: file.downloadUrl || envDownload,
    latestJsonUrl: file.latestJsonUrl || envLatest
  }
}

function publish(): void {
  postToPet(IPC.updateStatus, { ...status })
}

function setStatus(patch: Partial<UpdateStatus>): void {
  status = { ...status, ...patch, mode, unsigned }
  if (patch.phase || patch.message) {
    logLine(`mode=${mode} phase=${status.phase} msg=${status.message} avail=${status.availableVersion || '-'}`)
  }
  publish()
}

function feedOverrideUrl(): string {
  const overridePath = join(app.getPath('userData'), 'update-feed.json')
  try {
    if (existsSync(overridePath)) {
      const parsed = JSON.parse(readFileSync(overridePath, 'utf8')) as { url?: unknown }
      if (typeof parsed.url === 'string' && /^https?:\/\//i.test(parsed.url.trim())) {
        return parsed.url.trim().replace(/\/?$/, '/')
      }
    }
  } catch {
    // Fall through.
  }
  const fromEnv = (process.env['MIKO_UPDATE_URL'] || '').trim()
  if (fromEnv) return fromEnv.replace(/\/?$/, '/')
  return ''
}

function resolvedFeedUrl(): string {
  return feedOverrideUrl() || (UPDATE_FEED_URL || '').trim().replace(/\/?$/, '/') || ''
}

function consumeManualInstallIfNeeded(): void {
  try {
    if (!existsSync(pendingManualPath())) return
    const pending = JSON.parse(readFileSync(pendingManualPath(), 'utf8')) as {
      fromVersion?: string
      toVersion?: string | null
    }
    const from = typeof pending.fromVersion === 'string' ? pending.fromVersion : ''
    const current = app.getVersion()
    if (from && current !== from) {
      try {
        unlinkSync(pendingManualPath())
      } catch {
        // ignore
      }
      setStatus({
        phase: 'installed',
        availableVersion: null,
        message: installedKeptSettingsMessage(process.platform, current)
      })
      logLine(`manual install detected ${from} → ${current}`)
    }
  } catch {
    // Ignore.
  }
}

export function getUpdateStatus(): UpdateStatus {
  return { ...status }
}

export function setUpdateDraftProvider(fn: (() => string) | null): void {
  draftProvider = fn
}

export function setUpdateFeedOverride(url: string): { ok: boolean; reason: string } {
  const trimmed = url.trim()
  if (trimmed && !/^https?:\/\//i.test(trimmed)) {
    return { ok: false, reason: 'Feed URL must be http(s).' }
  }
  try {
    const path = join(app.getPath('userData'), 'update-feed.json')
    writeFileSync(path, JSON.stringify({ url: trimmed.replace(/\/?$/, '/') }, null, 2), { mode: 0o600 })
    if (mode === 'auto') configureAutoFeed()
    return { ok: true, reason: trimmed ? 'Feed override saved.' : 'Feed override cleared.' }
  } catch {
    return { ok: false, reason: 'Could not save feed override.' }
  }
}

export function setManualReleaseConfig(partial: {
  downloadUrl?: string
  latestJsonUrl?: string
}): { ok: boolean; reason: string; config: ManualReleaseConfig } {
  const cur = resolvedManualConfig()
  const next: ManualReleaseConfig = {
    downloadUrl: partial.downloadUrl !== undefined ? partial.downloadUrl.trim() : cur.downloadUrl,
    latestJsonUrl: partial.latestJsonUrl !== undefined ? partial.latestJsonUrl.trim() : cur.latestJsonUrl
  }
  for (const [label, value] of [
    ['downloadUrl', next.downloadUrl],
    ['latestJsonUrl', next.latestJsonUrl]
  ] as const) {
    if (value && !/^https?:\/\//i.test(value)) {
      return { ok: false, reason: `${label} must be http(s).`, config: cur }
    }
  }
  try {
    writeFileSync(manualConfigPath(), JSON.stringify(next, null, 2), { mode: 0o600 })
    setStatus({
      downloadUrl: next.downloadUrl || null,
      message: next.downloadUrl
        ? 'Manual download link saved.'
        : 'Manual download link cleared. Ask the owner for a shared release folder URL.'
    })
    return { ok: true, reason: 'Saved.', config: next }
  } catch {
    return { ok: false, reason: 'Could not save manual release config.', config: cur }
  }
}

function configureAutoFeed(): void {
  const url = resolvedFeedUrl()
  const enabled = Boolean(url)
  setStatus({
    phase: !app.isPackaged ? 'disabled' : enabled ? 'idle' : 'disabled',
    channel: UPDATE_CHANNEL,
    currentVersion: app.getVersion(),
    packaged: app.isPackaged,
    silencedVersion: loadSilenced(),
    downloadUrl: resolvedManualConfig().downloadUrl || null,
    message: !app.isPackaged
      ? 'Updates run in packaged builds only.'
      : enabled
        ? 'Signed build — automatic updates enabled.'
        : 'No update feed configured for signed auto-updates.',
    installBlockedReason: null
  })
  if (!app.isPackaged || !enabled) return

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.allowDowngrade = false
  autoUpdater.channel = UPDATE_CHANNEL
  try {
    autoUpdater.setFeedURL({
      provider: 'generic',
      url,
      channel: UPDATE_CHANNEL
    })
    logLine(`auto feed ${url}`)
  } catch (error) {
    setStatus({
      phase: 'error',
      message: error instanceof Error ? error.message : 'Could not configure update feed.'
    })
  }
}

function configureManual(): void {
  const manual = resolvedManualConfig()
  setStatus({
    phase: app.isPackaged ? 'idle' : 'disabled',
    channel: UPDATE_CHANNEL,
    currentVersion: app.getVersion(),
    packaged: app.isPackaged,
    silencedVersion: loadSilenced(),
    downloadUrl: manual.downloadUrl || null,
    installBlockedReason: unsignedUpdateInstructions(process.platform),
    message: !app.isPackaged
      ? 'Updates run in packaged builds only.'
      : manual.downloadUrl
        ? 'Manual updates: Check for updates, then Download latest version.'
        : 'No shared release link yet. Paste one in Preferences, or ask the owner.'
  })
}

function wireAutoEvents(): void {
  if (autoWired) return
  autoWired = true
  autoUpdater.on('checking-for-update', () => {
    setStatus({ phase: 'checking', message: 'Checking for updates…', lastCheckedAt: Date.now() })
  })
  autoUpdater.on('update-available', (info) => {
    const ver = info.version || null
    setStatus({
      phase: 'available',
      availableVersion: ver,
      message: ver ? `Update ${ver} available — downloading…` : 'Update available — downloading…'
    })
  })
  autoUpdater.on('update-not-available', () => {
    setStatus({
      phase: 'not-available',
      availableVersion: null,
      progressPercent: null,
      message: 'You’re on the latest beta build.',
      lastCheckedAt: Date.now()
    })
  })
  autoUpdater.on('download-progress', (p) => {
    const pct = typeof p.percent === 'number' ? Math.max(0, Math.min(100, Math.round(p.percent))) : null
    setStatus({ phase: 'downloading', progressPercent: pct, message: pct != null ? `Downloading… ${pct}%` : 'Downloading…' })
  })
  autoUpdater.on('update-downloaded', (info) => {
    const ver = info.version || status.availableVersion
    if (ver && status.silencedVersion === ver) {
      setStatus({
        phase: 'ready',
        availableVersion: ver,
        progressPercent: 100,
        message: `Update ${ver} ready (reminder muted). Restart from Settings when you want it.`
      })
      return
    }
    setStatus({
      phase: 'ready',
      availableVersion: ver,
      progressPercent: 100,
      message: ver ? `Update ready — ${ver}` : 'Update ready'
    })
  })
  autoUpdater.on('error', (error) => {
    const msg = error instanceof Error ? error.message : String(error)
    const offline = /ENOTFOUND|ECONNREFUSED|ETIMEDOUT|net::|offline|network/i.test(msg)
    setStatus({
      phase: offline ? 'offline' : 'error',
      message: offline ? 'Update check skipped (offline or unreachable).' : msg.slice(0, 240),
      lastCheckedAt: Date.now()
    })
  })
}

export function startUpdater(): void {
  if (started) return
  started = true
  unsigned = !isDeveloperIdSigned()
  mode = unsigned || process.platform !== 'darwin' ? 'manual' : 'auto'
  // Force manual when unsigned even if a feed URL exists — never auto-install unsigned.
  if (unsigned) mode = 'manual'

  status = emptyUpdateStatus({
    mode,
    unsigned,
    currentVersion: app.getVersion(),
    packaged: app.isPackaged,
    channel: UPDATE_CHANNEL
  })

  if (mode === 'auto') {
    configureAutoFeed()
  } else {
    configureManual()
  }
  consumeManualInstallIfNeeded()
  logLine(`start mode=${mode} unsigned=${unsigned} packaged=${app.isPackaged} version=${app.getVersion()}`)
  publish()

  if (!app.isPackaged || status.phase === 'disabled') return

  if (mode === 'auto') {
    wireAutoEvents()
    setTimeout(() => {
      void checkForUpdates(false)
    }, STARTUP_DELAY_MS)
    periodTimer = setInterval(() => {
      void checkForUpdates(false)
    }, PERIOD_MS)
    periodTimer.unref?.()
    return
  }

  // Manual: optional quiet check for latest.json only (never downloads the DMG).
  if (resolvedManualConfig().latestJsonUrl) {
    setTimeout(() => {
      void checkForUpdates(false)
    }, STARTUP_DELAY_MS)
  }
}

export function stopUpdater(): void {
  if (periodTimer) clearInterval(periodTimer)
  periodTimer = null
}

async function checkManual(manualClick: boolean): Promise<UpdateStatus> {
  const cfg = resolvedManualConfig()
  if (!cfg.latestJsonUrl && !cfg.downloadUrl) {
    setStatus({
      phase: 'disabled',
      message: 'No shared release link configured. Ask the owner for a Download latest URL.',
      lastCheckedAt: Date.now(),
      downloadUrl: null
    })
    return getUpdateStatus()
  }

  if (!cfg.latestJsonUrl) {
    setStatus({
      phase: 'available',
      availableVersion: null,
      downloadUrl: cfg.downloadUrl,
      lastCheckedAt: Date.now(),
      message: replaceAppReminder(process.platform)
    })
    return getUpdateStatus()
  }

  if (manualClick) setStatus({ phase: 'checking', message: 'Checking for updates…' })
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 15_000)
    const res = await fetch(cfg.latestJsonUrl, { signal: controller.signal })
    clearTimeout(timer)
    if (!res.ok) {
      setStatus({
        phase: 'error',
        message: `Could not read latest.json (HTTP ${res.status}).`,
        lastCheckedAt: Date.now(),
        downloadUrl: cfg.downloadUrl || null
      })
      return getUpdateStatus()
    }
    const manifest = parseLatestManifest(await res.json())
    if (!manifest) {
      setStatus({
        phase: 'error',
        message: 'latest.json is missing version or downloadUrl.',
        lastCheckedAt: Date.now()
      })
      return getUpdateStatus()
    }
    const downloadUrl = manifest.downloadUrl || cfg.downloadUrl
    if (!isNewerVersion(manifest.version, app.getVersion())) {
      setStatus({
        phase: 'not-available',
        availableVersion: null,
        downloadUrl,
        lastCheckedAt: Date.now(),
        message: 'You’re on the latest beta build.'
      })
      return getUpdateStatus()
    }
    if (status.silencedVersion === manifest.version && !manualClick) {
      setStatus({
        phase: 'available',
        availableVersion: manifest.version,
        downloadUrl,
        lastCheckedAt: Date.now(),
        message: `Update ${manifest.version} available (reminder muted). Download from Preferences when ready.`
      })
      return getUpdateStatus()
    }
    setStatus({
      phase: 'available',
      availableVersion: manifest.version,
      downloadUrl,
      lastCheckedAt: Date.now(),
      message: `Update available — ${manifest.version}. Use Download latest version (automatic install is off for unsigned builds).`
    })
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    const offline = /ENOTFOUND|ECONNREFUSED|ETIMEDOUT|abort|network|offline/i.test(msg)
    setStatus({
      phase: offline ? 'offline' : 'error',
      message: offline ? 'Update check skipped (offline or unreachable).' : msg.slice(0, 240),
      lastCheckedAt: Date.now(),
      downloadUrl: cfg.downloadUrl || null
    })
  }
  return getUpdateStatus()
}

export async function checkForUpdates(manual: boolean): Promise<UpdateStatus> {
  if (!app.isPackaged) {
    setStatus({
      phase: 'disabled',
      message: 'Updates run in packaged builds only.',
      lastCheckedAt: Date.now()
    })
    return getUpdateStatus()
  }
  if (mode === 'manual') return checkManual(manual)

  if (!resolvedFeedUrl()) {
    setStatus({
      phase: 'disabled',
      message: 'No update feed configured.',
      lastCheckedAt: Date.now()
    })
    return getUpdateStatus()
  }
  try {
    if (manual) setStatus({ phase: 'checking', message: 'Checking for updates…' })
    await autoUpdater.checkForUpdates()
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    const offline = /ENOTFOUND|ECONNREFUSED|ETIMEDOUT|net::|offline|network/i.test(msg)
    setStatus({
      phase: offline ? 'offline' : 'error',
      message: offline ? 'Update check skipped (offline or unreachable).' : msg.slice(0, 240),
      lastCheckedAt: Date.now()
    })
  }
  return getUpdateStatus()
}

export function silenceCurrentUpdate(): UpdateStatus {
  if (status.availableVersion) {
    saveSilenced(status.availableVersion)
    setStatus({
      silencedVersion: status.availableVersion,
      message: `Reminder muted for ${status.availableVersion}.`
    })
  }
  return getUpdateStatus()
}

/** Open the shared DMG/folder link. Does not install. Saves draft for after replace. */
export async function openManualDownload(draftText = ''): Promise<{ ok: boolean; reason: string }> {
  const url = (status.downloadUrl || resolvedManualConfig().downloadUrl || '').trim()
  if (!url) {
    return { ok: false, reason: 'No download link configured. Ask the owner for a shared release URL.' }
  }
  prepareForUpdateRestart({
    fromVersion: app.getVersion(),
    toVersion: status.availableVersion,
    draftText: draftText || draftProvider?.() || ''
  })
  try {
    writeFileSync(
      pendingManualPath(),
      JSON.stringify(
        {
          fromVersion: app.getVersion(),
          toVersion: status.availableVersion,
          at: Date.now()
        },
        null,
        2
      ),
      { mode: 0o600 }
    )
  } catch {
    // Non-fatal.
  }
  try {
    await shell.openExternal(url)
    setStatus({
      phase: 'download-opened',
      downloadUrl: url,
      message: downloadOpenedMessage(process.platform)
    })
    return { ok: true, reason: status.message }
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : 'Could not open the download link.'
    }
  }
}

export async function restartToUpdate(draftText = ''): Promise<{ ok: boolean; reason: string }> {
  if (mode === 'manual' || unsigned) {
    return {
      ok: false,
      reason: restartBlockedReason(process.platform)
    }
  }
  if (status.phase !== 'ready') {
    return { ok: false, reason: 'No update is ready to install.' }
  }
  prepareForUpdateRestart({
    fromVersion: app.getVersion(),
    toVersion: status.availableVersion,
    draftText: draftText || draftProvider?.() || ''
  })
  try {
    autoUpdater.quitAndInstall(false, true)
    return { ok: true, reason: 'Restarting to install the update…' }
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : 'Could not restart to install.'
    }
  }
}
