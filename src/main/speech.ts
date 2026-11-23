import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { shell } from 'electron'
import { IPC } from '../shared/api'
import {
  emptyMicTestStatus,
  type MicTestStatus,
  type PermissionState,
  type VoicePermissionStatus
} from '../shared/setup'
import {
  parseWinSpeechLine,
  speechHelpUrl,
  winSpeechProblem,
  type SpeechHelp,
  type WinSpeechError,
  type WinSpeechLine
} from '../shared/win-speech'
import {
  MicSessionLog,
  micSessionLine,
  micTestPhaseText,
  type MicMode,
  type MicOutcome,
  type MicSource,
  type MicTestPhase
} from '../shared/mic-session'
import { logDiag } from './diagnostics'
import { compileHelper, launchHelper, sourcePath, type HelperSpec } from './helper-app'
import { postToPet, restorePetPointerState } from './pet-window'

/**
 * Recognition is on-device. The browser SpeechRecognition API in this Electron
 * build posts audio to https://www.google.com/speech-api and is not used.
 * macOS uses SFSpeechRecognizer with requiresOnDeviceRecognition, in the
 * "MIKO Listen" helper app (see helper-app.ts for why it is launched through
 * LaunchServices). Stop is SIGUSR1, cancel is SIGTERM.
 * Windows uses the local System.Speech dictation engine (resources/listen-win.ps1).
 * On Windows MIKO says "Listening" only after the helper reports that recognition
 * really started; failures carry a plain reason and the settings page that fixes them.
 * Read-aloud uses the renderer's local speechSynthesis voices.
 */

/**
 * One capture at a time. `cancel` ends this session exactly once (helper stopped,
 * microphone released, panel told); later callbacks from its helper are logged as stale.
 */
interface Session {
  kind: 'listen' | 'test'
  id: number
  stop: () => void
  cancel: () => void
}

type StartResult = { ok: boolean; reason: string; help?: SpeechHelp }

const LISTEN_MS = 12000
/** Windows: the helper must report {"ready":true} within this time or the start fails. */
const WIN_READY_MS = 8000
/** Hold-to-talk (Caps Lock + A). The helper caps itself at 55 s. */
const HOLD_MS = 60000

const LISTEN_HELPER: HelperSpec = {
  source: 'listen-mac.swift',
  name: 'miko-listen',
  displayName: 'MIKO Listen',
  bundleId: 'com.miko.listen',
  frameworks: ['Speech', 'AVFoundation'],
  plistExtra:
    '<key>NSMicrophoneUsageDescription</key><string>MIKO uses the microphone for push-to-talk. Audio stays on this Mac and is not saved.</string>\n' +
    '<key>NSSpeechRecognitionUsageDescription</key><string>MIKO turns speech into text on this Mac. Recognition stays on the device and is not saved.</string>'
}

let session: Session | null = null
/** Windows: a start that is still waiting for the helper's ready line. Repeated starts join it. */
let starting: Promise<StartResult> | null = null
let killTimer: NodeJS.Timeout | null = null
/** Increments per listening session; sent with every speech event so a recording is handled once. */
let sessionCount = 0
const micLog = new MicSessionLog()
/** Last default input device Windows reported (attached to new sessions for diagnostics). */
let lastDefaultDevice = ''

/** Session diagnostics: ids, steps and timings only. Never audio, never the words. */
function diag(id: number, event: string, extra?: Record<string, unknown>): void {
  logDiag('mic', `#${id} ${event}`, extra)
}

function closeLine(id: number): string {
  const record = micLog.get(id)
  return record ? micSessionLine(record) : ''
}

/** Recent capture sessions as transcript-free lines (Help & Setup, feedback diagnostics). */
export function recentMicSessions(): string[] {
  return micLog.recent().map(micSessionLine)
}

function testPhase(phase: MicTestPhase, detail?: string): void {
  postToPet(IPC.voiceMicTestPhase, { phase, detail: detail ?? micTestPhaseText(phase, process.platform) })
}

