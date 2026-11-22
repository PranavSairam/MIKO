/**
 * GPT Mode delivery: open ChatGPT, insert exact text, submit once when opted in.
 * Cancellation bumps generation so remaining insert/submit steps abort.
 * Never retries Return after an uncertain submit (could double-send).
 * Native submit is never claimed verified — composer clear ≠ proof.
 */

import { spawnSync } from 'node:child_process'
import { desktopCapturer, screen, systemPreferences } from 'electron'
import {
  type GptCaptureSource,
  type GptDeliveryStatus,
  type GptLiveKind,
  type GptLiveSnapshot,
  type GptModeState,
  type GptSendResult,
  emptyGptModeState,
  isExcludedCaptureOwner,
  isForeignLiveSource,
  phaseAfterLoad
} from '../shared/gpt-mode'
import { isChatGptBundle } from '../shared/destination'
import { runAx } from './ax'
import { openChatGpt } from './chatgpt'
import { chatgptNewChat } from './type-dest'
import { gptModeOptedIn, setGptModeOptedIn } from './settings'

let generation = 0
let state: GptModeState = emptyGptModeState()
let listeners: Array<(s: GptModeState) => void> = []

function emit(): void {
  const snap = { ...state }
  for (const listener of listeners) listener(snap)
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

export function onGptModeState(listener: (s: GptModeState) => void): () => void {
  listeners.push(listener)
  listener({ ...state })
  return () => {
    listeners = listeners.filter((l) => l !== listener)
  }
}

export function getGptModeState(): GptModeState {
  return { ...state }
}

export function loadGptModeFromSettings(): GptModeState {
  const optedIn = gptModeOptedIn()
  state = {
    ...emptyGptModeState(),
    optedIn,
    phase: phaseAfterLoad(optedIn),
    lastDetail: optedIn ? 'Paused after relaunch — resume when ready.' : ''
  }
  emit()
  return getGptModeState()
}

export function cancelGptDelivery(): void {
  generation += 1
  if (state.lastRequestId && (state.lastStatus === 'preparing' || state.lastStatus === 'text-inserted')) {
    state = {
      ...state,
      lastStatus: 'cancelled',
      lastDetail: 'Cancelled. If ChatGPT already sent the prompt, MIKO can’t recall it.'
    }
    emit()
  }
}

async function ensureChatGptFront(excludePid: number): Promise<{ ok: boolean; reason: string; pid: number; bundle: string; app: string }> {
  const opened = await openChatGpt()
  if (!opened.ok) {
    return { ok: false, reason: 'ChatGPT didn’t open.', pid: 0, bundle: '', app: '' }
  }
  if (opened.target !== 'app') {
    return {
      ok: false,
      reason:
        'ChatGPT desktop app isn’t available. Use chatgpt.com in a browser — native GPT Mode insert/submit needs the app. Submission cannot be fully verified either way.',
      pid: 0,
      bundle: '',
      app: opened.appName
    }
  }
  let info = await runAx(['focus-info'])
  for (let i = 0; i < 10 && !isChatGptBundle(info.bundle); i += 1) {
    await sleep(250)
    info = await runAx(['focus-info'])
  }
  if (!isChatGptBundle(info.bundle) || info.pid === excludePid) {
    return {
      ok: false,
      reason: info.app ? `${info.app} is in front, not ChatGPT.` : 'ChatGPT didn’t come to the front.',
      pid: info.pid || 0,
      bundle: info.bundle || '',
      app: info.app || ''
    }
  }
  return { ok: true, reason: '', pid: info.pid, bundle: info.bundle, app: info.app }
}

async function insertText(text: string, excludePid: number, mode: 'replace' | 'append' | 'ask'): Promise<{
  status: GptDeliveryStatus
  detail: string
  inserted: boolean
}> {
  const front = await ensureChatGptFront(excludePid)
  if (!front.ok) return { status: 'failed', detail: front.reason, inserted: false }

  const info = await runAx(['focus-info'])
  if (mode === 'ask' && info.ok && info.editable && info.valueLength > 0) {
    return {
      status: 'choose-insert',
      detail: 'Composer already has text. Choose Replace, Append, or Cancel.',
      inserted: false
    }
  }

  if (info.ok && info.editable && info.pid) {
    const insertMode = mode === 'append' ? 'append' : 'replace'
    const result = await runAx(
      ['insert', '--pid', String(info.pid), '--sig', info.sig, '--mode', insertMode],
      text,
      12000
    )
    if (result.ok && result.verified) {
      return { status: 'text-inserted', detail: 'Text inserted into ChatGPT.', inserted: true }
    }
  }

  const pasted = await runAx(
    [
      'paste',
      '--exclude-pid',
      String(excludePid),
      '--allow-unexposed',
      '--expect-bundles',
      'com.openai.chat,com.openai.codex',
      '--settle-ms',
      '400'
    ],
    text,
    10000
  )
  if (pasted.ok) {
    return { status: 'text-inserted', detail: 'Text pasted into ChatGPT (AX unverified).', inserted: true }
  }
  return {
    status: 'failed',
    detail: pasted.reason || 'Couldn’t insert into ChatGPT.',
    inserted: false
  }
}

/**
 * Press Return once. Always delivery-unverified for ChatGPT desktop —
 * composer clearing alone does not prove submission; never retry Return.
 */
async function submitOnce(excludePid: number): Promise<{ status: GptDeliveryStatus; detail: string }> {
  const front = await ensureChatGptFront(excludePid)
  if (!front.ok) return { status: 'failed', detail: front.reason }

  const keyed = await runAx(
    [
      'keystroke',
      '--key',
      'return',
      '--allow-submit',
      '--exclude-pid',
      String(excludePid),
      '--expect-bundles',
      'com.openai.chat,com.openai.codex'
    ],
    undefined,
    8000
  )
  if (!keyed.ok) {
    return {
      status: 'failed',
      detail: keyed.reason || 'Submit keystroke didn’t run. Text may still be in the composer.'
    }
  }

  return {
    status: 'delivery-unverified',
    detail:
      'Return was sent while ChatGPT was frontmost. Native submission can’t be verified (composer isn’t reliably exposed) — check ChatGPT. I won’t press Return again for this message.'
  }
}

export async function enableGptMode(excludePid: number): Promise<GptModeState> {
  setGptModeOptedIn(true)
  const front = await ensureChatGptFront(excludePid)
  state = {
    ...state,
    optedIn: true,
    phase: front.ok ? 'active' : 'paused',
    lastStatus: null,
    lastDetail: front.ok
      ? 'Connected. Messages insert + attempt submit in ChatGPT (submission not fully verifiable).'
      : front.reason || 'ChatGPT didn’t open — paused.',
    lastRequestId: null
  }
  emit()
  return getGptModeState()
}

export function pauseGptMode(): GptModeState {
  if (state.phase === 'off' && !state.optedIn) return getGptModeState()
  cancelGptDelivery()
  state = {
    ...state,
    optedIn: true,
    phase: 'paused',
    lastDetail: 'Paused. Messages stay in MIKO until you resume.'
  }
  setGptModeOptedIn(true)
  emit()
  return getGptModeState()
}

export function resumeGptMode(): GptModeState {
  if (!state.optedIn && state.phase === 'off') return getGptModeState()
  state = {
    ...state,
    optedIn: true,
    phase: 'active',
    lastDetail: 'Connected.'
  }
  setGptModeOptedIn(true)
  emit()
  return getGptModeState()
}

export function exitGptMode(): GptModeState {
  cancelGptDelivery()
  setGptModeOptedIn(false)
  state = {
    ...emptyGptModeState(),
    lastDetail: 'Exited GPT Mode.'
  }
  emit()
  return getGptModeState()
}

export async function gptModeNewChat(excludePid: number): Promise<{ ok: boolean; verified: boolean; reason: string }> {
  if (state.phase === 'off') return { ok: false, verified: false, reason: 'Turn on GPT Mode first.' }
  const gen = ++generation
  const front = await ensureChatGptFront(excludePid)
  if (!front.ok) {
    state = { ...state, lastDetail: front.reason }
    emit()
    return { ok: false, verified: false, reason: front.reason }
  }
  if (gen !== generation) return { ok: false, verified: false, reason: 'Cancelled.' }
  const created = await chatgptNewChat()
  if (gen !== generation) return { ok: false, verified: false, reason: 'Cancelled.' }
  if (!created.ok || !created.verified) {
    const softOk = created.ok && /new chat|⌘N|started/i.test(created.reason)
    state = {
      ...state,
      lastDetail: softOk
        ? 'New chat started (unverified). Confirm in ChatGPT before the next message.'
        : created.reason || 'New chat failed — nothing was sent into the previous conversation.'
    }
    emit()
    return { ok: softOk, verified: created.verified, reason: state.lastDetail }
  }
  state = { ...state, lastDetail: 'New chat ready.' }
  emit()
  return { ok: true, verified: true, reason: 'New chat ready.' }
}

export async function sendGptModeMessage(
  request: { requestId: string; text: string; mode?: 'replace' | 'append' | 'ask' },
  excludePid: number
): Promise<GptSendResult> {
  const gen = ++generation
  const text = request.text.trim().slice(0, 8000)
  const requestId = request.requestId.slice(0, 80)
  const finish = (status: GptDeliveryStatus, detail: string, inserted: boolean): GptSendResult => {
    state = { ...state, lastStatus: status, lastDetail: detail, lastRequestId: requestId }
    emit()
    return { requestId, status, detail, submittedVerified: false, inserted }
  }

  if (!text) return finish('failed', 'Nothing to send.', false)
  if (state.phase !== 'active') {
    return finish('failed', state.phase === 'paused' ? 'GPT Mode is paused.' : 'GPT Mode is off.', false)
  }

  state = { ...state, lastStatus: 'preparing', lastDetail: 'Preparing…', lastRequestId: requestId }
  emit()

  if (gen !== generation) return finish('cancelled', 'Cancelled.', false)

  const mode = request.mode ?? 'ask'
  const inserted = await insertText(text, excludePid, mode)
  if (gen !== generation) {
    return finish('cancelled', 'Cancelled before submit. Already-submitted prompts can’t be recalled.', inserted.inserted)
  }
  if (inserted.status === 'choose-insert') return finish('choose-insert', inserted.detail, false)
  if (inserted.status === 'failed' || !inserted.inserted) return finish('failed', inserted.detail, false)

  state = { ...state, lastStatus: 'text-inserted', lastDetail: inserted.detail, lastRequestId: requestId }
  emit()

  if (gen !== generation) {
    return finish('cancelled', 'Cancelled after insert — text may still be in the composer.', true)
  }

  const submitted = await submitOnce(excludePid)
  if (gen !== generation) {
    // Return may already have fired — still leave a terminal, honest status.
    return finish(
      'delivery-unverified',
      'Cancel requested after submit may have fired. Check ChatGPT — MIKO can’t recall a submitted prompt.',
      true
    )
  }
  return finish(submitted.status, submitted.detail, true)
}

export async function focusChatGptWindow(): Promise<{ ok: boolean; reason: string }> {
  const opened = await openChatGpt()
  if (!opened.ok) return { ok: false, reason: 'ChatGPT didn’t open.' }
  return { ok: true, reason: opened.target === 'app' ? 'ChatGPT is frontmost.' : `Opened in ${opened.appName || 'the browser'}.` }
}

/** Titles of windows owned by the ChatGPT.app process (not helper “Codex” tools). */
function chatGptProcessWindowTitles(): Set<string> {
  if (process.platform !== 'darwin') return new Set()
  const result = spawnSync(
    '/usr/bin/osascript',
    [
      '-e',
      'tell application "System Events"',
      '-e',
      'if not (exists process "ChatGPT") then return ""',
      '-e',
      'set out to ""',
      '-e',
      'repeat with w in windows of process "ChatGPT"',
      '-e',
      'try',
      '-e',
      'set out to out & (name of w as text) & linefeed',
      '-e',
      'end try',
      '-e',
      'end repeat',
      '-e',
      'return out',
      '-e',
      'end tell'
    ],
    { encoding: 'utf8', timeout: 5000, shell: false }
  )
  const titles = new Set<string>()
  for (const line of (result.stdout || '').split('\n')) {
    const t = line.trim()
    if (t) titles.add(t)
  }
  return titles
}

/** Best-effort owner label for a capture source using System Events + title match. */
function ownerForSource(name: string, chatTitles: Set<string>): { owner: string; recommended: boolean } {
  if (chatTitles.has(name) || (name && [...chatTitles].some((t) => t === name || name.includes(t) || t.includes(name)))) {
    return { owner: 'ChatGPT', recommended: true }
  }
  // ChatGPT.app often exposes the chat title only — still recommend empty/"New chat" when ChatGPT is the only chat app running.
  if (/^new chat$/i.test(name) && chatTitles.size > 0) return { owner: 'ChatGPT', recommended: true }
  return { owner: '', recommended: false }
}

function screenPermission(): string {
  if (process.platform !== 'darwin') return 'unknown'
  return systemPreferences.getMediaAccessStatus('screen')
}

/** Absolute .app bundle path for this MIKO Electron host (dev preview). */
function captureHostAppPath(): string {
  const exe = process.execPath || ''
  const marker = '/Contents/MacOS/'
  const i = exe.indexOf(marker)
  return i > 0 ? exe.slice(0, i) : exe
}

export async function listGptCaptureSources(): Promise<{
  ok: boolean
  reason: string
  permission: string
  sources: GptCaptureSource[]
}> {
  const permissionBefore = screenPermission()
  if (process.platform !== 'darwin') {
    return {
      ok: false,
      reason: 'Live view isn’t available on this platform.',
      permission: permissionBefore,
      sources: []
    }
  }
  // Always call getSources to recheck — status alone can stay stale after a fresh grant.
  try {
    const chatTitles = chatGptProcessWindowTitles()
    const capturer = await desktopCapturer.getSources({
      types: ['window'],
      thumbnailSize: { width: 240, height: 150 },
      fetchWindowIcons: false
    })
    const permission = screenPermission()
    const windowSources = capturer.filter((s) => s.id.startsWith('window:'))
    if (permission === 'denied' && windowSources.length === 0) {
      const host = captureHostAppPath()
      return {
        ok: false,
        reason: `Screen Recording is denied for this running host:\n${host}\nEnable that exact Electron.app (com.github.Electron), then fully quit and relaunch MIKO.`,
        permission: 'denied',
        sources: []
      }
    }
    const sources: GptCaptureSource[] = []
    for (const src of capturer) {
      if (!src.id.startsWith('window:')) continue
      const name = (src.name || '').slice(0, 120)
      if (isExcludedCaptureOwner(name, name)) continue
      if (/^cursor$|^miko$|electron/i.test(name)) continue
      const { owner, recommended } = ownerForSource(name, chatTitles)
      // Never auto-recommend unknown IDE / helper windows.
      if (!recommended && isExcludedCaptureOwner(owner || name, name)) continue
      const previewUrl = src.thumbnail.isEmpty() ? '' : src.thumbnail.toDataURL()
      sources.push({
        id: src.id,
        name: name || src.id,
        owner: owner || (recommended ? 'ChatGPT' : 'Other app'),
        pid: 0,
        previewUrl,
        recommended
      })
    }
    sources.sort((a, b) => Number(b.recommended) - Number(a.recommended) || a.name.localeCompare(b.name))
    const recommended = sources.filter((s) => s.recommended)
    // Prefer post-capture status; if windows appeared while status still said denied, treat as usable.
    const reportedPermission =
      permission === 'denied' && windowSources.length > 0 ? 'granted' : permission
    if (chatTitles.size > 0 && recommended.length === 0) {
      // ChatGPT.app is open (System Events sees its windows) but desktopCapturer has no match —
      // common when Screen Recording isn’t granted to this Electron host, or the window isn’t shareable.
      return {
        ok: false,
        reason:
          reportedPermission === 'granted'
            ? `ChatGPT is open (“${[...chatTitles][0]}”) but Screen Recording can’t capture its window from this MIKO process. Use View in ChatGPT, or Choose window if another shareable window appears.`
            : `Grant Screen Recording to ${captureHostAppPath()}, open ChatGPT, then Choose window.`,
        permission: reportedPermission,
        sources
      }
    }
    if (!sources.length) {
      return {
        ok: false,
        reason:
          reportedPermission === 'granted'
            ? 'No suitable windows found. Open ChatGPT, then Choose window.'
            : `Grant Screen Recording to ${captureHostAppPath()}, open ChatGPT, then Choose window.`,
        permission: reportedPermission,
        sources: []
      }
    }
    return {
      ok: true,
      reason: recommended.length ? '' : 'Select the ChatGPT window — don’t pick Cursor, Notes, or the desktop.',
      permission: reportedPermission,
      sources
    }
  } catch (err) {
    const permission = screenPermission()
    const detail =
      err instanceof Error
        ? err.message || err.name || 'unknown Error'
        : typeof err === 'string'
          ? err
          : JSON.stringify(err)
    const host = captureHostAppPath()
    return {
      ok: false,
      reason:
        permission === 'denied'
          ? `Screen Recording still denied for running host:\n${host}\n(desktopCapturer: ${detail})`
          : `Couldn’t list windows (${detail}). Host: ${host}`,
      permission,
      sources: []
    }
  }
}

export function setGptCaptureSource(sourceId: string, name = '', owner = ''): GptModeState {
  const id = sourceId.slice(0, 120)
  const nextName = name.slice(0, 120)
  const nextOwner = owner.slice(0, 80)
  if (isExcludedCaptureOwner(nextOwner, nextName) || /^(cursor|miko|electron)$/i.test(nextName)) {
    state = {
      ...state,
      captureSourceId: null,
      captureSourceName: '',
      captureOwner: '',
      liveView: true,
      liveKind: 'source-unavailable',
      liveViewDetail: 'Won’t capture that window. Choose the ChatGPT app window.'
    }
    emit()
    return getGptModeState()
  }
  state = {
    ...state,
    captureSourceId: id || null,
    captureSourceName: nextName,
    captureOwner: nextOwner,
    liveView: true,
    // Clear any prior “ok” so an old WhatsApp/etc frame can’t look live.
    liveKind: id ? 'source-unavailable' : 'source-unavailable',
    liveViewDetail: nextOwner || nextName ? `Selected: ${nextOwner || nextName}${nextName && nextOwner ? ` · ${nextName}` : ''}` : 'Window selected.'
  }
  emit()
  return getGptModeState()
}

function captureThumbnailSize(): { width: number; height: number } {
  try {
    const display = screen.getPrimaryDisplay()
    const scale = Math.max(1, display.scaleFactor || 1)
    // Retina-capable capture — not a 280px pet thumbnail.
    const width = Math.min(Math.round((display.size.width || 1440) * scale), 2880)
    const height = Math.min(Math.round((display.size.height || 900) * scale), 1800)
    return { width: Math.max(1280, width), height: Math.max(800, height) }
  } catch {
    return { width: 1800, height: 1200 }
  }
}

export async function gptLiveViewSnapshot(): Promise<GptLiveSnapshot> {
  const permission = screenPermission()
  const clearBinding = (): void => {
    state = {
      ...state,
      captureSourceId: null,
      captureSourceName: '',
      captureOwner: ''
    }
  }
  const fail = (kind: GptLiveKind, reason: string, clear = false): GptLiveSnapshot => {
    if (clear) clearBinding()
    state = { ...state, liveKind: kind, liveViewDetail: reason }
    emit()
    return {
      ok: false,
      reason,
      dataUrl: '',
      sourceName: state.captureSourceName,
      sourceId: state.captureSourceId || '',
      owner: state.captureOwner,
      permission,
      kind,
      captureWidth: 0,
      captureHeight: 0
    }
  }

  if (process.platform !== 'darwin') return fail('capture-failed', 'Live view isn’t available on this platform.')

  try {
    const capturer = await desktopCapturer.getSources({
      types: ['window'],
      thumbnailSize: captureThumbnailSize(),
      fetchWindowIcons: false
    })
    const permissionNow = screenPermission()
    if (permissionNow === 'denied' && !capturer.some((s) => s.id.startsWith('window:'))) {
      return fail('need-permission', `Screen Recording is denied for ${captureHostAppPath()}.`, true)
    }

    const boundId = state.captureSourceId
    if (!boundId) {
      return fail('source-unavailable', 'Choose which window to preview. ChatGPT isn’t bound yet.')
    }

    // Exact ID only — never substitute WhatsApp / another window / the desktop.
    const hit = capturer.find((s) => s.id === boundId)
    if (!hit) {
      return fail(
        'source-closed',
        `Source closed or changed (“${state.captureSourceName || boundId}”). Choose the window again.`,
        true
      )
    }

    const hitName = (hit.name || '').slice(0, 120)
    if (isExcludedCaptureOwner(hitName, hitName) || /^(cursor|miko)$/i.test(hitName)) {
      return fail('source-unavailable', 'Won’t capture that window. Choose the ChatGPT app window.', true)
    }

    const chatTitles = chatGptProcessWindowTitles()
    const { owner, recommended } = ownerForSource(hitName, chatTitles)
    const expectedChatGpt =
      isChatGptBound(state.captureOwner, state.captureSourceName) || recommended
    const foreign = isForeignLiveSource(owner || hitName, hitName)

    // Bound as ChatGPT (or recommended) but the window at this ID is clearly another app.
    if (expectedChatGpt && foreign && !recommended) {
      return fail(
        'source-unavailable',
        `“${hitName}” is not ChatGPT (looks like ${owner || hitName}). Cleared — choose the ChatGPT window.`,
        true
      )
    }

    const size = hit.thumbnail.getSize()
    const dataUrl = hit.thumbnail.isEmpty() ? '' : hit.thumbnail.toDataURL()
    if (!dataUrl) {
      return fail(
        permissionNow === 'granted' ? 'capture-failed' : 'need-permission',
        permissionNow === 'granted'
          ? `“${hitName}” thumbnail empty (minimized or unavailable).`
          : 'Screen Recording permission needed.'
      )
    }

    const displayOwner = owner || state.captureOwner || (recommended ? 'ChatGPT' : 'Other app')
    state = {
      ...state,
      liveKind: 'ok',
      liveViewDetail: '',
      captureSourceId: hit.id,
      captureSourceName: hitName || state.captureSourceName,
      captureOwner: displayOwner.slice(0, 80)
    }
    emit()
    return {
      ok: true,
      reason: 'Mirror only · viewer zoom/pan ≠ scrolling ChatGPT · Open ChatGPT to interact',
      dataUrl,
      sourceName: state.captureSourceName,
      sourceId: hit.id,
      owner: state.captureOwner,
      permission: permissionNow,
      kind: 'ok',
      captureWidth: size.width || 0,
      captureHeight: size.height || 0
    }
  } catch (err) {
    return fail(
      'capture-failed',
      `Capture failed (${err instanceof Error ? err.message || err.name : 'error'}).`,
      false
    )
  }
}

function isChatGptBound(owner: string, name: string): boolean {
  if (/^chatgpt$/i.test(owner.trim())) return true
  if (/chatgpt/i.test(owner) && !isForeignLiveSource(owner, name)) return true
  return false
}

export function setGptLiveView(enabled: boolean, detail = ''): GptModeState {
  state = {
    ...state,
    liveView: enabled,
    liveKind: enabled
      ? state.captureSourceId
        ? state.liveKind === 'off'
          ? 'source-unavailable'
          : state.liveKind
        : 'source-unavailable'
      : 'off',
    liveViewDetail: detail || (enabled ? 'Live view on.' : ''),
    // Closing the viewer must not clear the bound source, but must stop looking “live”.
    ...(enabled ? {} : {})
  }
  emit()
  return getGptModeState()
}

export function clearGptCaptureSource(): GptModeState {
  state = {
    ...state,
    captureSourceId: null,
    captureSourceName: '',
    captureOwner: '',
    liveKind: state.liveView ? 'source-unavailable' : state.liveKind,
    liveViewDetail: state.liveView ? 'Choose which window to preview.' : state.liveViewDetail
  }
  emit()
  return getGptModeState()
}
