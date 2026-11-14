import { spawn, type ChildProcess } from 'node:child_process'
import { IPC } from '../shared/api'
import { compileHelper, launchHelper, sourcePath, type HelperSpec } from './helper-app'
import { postToPet } from './pet-window'

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
  handle = launchHelper(root, hold ? ['--hold'] : [], hooks.line, hooks.ended)
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
    return true
  }
  if (record.error === undefined) return false
  const error = record.error
  const phase =
    error === 'denied' || error === 'silence' || error === 'unavailable' || error === 'cancelled' ? error : 'failed'
  postToPet(IPC.speech, { phase, session: id })
  return true
}