function outcomeFor(code: WinSpeechError): MicOutcome {
  return code
}

export function listeningDetail(hold = false): string {
  if (hold && process.platform === 'win32') return 'Listening… let go of Shift + A to stop.'
  if (hold) return 'Listening… let go of Caps Lock + A to stop.'
  return process.platform === 'win32'
    ? 'Listening. Recognition stays on this PC and is not saved.'
    : 'Listening on this Mac. Recognition stays on the device and is not saved.'
}

export function isListening(): boolean {
  return session !== null
}

function permissionState(value: unknown): PermissionState {
  return value === 'not-determined' ||
    value === 'authorized' ||
    value === 'denied' ||
    value === 'restricted' ||
    value === 'unavailable'
    ? value
    : 'unknown'
}

/** Status belongs to the native speech helper, not Electron's browser permission. */
export async function voicePermissionStatus(request = false): Promise<VoicePermissionStatus> {
  if (process.platform === 'win32') {
    if (request) {
      const test = await runMicTest()
      const authorized = test.outcome === 'transcript-confirmed'
      const denied = test.outcome === 'denied'
      const unavailable = test.outcome === 'unavailable'
      return {
        supported: !unavailable,
        microphone: authorized ? 'authorized' : denied ? 'denied' : unavailable ? 'unavailable' : 'not-determined',
        speechRecognition: authorized ? 'authorized' : denied ? 'denied' : unavailable ? 'unavailable' : 'not-determined',
        canRequest: !authorized,
        detail: test.detail
      }
    }
    return {
      supported: true,
      microphone: 'not-determined',
      speechRecognition: 'not-determined',
      canRequest: true,
      detail: 'Use Try microphone to check Windows microphone and System.Speech access. Status comes from the native helper, not the browser.'
    }
  }
  if (process.platform !== 'darwin') {
    return {
      supported: false,
      microphone: 'unavailable',
      speechRecognition: 'unavailable',
      canRequest: false,
      detail: 'Voice input is not available on this platform.'
    }
  }
  const helper = compileHelper(LISTEN_HELPER)
  if (!helper) {
    return {
      supported: false,
      microphone: 'unavailable',
      speechRecognition: 'unavailable',
      canRequest: false,
      detail: 'The on-device speech helper is unavailable.'
    }
  }
  return new Promise((resolve) => {
    let settled = false
    const finish = (value: VoicePermissionStatus): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(value)
    }
    const timer = setTimeout(
      () =>
        finish({
          supported: true,
          microphone: 'unknown',
          speechRecognition: 'unknown',
          canRequest: true,
          detail: 'MIKO could not read voice permission status. Try again or open Settings.'
        }),
      7000
    )
    const handle = launchHelper(
      helper.root,
      [request ? '--request-permissions' : '--permission-status'],
      (line) => {
        try {
          const parsed = JSON.parse(line) as Record<string, unknown>
          if (parsed.permissionStatus !== true) return
          const microphone = permissionState(parsed.microphone)
          const speechRecognition = permissionState(parsed.speechRecognition)
          finish({
            supported: true,
            microphone,
            speechRecognition,
            canRequest: microphone === 'not-determined' || speechRecognition === 'not-determined',
            detail:
              microphone === 'authorized' && speechRecognition === 'authorized'
                ? 'Microphone and on-device speech recognition are allowed.'
                : microphone === 'denied' || speechRecognition === 'denied'
                  ? 'Voice access is denied. Open System Settings to change it.'
                  : 'Voice permissions have not been fully granted yet.'
          })
        } catch {
          // Ignore non-status output.
        }
      },
      () => undefined
    )
    if (!handle) {
      finish({
        supported: false,
        microphone: 'unavailable',
        speechRecognition: 'unavailable',
        canRequest: false,
        detail: 'The on-device speech helper could not start.'
      })
    }
  })
}

