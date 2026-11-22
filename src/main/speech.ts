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
import { parseWinSpeechLine, speechHelpUrl, winSpeechProblem, type SpeechHelp, type WinSpeechLine } from '../shared/win-speech'
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

interface Session {
  stop: () => void
  kill: () => void
}

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
let cancelled = false
let killTimer: NodeJS.Timeout | null = null
/** Increments per listening session; sent with every speech event so a recording is handled once. */
let sessionCount = 0

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
 * Explicit microphone check via the platform speech helper.
 * Does not use browser getUserMedia; never claims Electron host permission.
 */
export async function runMicTest(): Promise<MicTestStatus> {
  if (session) {
    return emptyMicTestStatus({
      outcome: 'unavailable',
      detail: 'MIKO is already listening. Stop that first, then try again.'
    })
  }
  if (process.platform === 'win32') return runWindowsMicTest()
  if (process.platform === 'darwin') {
    const status = await voicePermissionStatus(true)
    if (status.microphone === 'denied' || status.speechRecognition === 'denied') {
      return emptyMicTestStatus({
        outcome: 'denied',
        detail: status.detail || 'Voice access is denied. Open System Settings to change it.'
      })
    }
    if (!status.supported || status.microphone === 'unavailable') {
      return emptyMicTestStatus({
        outcome: 'unavailable',
        detail: status.detail || 'On-device speech recognition is unavailable.'
      })
    }
    // Start a short listen; the tutorial also receives the normal speech IPC event.
    const started = await startListening(false)
    if (!started.ok) {
      return emptyMicTestStatus({
        outcome: 'unavailable',
        detail: started.reason || 'Could not start the microphone test.'
      })
    }
    return emptyMicTestStatus({
      outcome: 'not-tested',
      detail: 'Listening… say something. Recognition stays on this Mac and is not saved.'
    })
  }
  return emptyMicTestStatus({
    outcome: 'unavailable',
    detail: 'Voice input is not available on this platform.'
  })
}

