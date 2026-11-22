import { spawn, type ChildProcess } from 'node:child_process'
import { shell } from 'electron'
import { IPC } from '../shared/api'
import {
  emptyMicTestStatus,
  type MicTestStatus,
  type PermissionState,
  type VoicePermissionStatus
} from '../shared/setup'
import { compileHelper, launchHelper, sourcePath, type HelperSpec } from './helper-app'
import { postToPet, restorePetPointerState } from './pet-window'

/**
 * Recognition is on-device. The browser SpeechRecognition API in this Electron
 * build posts audio to https://www.google.com/speech-api and is not used.
 * macOS uses SFSpeechRecognizer with requiresOnDeviceRecognition, in the
 * "MIKO Listen" helper app (see helper-app.ts for why it is launched through
 * LaunchServices). Stop is SIGUSR1, cancel is SIGTERM.
 * Windows uses the local System.Speech dictation engine.
 * Read-aloud uses the renderer's local speechSynthesis voices.
 */

interface Session {
  stop: () => void
  kill: () => void
}

const LISTEN_MS = 12000
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

export async function openVoicePrivacySettings(): Promise<boolean> {
  const url =
    process.platform === 'win32'
      ? 'ms-settings:privacy-microphone'
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
  if (process.platform === 'win32') {
    const script = sourcePath('listen-win.ps1')
    if (!script) {
      return emptyMicTestStatus({
        outcome: 'unavailable',
        detail: 'The Windows System.Speech helper is missing.'
      })
    }
    return new Promise((resolve) => {
      const proc = spawn(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script],
        { shell: false, stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true }
      )
      let buffer = ''
      let settled = false
      const finish = (status: MicTestStatus): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        try {
          proc.kill()
        } catch {
          // ignore
        }
        resolve(status)
      }
      const timer = setTimeout(
        () =>
          finish(
            emptyMicTestStatus({
              outcome: 'silence',
              detail: 'No speech heard during the microphone test.'
            })
          ),
        10_000
      )
      proc.stdout?.on('data', (chunk: Buffer) => {
        buffer += chunk.toString('utf8')
        let at = buffer.indexOf('\n')
        while (at >= 0) {
          const line = buffer.slice(0, at).trim()
          buffer = buffer.slice(at + 1)
          at = buffer.indexOf('\n')
          if (!line) continue
          try {
            const parsed = JSON.parse(line) as { text?: unknown; error?: unknown }
            if (typeof parsed.text === 'string' && parsed.text.trim()) {
              const transcript = parsed.text.trim().slice(0, 400)
              finish(
                emptyMicTestStatus({
                  outcome: 'transcript-confirmed',
                  transcript,
                  detail: `Heard: “${transcript}”. Recognition stays on this PC and is not saved.`
                })
              )
              return
            }
            if (parsed.error === 'denied') {
              finish(
                emptyMicTestStatus({
                  outcome: 'denied',
                  detail: 'Microphone access was denied. Open Windows privacy settings to allow it.'
                })
              )
              return
            }
            if (parsed.error === 'silence') {
              finish(
                emptyMicTestStatus({
                  outcome: 'silence',
                  detail: 'No speech heard. Check the mic and try again.'
                })
              )
              return
            }
            if (parsed.error === 'unavailable' || parsed.error === 'cancelled') {
              finish(
                emptyMicTestStatus({
                  outcome: 'unavailable',
                  detail: 'System.Speech could not start on this PC.'
                })
              )
              return
            }
          } catch {
            // ignore non-JSON
          }
        }
      })
      proc.once('error', () =>
        finish(
          emptyMicTestStatus({
            outcome: 'unavailable',
            detail: 'Could not start the Windows speech helper.'
          })
        )
      )
      proc.once('close', () => {
        if (!settled) {
          finish(
            emptyMicTestStatus({
              outcome: 'silence',
              detail: 'No speech heard during the microphone test.'
            })
          )
        }
      })
    })
  }
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

export async function startListening(hold = false): Promise<{ ok: boolean; reason: string }> {
  if (session) return { ok: true, reason: listeningDetail(hold) }
  if (process.platform === 'darwin') {
    const helper = compileHelper(LISTEN_HELPER)
    if (!helper) return { ok: false, reason: 'On-device speech recognition is not available.' }
    if (!launchMac(helper.root, hold)) return { ok: false, reason: 'On-device speech recognition is not available.' }
    return { ok: true, reason: listeningDetail(hold) }
  }
  if (process.platform === 'win32') {
    const script = sourcePath('listen-win.ps1')
    if (!script) return { ok: false, reason: 'Speech recognition is not available.' }
    launchChild('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script])
    return { ok: true, reason: listeningDetail() }
  }
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

function launchChild(command: string, args: string[]): void {
  const proc: ChildProcess = spawn(command, args, { shell: false, stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true })
  const hooks = track(
    {
      stop: () => {
        proc.stdin?.write('stop\n')
      },
      kill: () => {
        proc.kill('SIGTERM')
      }
    },
    LISTEN_MS
  )
  let buffer = ''
  proc.stdout?.on('data', (chunk: Buffer) => {
    buffer += chunk.toString('utf8')
    let splitAt = buffer.indexOf('\n')
    while (splitAt >= 0) {
      const line = buffer.slice(0, splitAt).trim()
      buffer = buffer.slice(splitAt + 1)
      splitAt = buffer.indexOf('\n')
      if (line) hooks.line(line)
    }
  })
  proc.once('close', hooks.ended)
  proc.once('error', hooks.ended)
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