export async function openVoicePrivacySettings(help?: SpeechHelp): Promise<boolean> {
  const url =
    process.platform === 'win32'
      ? speechHelpUrl(help ?? 'microphone-privacy') || 'ms-settings:privacy-microphone'
      : process.platform === 'darwin'
        ? 'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone'
        : ''
  if (!url) return false
  try {
    await shell.openExternal(url)
    return true
  } catch {
    return false
  }
}

/**
 * Explicit microphone check via the platform speech helper. Shows its own progress
 * (starting → listening → hearing → done) and never runs the words as a command.
 * Does not use browser getUserMedia; never claims Electron host permission.
 */
export async function runMicTest(): Promise<MicTestStatus> {
  if (session || starting) {
    return emptyMicTestStatus({
      outcome: 'unavailable',
      detail:
        session?.kind === 'test'
          ? 'A microphone test is already running.'
          : 'MIKO is already listening. Stop that first, then try again.'
    })
  }
  testPhase('starting')
  if (process.platform === 'win32') return runWindowsMicTest()
  if (process.platform === 'darwin') {
    const status = await voicePermissionStatus(true)
    if (status.microphone === 'denied' || status.speechRecognition === 'denied') {
      testPhase('error', status.detail)
      return emptyMicTestStatus({
        outcome: 'denied',
        detail: status.detail || 'Voice access is denied. Open System Settings to change it.'
      })
    }
    if (!status.supported || status.microphone === 'unavailable') {
      testPhase('error', status.detail)
      return emptyMicTestStatus({
        outcome: 'unavailable',
        detail: status.detail || 'On-device speech recognition is unavailable.'
      })
    }
    return runMacMicTest()
  }
  testPhase('error', 'Voice input is not available on this platform.')
  return emptyMicTestStatus({
    outcome: 'unavailable',
    detail: 'Voice input is not available on this platform.'
  })
}

/** Cancel a running microphone test (Cancel button, closing the card). */
export function cancelMicTest(): void {
  if (session?.kind === 'test') session.cancel()
}

export async function startListening(hold = false, source: MicSource = 'unknown'): Promise<StartResult> {
  if (session?.kind === 'test') {
    return { ok: false, reason: 'The microphone test is using the microphone. Finish or cancel it, then try again.' }
  }
  if (starting) {
    // A second click / key press while Windows is still starting: one helper, one answer.
    diag(sessionCount, 'start request joined the start in progress', { source })
    return starting
  }
  if (session) return { ok: true, reason: listeningDetail(hold) }
  if (process.platform === 'darwin') {
    const helper = compileHelper(LISTEN_HELPER)
    if (!helper) return { ok: false, reason: 'On-device speech recognition is not available.' }
    if (!launchMac(helper.root, hold, source)) return { ok: false, reason: 'On-device speech recognition is not available.' }
    return { ok: true, reason: listeningDetail(hold) }
  }
  if (process.platform === 'win32') return startWindowsSession(hold, source)
  return { ok: false, reason: 'Speech recognition is not available.' }
}

export function stopListening(): void {
  if (!session) return
  try {
    session.stop()
  } catch {
    cancelListening()
  }
}

/** Ends the current capture (listening or test). Safe to call at any time. */
export function cancelListening(): void {
  const current = session
  if (!current) {
    clearKillTimer()
    return
  }
  current.cancel()
}

function clearKillTimer(): void {
  if (killTimer) clearTimeout(killTimer)
  killTimer = null
}

function speechPhaseFor(error: unknown): 'denied' | 'silence' | 'unavailable' | 'cancelled' | 'failed' {
  return error === 'denied' || error === 'silence' || error === 'unavailable' || error === 'cancelled' ? error : 'failed'
}

function parseMacLine(line: string): { text: string } | { error: string } | null {
  if (!line) return null
  try {
    const record = JSON.parse(line) as { text?: unknown; error?: unknown }
    if (typeof record.text === 'string' && record.text.trim()) return { text: record.text.trim().slice(0, 400) }
    if (record.error !== undefined) return { error: String(record.error).slice(0, 24) }
  } catch {
    // Not a result line.
  }
  return null
}