export async function startListening(hold = false): Promise<{ ok: boolean; reason: string; help?: SpeechHelp }> {
  if (session) return { ok: true, reason: listeningDetail(hold) }
  if (process.platform === 'darwin') {
    const helper = compileHelper(LISTEN_HELPER)
    if (!helper) return { ok: false, reason: 'On-device speech recognition is not available.' }
    if (!launchMac(helper.root, hold)) return { ok: false, reason: 'On-device speech recognition is not available.' }
    return { ok: true, reason: listeningDetail(hold) }
  }
  if (process.platform === 'win32') return startWindowsSession(hold)
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

export function cancelListening(): void {
  cancelled = true
  const current = session
  session = null
  clearKillTimer()
  if (!current) return
  current.kill()
  postToPet(IPC.speech, { phase: 'cancelled', session: sessionCount })
  // Mic cancel must not leave a stuck ignore/gesture lock on the pet window.
  restorePetPointerState()
}

function clearKillTimer(): void {
  if (killTimer) clearTimeout(killTimer)
  killTimer = null
}

/** One result per session, and a failure if the helper dies without one. */
function track(current: Session, capMs: number): { line: (text: string) => void; ended: () => void } {
  cancelled = false
  session = current
  sessionCount += 1
  const id = sessionCount
  let delivered = false
  killTimer = setTimeout(() => {
    if (session === current) cancelListening()
  }, capMs)
  return {
    line: (text) => {
      if (session !== current || delivered) return
      if (deliver(text, id)) delivered = true
    },
    ended: () => {
      if (session !== current) return
      session = null
      clearKillTimer()
      // Without this the panel would stay on "Listening…" after a crash.
      if (!delivered && !cancelled) postToPet(IPC.speech, { phase: 'failed', session: id })
    }
  }
}

function launchMac(root: string, hold: boolean): boolean {
  let handle: { signal: (name: 'USR1' | 'TERM') => void } | null = null
  const current: Session = {
    stop: () => handle?.signal('USR1'),
    kill: () => handle?.signal('TERM')
  }
  const hooks = track(current, hold ? HOLD_MS : LISTEN_MS)
  handle = launchHelper(root, [...(hold ? ['--hold'] : []), '--parent', String(process.pid)], hooks.line, hooks.ended)
  if (!handle) {
    session = null
    clearKillTimer()
    return false
  }
  return true
}

/** Returns true when the line was a result (transcript or error). */
function deliver(line: string, id: number): boolean {
  if (cancelled || !line) return false
  let payload: unknown
  try {
    payload = JSON.parse(line)
  } catch {
    return false
  }
  if (!payload || typeof payload !== 'object') return false
  const record = payload as { text?: unknown; error?: unknown }
  if (typeof record.text === 'string' && record.text.trim()) {
    postToPet(IPC.speech, { phase: 'transcript', text: record.text.trim().slice(0, 400), session: id })
    restorePetPointerState()
    return true
  }
  if (record.error === undefined) return false
  const error = record.error
  const phase =
    error === 'denied' || error === 'silence' || error === 'unavailable' || error === 'cancelled' ? error : 'failed'
  postToPet(IPC.speech, { phase, session: id })
  return true
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
      setTimeout(() => {
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

function startWindowsSession(hold = false): Promise<{ ok: boolean; reason: string; help?: SpeechHelp }> {
  return new Promise((resolve) => {
    cancelled = false
    sessionCount += 1
    const id = sessionCount
    let ready = false
    let delivered = false
    let started = false
    let helper: WinHelper | null = null
    const current: Session = {
      stop: () => {
        if (ready) helper?.send('stop')
        else cancelListening()
      },
      kill: () => helper?.cancel()
    }
    const startDone = (result: { ok: boolean; reason: string; help?: SpeechHelp }): void => {
      if (started) return
      started = true
      clearTimeout(readyTimer)
      resolve(result)
    }
    const readyTimer = setTimeout(() => {
      if (started) return
      delivered = true
      if (session === current) session = null
      helper?.cancel()
      logDiag('speech', 'helper did not report ready in time', { ms: WIN_READY_MS })
      startDone({
        ok: false,
        reason: 'Windows speech recognition didn\u2019t start within 8 seconds. Retry, or run the microphone test in Setup.',
        help: 'speech-language'
      })
    }, WIN_READY_MS)

    helper = spawnWinHelper(
      hold ? 'hold' : 'listen',
      (line) => {
        if (line.kind === 'ready') {
          if (started || session !== current) return
          ready = true
          logDiag('speech', 'listening', { recognizer: line.recognizer })
          clearKillTimer()
          // The helper ends itself (11 s, or 58 s while Shift + A is held); this is only a safety net.
          killTimer = setTimeout(() => {
            if (session === current) cancelListening()
          }, (hold ? HOLD_MS : LISTEN_MS) + 2000)
          startDone({ ok: true, reason: listeningDetail(hold) })
          return
        }
        if (!ready) {
          if (line.kind !== 'error') return
          delivered = true
          if (session === current) session = null
          const problem = winSpeechProblem(line.code, line.detail)
          logDiag('speech', 'could not start', { code: line.code, detail: line.detail })
          startDone(
            line.code === 'cancelled'
              ? { ok: false, reason: '' }
              : { ok: false, reason: problem.text, ...(problem.help ? { help: problem.help } : {}) }
          )
          return
        }
        if (delivered || cancelled || session !== current) return
        if (line.kind === 'text') {
          delivered = true
          session = null
          clearKillTimer()
          logDiag('speech', 'transcript', { chars: line.text.length })
          postToPet(IPC.speech, { phase: 'transcript', text: line.text, session: id })
          restorePetPointerState()
          return
        }
        if (line.kind === 'error') {
          delivered = true
          session = null
          clearKillTimer()
          const problem = winSpeechProblem(line.code, line.detail)
          logDiag('speech', 'ended without transcript', { code: line.code, detail: line.detail })
          postToPet(IPC.speech, {
            phase: problem.phase,
            session: id,
            ...(problem.phase === 'cancelled' ? {} : { detail: problem.text }),
            ...(problem.help ? { help: problem.help } : {})
          })
          restorePetPointerState()
        }
      },
      (code, stderr) => {
        if (!started) {
          if (session === current) session = null
          delivered = true
          logDiag('speech', 'helper exited before ready', { code, stderr })
          startDone(
            cancelled
              ? { ok: false, reason: '' }
              : {
                  ok: false,
                  reason: `Windows speech helper stopped before it could listen${stderr ? ` (${stderr.split(/\r?\n/)[0]})` : ''}. Retry.`,
                  help: 'speech-language'
                }
          )
          return
        }
        if (session !== current) return
        session = null
        clearKillTimer()
        if (!delivered && !cancelled) {
          logDiag('speech', 'helper exited without a result', { code, stderr })
          postToPet(IPC.speech, { phase: 'failed', session: id, detail: 'Windows speech helper stopped unexpectedly. Retry.' })
        }
        restorePetPointerState()
      }
    )
    if (!helper) {
      clearTimeout(readyTimer)
      started = true
      resolve({ ok: false, reason: 'MIKO\u2019s Windows speech helper is missing. Reinstall MIKO.' })
      return
    }
    session = current
  })
}

function runWindowsMicTest(): Promise<MicTestStatus> {
  return new Promise((resolve) => {
    let settled = false
    let helper: WinHelper | null = null
    const finish = (status: MicTestStatus): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (session === testSession) session = null
      helper?.cancel()
      resolve(status)
    }
    // Counts as "listening" so a mic click during the test doesn't open the mic twice.
    const testSession: Session = { stop: () => helper?.send('stop'), kill: () => helper?.cancel() }
    const timer = setTimeout(
      () => finish(emptyMicTestStatus({ outcome: 'unavailable', detail: 'The microphone test didn\u2019t finish. Retry.' })),
      WIN_READY_MS + 12_000
    )
    helper = spawnWinHelper(
      'test',
      (line) => {
        if (line.kind === 'ready') {
          logDiag('speech', 'mic test listening', { recognizer: line.recognizer })
          return
        }
        if (line.kind === 'text') {
          finish(
            emptyMicTestStatus({
              outcome: 'transcript-confirmed',
              transcript: line.text,
              detail: `Heard: \u201c${line.text}\u201d. Recognition stays on this PC and is not saved.`
            })
          )
          return
        }
        if (line.kind === 'error') {
          const problem = winSpeechProblem(line.code, line.detail)
          logDiag('speech', 'mic test ended', { code: line.code, detail: line.detail })
          finish(
            emptyMicTestStatus({
              outcome: line.code === 'denied' ? 'denied' : line.code === 'silence' || line.code === 'no-audio' ? 'silence' : 'unavailable',
              detail: problem.text,
              ...(problem.help ? { help: problem.help } : {})
            })
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
          })
        )
      }
    )
    if (!helper) {
      clearTimeout(timer)
      settled = true
      resolve(emptyMicTestStatus({ outcome: 'unavailable', detail: 'MIKO\u2019s Windows speech helper is missing. Reinstall MIKO.' }))
      return
    }
    session = testSession
  })
}

/** Windows input devices (names only). System.Speech always records from the Windows default input. */
export function listInputDevices(): Promise<{ devices: string[]; detail: string }> {
  if (process.platform !== 'win32') return Promise.resolve({ devices: [], detail: '' })
  return new Promise((resolve) => {
    let done = false
    const finish = (value: { devices: string[]; detail: string }): void => {
      if (done) return
      done = true
      clearTimeout(timer)
      resolve(value)
    }
    const timer = setTimeout(() => finish({ devices: [], detail: 'Couldn\u2019t list microphones.' }), 10_000)
    const helper = spawnWinHelper(
      'devices',
      (line) => {
        if (line.kind === 'devices') finish({ devices: line.devices, detail: '' })
      },
      () => finish({ devices: [], detail: 'Couldn\u2019t list microphones.' })
    )
    if (!helper) finish({ devices: [], detail: 'MIKO\u2019s Windows speech helper is missing.' })
  })
}
