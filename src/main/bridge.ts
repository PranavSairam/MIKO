import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import { IPC } from '../shared/api'
import { bridgeResult, emptyBridge, readBridgeEvent, type BridgeState } from '../shared/bridge'
import { postToPet } from './pet-window'
import { bridgeEnabled, bridgeThread } from './settings'

/**
 * ChatGPT bridge proof of concept (opt-in, macOS).
 *
 * Uses OpenAI's Codex CLI that ships inside ChatGPT.app (`codex exec --json`),
 * signed in through ChatGPT's own login. It runs headless: nothing is typed
 * into or read from the ChatGPT window (that window exposes no accessible
 * composer or reply, and OpenAI's terms forbid programmatic extraction of
 * Output from the product UI). Requests run read-only in an empty folder.
 */

export interface BridgeUpdate {
  requestId: string
  phase: 'running' | 'done' | 'failed' | 'cancelled' | 'timeout'
  reply?: string
  thread?: string
  reason?: string
  seconds?: number
}

const TIMEOUT_MS = 120_000
const CANDIDATES = ['/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex']
const running = new Map<string, { proc: ChildProcess; thread: string | null; timer: NodeJS.Timeout; settled: boolean }>()

export function codexPath(): string | null {
  return CANDIDATES.find((path) => existsSync(path)) ?? null
}

export function bridgeStatus(): { enabled: boolean; available: boolean; signedIn: boolean; thread: string; busy: boolean } {
  const path = codexPath()
  let signedIn = false
  if (path) {
    const out = spawnSync(path, ['login', 'status'], { shell: false, encoding: 'utf8', timeout: 8000 })
    signedIn = /logged in using chatgpt/i.test(`${out.stdout}${out.stderr}`)
  }
  return { enabled: bridgeEnabled(), available: Boolean(path), signedIn, thread: bridgeThread(), busy: running.size > 0 }
}

function workDir(): string {
  const dir = join(app.getPath('userData'), 'bridge-work')
  mkdirSync(dir, { recursive: true })
  return dir
}

/** Send one prompt. One request per conversation at a time; a second is refused, not queued. */
export function sendBridge(requestId: string, prompt: string): { ok: boolean; reason: string } {
  if (!bridgeEnabled()) return { ok: false, reason: 'The ChatGPT bridge is off. Turn on “ChatGPT bridge test” in the paw menu.' }
  const path = codexPath()
  if (!path) return { ok: false, reason: 'ChatGPT’s bundled Codex CLI wasn’t found.' }
  if (running.has(requestId)) return { ok: false, reason: 'That request is already running.' }
  const thread = bridgeThread() || null
  for (const job of running.values()) {
    if (job.thread === thread) {
      return { ok: false, reason: thread ? 'That conversation is still answering. Wait for it, or cancel it.' : 'A bridge request is still running.' }
    }
  }
  const common = ['--json', '--skip-git-repo-check', '-c', 'sandbox_mode="read-only"', '-c', 'approval_policy="never"']
  const args = thread ? ['exec', 'resume', thread, ...common, prompt] : ['exec', ...common, '-C', workDir(), prompt]
  const started = Date.now()
  const proc = spawn(path, args, { shell: false, cwd: workDir(), stdio: ['ignore', 'pipe', 'ignore'] })
  let state: BridgeState = emptyBridge()
  let buffer = ''
  const finish = (update: Omit<BridgeUpdate, 'requestId'>): void => {
    const job = running.get(requestId)
    if (!job || job.settled) return
    job.settled = true
    clearTimeout(job.timer)
    running.delete(requestId)
    postToPet(IPC.bridgeUpdate, { requestId, seconds: Math.round((Date.now() - started) / 100) / 10, ...update })
  }
  const timer = setTimeout(() => {
    proc.kill('SIGTERM')
    finish({ phase: 'timeout', reason: `No complete reply within ${TIMEOUT_MS / 1000} s.` })
  }, TIMEOUT_MS)
  running.set(requestId, { proc, thread, timer, settled: false })
  proc.stdout?.on('data', (chunk: Buffer) => {
    buffer += chunk.toString('utf8')
    let at = buffer.indexOf('\n')
    while (at >= 0) {
      state = readBridgeEvent(state, buffer.slice(0, at))
      buffer = buffer.slice(at + 1)
      at = buffer.indexOf('\n')
    }
  })
  proc.once('error', () => finish({ phase: 'failed', reason: 'The Codex CLI couldn’t start.' }))
  proc.once('close', (code) => {
    if (buffer.trim()) state = readBridgeEvent(state, buffer)
    const result = bridgeResult(state, thread)
    if (result.ok && code === 0) finish({ phase: 'done', reply: result.reply.slice(0, 4000), thread: result.thread })
    else finish({ phase: 'failed', reason: result.ok ? `The Codex CLI exited with code ${code}.` : result.reason, thread: state.thread })
  })
  postToPet(IPC.bridgeUpdate, { requestId, phase: 'running', thread: thread ?? undefined })
  return { ok: true, reason: '' }
}

export function cancelBridge(requestId: string): boolean {
  const job = running.get(requestId)
  if (!job || job.settled) return false
  job.proc.kill('SIGTERM')
  job.settled = true
  clearTimeout(job.timer)
  running.delete(requestId)
  postToPet(IPC.bridgeUpdate, { requestId, phase: 'cancelled', reason: 'Cancelled. ChatGPT may already have received the request.' })
  return true
}

export function stopAllBridges(): void {
  for (const id of [...running.keys()]) cancelBridge(id)
}