/**
 * A session's single end: clears the timer, frees the slot and records the outcome.
 * Returns false when the session already ended (the caller drops the late callback).
 */
function makeCloser(id: number, current: () => Session): (outcome: MicOutcome, code?: string, chars?: number, extra?: Record<string, unknown>) => boolean {
  return (outcome, code = '', chars = 0, extra) => {
    if (!micLog.end(id, outcome, { code, chars })) return false
    if (session === current()) {
      session = null
      clearKillTimer()
    }
    diag(id, 'end', { outcome, ...(code ? { code } : {}), ...(extra ?? {}), summary: closeLine(id) })
    return true
  }
}

function launchMac(root: string, hold: boolean, source: MicSource): boolean {
  const id = ++sessionCount
  const mode: MicMode = hold ? 'hold' : 'tap'
  micLog.start(id, mode, source, 'darwin')
  diag(id, 'start', { mode, source })
  let handle: { signal: (name: 'USR1' | 'TERM') => void } | null = null
  const current: Session = {
    kind: 'listen',
    id,
    stop: () => handle?.signal('USR1'),
    cancel: () => {
      handle?.signal('TERM')
      if (!close('cancelled')) return
      postToPet(IPC.speech, { phase: 'cancelled', session: id })
      // Mic cancel must not leave a stuck ignore/gesture lock on the pet window.
      restorePetPointerState()
    }
  }
  const close = makeCloser(id, () => current)
  session = current
  clearKillTimer()
  killTimer = setTimeout(() => {
    if (session !== current) return
    handle?.signal('TERM')
    if (!close('safety-timeout')) return
    postToPet(IPC.speech, {
      phase: 'failed',
      session: id,
      detail: 'Listening stopped without a result. Retry; if it keeps happening, run the microphone test in Preferences.'
    })
    restorePetPointerState()
  }, hold ? HOLD_MS : LISTEN_MS)
  handle = launchHelper(
    root,
    [...(hold ? ['--hold'] : []), '--parent', String(process.pid)],
    (line) => {
      const parsed = parseMacLine(line)
      if (!parsed) return
      if ('text' in parsed) {
        if (!close('transcript', '', parsed.text.length)) {
          diag(id, 'stale transcript ignored')
          return
        }
        postToPet(IPC.speech, { phase: 'transcript', text: parsed.text, session: id })
        restorePetPointerState()
        return
      }
      const phase = speechPhaseFor(parsed.error)
      const outcome: MicOutcome = phase === 'denied' || phase === 'silence' || phase === 'unavailable' || phase === 'cancelled' ? phase : 'failed'
      if (!close(outcome, parsed.error)) {
        if (parsed.error !== 'cancelled') diag(id, 'stale result ignored', { code: parsed.error })
        return
      }
      postToPet(IPC.speech, { phase, session: id })
    },
    () => {
      // Without this the panel would stay on "Listening…" after a crash.
      if (close('helper-exit')) postToPet(IPC.speech, { phase: 'failed', session: id })
    }
  )
  if (!handle) {
    close('failed', 'launch')
    return false
  }
  diag(id, 'listening')
  return true
}

function runMacMicTest(): Promise<MicTestStatus> {
  const helper = compileHelper(LISTEN_HELPER)
  if (!helper) {
    testPhase('error', 'On-device speech recognition is not available.')
    return Promise.resolve(emptyMicTestStatus({ outcome: 'unavailable', detail: 'On-device speech recognition is not available.' }))
  }
  return new Promise((resolve) => {
    const id = ++sessionCount
    micLog.start(id, 'test', 'test', 'darwin')
    diag(id, 'start', { mode: 'test' })
    let handle: { signal: (name: 'USR1' | 'TERM') => void } | null = null
    let settled = false
    const finish = (status: MicTestStatus, outcome: MicOutcome, code = '', chars = 0): void => {
      if (settled) return
      settled = true
      handle?.signal('TERM')
      close(outcome, code, chars)
      testPhase(status.outcome === 'transcript-confirmed' ? 'done' : status.outcome === 'cancelled' ? 'cancelled' : 'error', status.detail)
      restorePetPointerState()
      resolve(status)
    }
    const current: Session = {
      kind: 'test',
      id,
      stop: () => handle?.signal('USR1'),
      cancel: () => finish(emptyMicTestStatus({ outcome: 'cancelled', detail: micTestPhaseText('cancelled', 'darwin') }), 'cancelled')
    }
    const close = makeCloser(id, () => current)
    session = current
    clearKillTimer()
    killTimer = setTimeout(() => {
      finish(emptyMicTestStatus({ outcome: 'unavailable', detail: 'The microphone test didn’t finish. Retry.' }), 'safety-timeout')
    }, LISTEN_MS + 3000)
    handle = launchHelper(
      helper.root,
      ['--parent', String(process.pid)],
      (line) => {
        const parsed = parseMacLine(line)
        if (!parsed) return
        if ('text' in parsed) {
          finish(
            emptyMicTestStatus({
              outcome: 'transcript-confirmed',
              transcript: parsed.text,
              detail: `Heard: “${parsed.text}”. Recognition stays on this Mac and is not saved.`
            }),
            'transcript',
            '',
            parsed.text.length
          )
          return
        }
        const code = parsed.error
        finish(
          emptyMicTestStatus({
            outcome: code === 'denied' ? 'denied' : code === 'silence' ? 'silence' : code === 'cancelled' ? 'cancelled' : 'unavailable',
            detail:
              code === 'denied'
                ? 'Voice access is denied. Open System Settings to change it.'
                : code === 'silence'
                  ? 'I didn’t catch any words. Retry and speak right after it says Listening.'
                  : code === 'cancelled'
                    ? micTestPhaseText('cancelled', 'darwin')
                    : 'On-device speech recognition couldn’t start. Retry.'
          }),
          code === 'denied' || code === 'silence' || code === 'cancelled' ? code : 'unavailable',
          code
        )
      },
      () => finish(emptyMicTestStatus({ outcome: 'unavailable', detail: 'The speech helper stopped before it heard anything. Retry.' }), 'helper-exit')
    )
    if (!handle) {
      finish(emptyMicTestStatus({ outcome: 'unavailable', detail: 'On-device speech recognition is not available.' }), 'failed', 'launch')
      return
    }
    testPhase('listening')
  })
}

// ---------------------------------------------------------------- Windows

interface WinHelper {
  send: (line: 'stop' | 'cancel') => void
  /** Asks the helper to cancel (releases the mic), then ends the process if it lingers. */
  cancel: () => void
}

function powershellPath(): string {
  const path = join(process.env['SystemRoot'] || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  return existsSync(path) ? path : 'powershell.exe'
}

/** Spawns listen-win.ps1 in a mode and parses its JSON lines. Null when the script file is missing. */
function spawnWinHelper(
  mode: 'listen' | 'hold' | 'test' | 'devices',
  onLine: (line: WinSpeechLine) => void,
  onExit: (code: number | null, stderr: string) => void
): WinHelper | null {
  const script = sourcePath('listen-win.ps1')
  if (!script) {
    logDiag('speech', 'listen-win.ps1 not found')
    return null
  }
  let proc: ChildProcessWithoutNullStreams
  try {
    proc = spawn(
      powershellPath(),
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, '-Mode', mode],
      { shell: false, windowsHide: true }
    )
  } catch (error) {
    logDiag('speech', 'powershell spawn threw', { error: String(error) })
    return null
  }
  let buffer = ''
  let stderr = ''
  let exited = false
  let killTimerLocal: NodeJS.Timeout | null = null
  proc.stdout.on('data', (chunk: Buffer) => {
    buffer += chunk.toString('utf8')
    let at = buffer.indexOf('\n')
    while (at >= 0) {
      const raw = buffer.slice(0, at).trim()
      buffer = buffer.slice(at + 1)
      at = buffer.indexOf('\n')
      if (!raw) continue
      const parsed = parseWinSpeechLine(raw)
      if (parsed) onLine(parsed)
    }
  })
  proc.stderr.on('data', (chunk: Buffer) => {
    if (stderr.length < 1200) stderr += chunk.toString('utf8')
  })
  proc.stdin.on('error', () => undefined)
  let finished = false
  const finish = (code: number | null): void => {
    if (finished) return
    finished = true
    exited = true
    if (killTimerLocal) clearTimeout(killTimerLocal)
    onExit(code, stderr.trim().slice(0, 400))
  }
  proc.once('error', (error) => {
    logDiag('speech', 'powershell failed to start', { error: String(error) })
    finish(null)
  })
  proc.once('close', (code) => finish(code))
  const send = (line: 'stop' | 'cancel'): void => {
    if (exited) return
    try {
      proc.stdin.write(`${line}\n`)
    } catch {
      // Helper already gone.
    }
  }
  return {
    send,
    cancel: () => {
      send('cancel')
      if (killTimerLocal || exited) return
      // The helper only reads stdin once it is listening; a slow start is ended here.
      killTimerLocal = setTimeout(() => {
        if (!exited) {
          try {
            proc.kill()
          } catch {
            // ignore
          }
        }
      }, 700)
    }
  }
}

function startWindowsSession(hold: boolean, source: MicSource): Promise<StartResult> {
  const id = ++sessionCount
  const mode: MicMode = hold ? 'hold' : 'tap'
  micLog.start(id, mode, source, 'win32')
  if (lastDefaultDevice) micLog.setDevice(id, lastDefaultDevice)
  diag(id, 'start', { mode, source })
  let ready = false
  let started = false
  let helper: WinHelper | null = null
  let resolveStart: (result: StartResult) => void = () => undefined
  const promise = new Promise<StartResult>((resolve) => {
    resolveStart = resolve
  })
  const startDone = (result: StartResult): void => {
    if (started) return
    started = true
    clearTimeout(readyTimer)
    if (starting === promise) starting = null
    resolveStart(result)
  }
  const current: Session = {
    kind: 'listen',
    id,
    stop: () => {
      // Shift + A let go before Windows was listening: nothing to transcribe, release quietly.
      if (ready) helper?.send('stop')
      else current.cancel()
    },
    cancel: () => {
      helper?.cancel()
      if (!close('cancelled')) return
      if (!started) startDone({ ok: false, reason: '' })
      else postToPet(IPC.speech, { phase: 'cancelled', session: id })
      restorePetPointerState()
    }
  }
  const close = makeCloser(id, () => current)
  const readyTimer = setTimeout(() => {
    if (started) return
    helper?.cancel()
    close('ready-timeout', '', 0, { limitMs: WIN_READY_MS })
    startDone({
      ok: false,
      reason:
        'Windows speech recognition didn\u2019t start within 8 seconds. Retry (the first start after Windows boots can be slow). If it keeps happening, run the microphone test in Preferences.',
      help: 'speech-language'
    })
  }, WIN_READY_MS)

  helper = spawnWinHelper(
    hold ? 'hold' : 'listen',
    (line) => {
      if (line.kind === 'stage') {
        micLog.stage(id, line.stage)
        return
      }
      if (line.kind === 'heard') {
        micLog.heard(id)
        return
      }
      if (line.kind === 'devices') return
      if (line.kind === 'ready') {
        if (started || session !== current) {
          diag(id, 'stale ready ignored')
          return
        }
        ready = true
        const ms = micLog.ready(id, line.recognizer)
        diag(id, 'listening', { ms, recognizer: line.recognizer })
        clearKillTimer()
        // The helper ends itself (11 s, or 58 s while Shift + A is held); this is only a safety net.
        killTimer = setTimeout(() => {
          if (session !== current) return
          helper?.cancel()
          if (!close('safety-timeout')) return
          postToPet(IPC.speech, {
            phase: 'failed',
            session: id,
            detail: 'Listening stopped without a result. Retry; if it keeps happening, run the microphone test in Preferences.'
          })
          restorePetPointerState()
        }, (hold ? HOLD_MS : LISTEN_MS) + 2000)
        startDone({ ok: true, reason: listeningDetail(hold) })
        return
      }
      if (line.kind === 'text') {
        if (!close('transcript', '', line.text.length)) {
          diag(id, 'stale transcript ignored')
          return
        }
        postToPet(IPC.speech, { phase: 'transcript', text: line.text, session: id })
        restorePetPointerState()
        return
      }
      // error
      const problem = winSpeechProblem(line.code, line.detail)
      if (!close(outcomeFor(line.code), line.code, 0, line.detail ? { detail: line.detail.slice(0, 160) } : undefined)) {
        if (line.code !== 'cancelled') diag(id, 'stale result ignored', { code: line.code })
        return
      }
      if (!started) {
        startDone(
          line.code === 'cancelled'
            ? { ok: false, reason: '' }
            : { ok: false, reason: problem.text, ...(problem.help ? { help: problem.help } : {}) }
        )
        return
      }
      postToPet(IPC.speech, {
        phase: problem.phase,
        session: id,
        ...(problem.phase === 'cancelled' ? {} : { detail: problem.text }),
        ...(problem.help ? { help: problem.help } : {})
      })
      restorePetPointerState()
    },
    (code, stderr) => {
      if (!close('helper-exit', code === null ? 'spawn' : String(code), 0, stderr ? { stderr: stderr.slice(0, 200) } : undefined)) return
      if (!started) {
        startDone({
          ok: false,
          reason: `Windows speech helper stopped before it could listen${stderr ? ` (${stderr.split(/\r?\n/)[0]})` : ''}. Retry.`,
          help: 'speech-language'
        })
        return
      }
      postToPet(IPC.speech, { phase: 'failed', session: id, detail: 'Windows speech helper stopped unexpectedly. Retry.' })
      restorePetPointerState()
    }
  )
  if (!helper) {
    clearTimeout(readyTimer)
    started = true
    micLog.end(id, 'failed', { code: 'missing-helper' })
    diag(id, 'end', { outcome: 'failed', code: 'missing-helper' })
    return Promise.resolve({ ok: false, reason: 'MIKO\u2019s Windows speech helper is missing. Reinstall MIKO.' })
  }
  session = current
  starting = promise
  return promise
}

function runWindowsMicTest(): Promise<MicTestStatus> {
  return new Promise((resolve) => {
    const id = ++sessionCount
    micLog.start(id, 'test', 'test', 'win32')
    if (lastDefaultDevice) micLog.setDevice(id, lastDefaultDevice)
    diag(id, 'start', { mode: 'test' })
    let settled = false
    let helper: WinHelper | null = null
    const finish = (status: MicTestStatus, outcome: MicOutcome, code = '', chars = 0): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      helper?.cancel()
      close(outcome, code, chars)
      testPhase(status.outcome === 'transcript-confirmed' ? 'done' : status.outcome === 'cancelled' ? 'cancelled' : 'error', status.detail)
      restorePetPointerState()
      resolve(status)
    }
    // Counts as the capture so a mic click during the test doesn't open the mic twice.
    const testSession: Session = {
      kind: 'test',
      id,
      stop: () => helper?.send('stop'),
      cancel: () => finish(emptyMicTestStatus({ outcome: 'cancelled', detail: micTestPhaseText('cancelled', 'win32') }), 'cancelled')
    }
    const close = makeCloser(id, () => testSession)
    const timer = setTimeout(
      () => finish(emptyMicTestStatus({ outcome: 'unavailable', detail: 'The microphone test didn\u2019t finish. Retry.' }), 'safety-timeout'),
      WIN_READY_MS + 12_000
    )
    helper = spawnWinHelper(
      'test',
      (line) => {
        if (line.kind === 'stage') {
          micLog.stage(id, line.stage)
          return
        }
        if (line.kind === 'ready') {
          const ms = micLog.ready(id, line.recognizer)
          diag(id, 'listening', { ms, recognizer: line.recognizer })
          if (!settled) testPhase('listening')
          return
        }
        if (line.kind === 'heard') {
          micLog.heard(id)
          if (!settled) testPhase('hearing')
          return
        }
        if (line.kind === 'text') {
          finish(
            emptyMicTestStatus({
              outcome: 'transcript-confirmed',
              transcript: line.text,
              detail: `Heard: \u201c${line.text}\u201d. Recognition stays on this PC and is not saved.`
            }),
            'transcript',
            '',
            line.text.length
          )
          return
        }
        if (line.kind === 'error') {
          const problem = winSpeechProblem(line.code, line.detail)
          finish(
            emptyMicTestStatus({
              outcome:
                line.code === 'cancelled'
                  ? 'cancelled'
                  : line.code === 'denied'
                    ? 'denied'
                    : line.code === 'silence' || line.code === 'no-audio'
                      ? 'silence'
                      : 'unavailable',
              detail: line.code === 'cancelled' ? micTestPhaseText('cancelled', 'win32') : problem.text,
              ...(problem.help ? { help: problem.help } : {})
            }),
            outcomeFor(line.code),
            line.code
          )
        }
      },
      (code, stderr) => {
        if (settled) return
        logDiag('speech', 'mic test helper exited', { code, stderr })
        finish(
          emptyMicTestStatus({
            outcome: 'unavailable',
            detail: `Windows speech helper stopped${stderr ? ` (${stderr.split(/\r?\n/)[0]})` : ''}. Retry.`,
            help: 'speech-language'
          }),
          'helper-exit',
          code === null ? 'spawn' : String(code)
        )
      }
    )
    if (!helper) {
      clearTimeout(timer)
      settled = true
      micLog.end(id, 'failed', { code: 'missing-helper' })
      testPhase('error', 'MIKO\u2019s Windows speech helper is missing. Reinstall MIKO.')
      resolve(emptyMicTestStatus({ outcome: 'unavailable', detail: 'MIKO\u2019s Windows speech helper is missing. Reinstall MIKO.' }))
      return
    }
    session = testSession
  })
}

export interface InputDevices {
  devices: string[]
  /** The Windows default recording device (what System.Speech listens to). */
  defaultDevice: string
  /** Installed Windows speech recognizer languages. */
  recognizers: string[]
  detail: string
}

/** Windows input devices (names only). System.Speech always records from the Windows default input. */
export function listInputDevices(): Promise<InputDevices> {
  if (process.platform !== 'win32') return Promise.resolve({ devices: [], defaultDevice: '', recognizers: [], detail: '' })
  return new Promise((resolve) => {
    let done = false
    const finish = (value: InputDevices): void => {
      if (done) return
      done = true
      clearTimeout(timer)
      if (value.defaultDevice) lastDefaultDevice = value.defaultDevice
      logDiag('mic', 'devices', {
        count: value.devices.length,
        defaultDevice: value.defaultDevice,
        recognizers: value.recognizers
      })
      resolve(value)
    }
    const empty = (detail: string): InputDevices => ({ devices: [], defaultDevice: '', recognizers: [], detail })
    const timer = setTimeout(() => finish(empty('Couldn\u2019t list microphones.')), 15_000)
    const helper = spawnWinHelper(
      'devices',
      (line) => {
        if (line.kind === 'devices') {
          finish({
            devices: line.devices,
            defaultDevice: line.defaultDevice,
            recognizers: line.recognizers,
            detail: line.recognizers.length ? '' : 'Windows has no speech recognizer installed. Add a speech language in Settings → Time & language → Speech.'
          })
        }
      },
      () => finish(empty('Couldn\u2019t list microphones.'))
    )
    if (!helper) finish(empty('MIKO\u2019s Windows speech helper is missing.'))
  })
}
