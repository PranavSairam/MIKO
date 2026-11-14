import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import { IPC } from '../shared/api'
import { assistantInstructions, bridgeResult, emptyBridge, readBridgeEvent, type BridgeState } from '../shared/bridge'
import { postToPet } from './pet-window'
import { assistantEnabled, assistantThread, mikoPreferences, setAssistantThread } from './settings'

/**
 * MIKO's assistant, via OpenAI's Codex CLI bundled in ChatGPT.app and signed
 * in with ChatGPT (credentials stay in Codex's own login). Headless: the
 * ChatGPT window is never automated.
 *
 * Minimal context (see PROJECT_LOG for the measurements): the user's Codex
 * config (plugins, MCP servers, notify hook) is ignored, every tool and agent
 * feature is switched off, and Codex's agent instructions are replaced by a
 * short MIKO-owned instructions file in userData (never in Git).
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
const FEATURES_OFF = [
  'multi_agent', 'plugins', 'apps', 'browser_use', 'browser_use_external', 'computer_use', 'image_generation',
  'skill_search', 'tool_suggest', 'goals', 'sleep_tool', 'hooks', 'in_app_browser', 'realtime_conversation',
  'remote_plugin', 'mentions_v2', 'code_mode_host', 'shell_tool', 'unified_exec'
]
const running = new Map<string, { proc: ChildProcess; timer: NodeJS.Timeout; settled: boolean }>()

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
  return { enabled: assistantEnabled(), available: Boolean(path), signedIn, thread: assistantThread(), busy: running.size > 0 }
}

function assistantDir(): { work: string; instructions: string } {
  const root = join(app.getPath('userData'), 'assistant')
  const work = join(root, 'empty')
  mkdirSync(work, { recursive: true })
  return { work, instructions: join(root, 'instructions.md') }
}

/** Codex arguments for a minimal, tool-free assistant turn. */
function codexArgs(thread: string | null, prompt: string): string[] {
  const { work, instructions } = assistantDir()
  writeFileSync(instructions, assistantInstructions(mikoPreferences()), { mode: 0o600 })
  const config = [
    '--json',
    '--skip-git-repo-check',
    '--ignore-user-config',
    ...FEATURES_OFF.flatMap((feature) => ['-c', `features.${feature}=false`]),
    '-c', `model_instructions_file=${JSON.stringify(instructions)}`,
    '-c', 'web_search="disabled"',
    '-c', 'skills.include_instructions=false',
    '-c', 'include_collaboration_mode_instructions=false',
    '-c', 'include_permissions_instructions=false',
    '-c', 'include_environment_context=false',
    '-c', 'sandbox_mode="read-only"',
    '-c', 'approval_policy="never"'
  ]
  return thread ? ['exec', 'resume', thread, ...config, prompt] : ['exec', ...config, '-C', work, prompt]
}

/** One request at a time. Follow-ups continue the current conversation. */
export function sendBridge(requestId: string, prompt: string): { ok: boolean; reason: string } {
  if (!assistantEnabled()) return { ok: false, reason: 'MIKO assistant is off. Turn it on in the paw menu.' }
  const path = codexPath()
  if (!path) return { ok: false, reason: 'ChatGPT’s bundled Codex CLI wasn’t found.' }
  if (running.has(requestId)) return { ok: false, reason: 'That request is already running.' }
  if (running.size > 0) return { ok: false, reason: 'MIKO is still answering. Wait for it, or cancel it.' }
  const thread = assistantThread() || null
  const started = Date.now()
  const proc = spawn(path, codexArgs(thread, prompt), { shell: false, cwd: assistantDir().work, stdio: ['ignore', 'pipe', 'ignore'] })
  let state: BridgeState = emptyBridge()
  let buffer = ''
  const finish = (update: Omit<BridgeUpdate, 'requestId'>): void => {
    const job = running.get(requestId)
    if (!job || job.settled) return
    job.settled = true
    clearTimeout(job.timer)
    running.delete(requestId)
    if (update.phase === 'done' && update.thread) setAssistantThread(update.thread)
    postToPet(IPC.bridgeUpdate, { requestId, seconds: Math.round((Date.now() - started) / 100) / 10, ...update })
  }
  const timer = setTimeout(() => {
    proc.kill('SIGTERM')
    finish({ phase: 'timeout', reason: `No complete reply within ${TIMEOUT_MS / 1000} s.` })
  }, TIMEOUT_MS)
  running.set(requestId, { proc, timer, settled: false })
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
    if (result.ok && code === 0) finish({ phase: 'done', reply: result.reply.slice(0, 8000), thread: result.thread })
    else finish({ phase: 'failed', reason: result.ok ? `The Codex CLI exited with code ${code}.` : result.reason, thread: state.thread })
  })
  postToPet(IPC.bridgeUpdate, { requestId, phase: 'running', thread: thread ?? undefined })
  return { ok: true, reason: '' }
}

export function newConversation(): void {
  setAssistantThread('')
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
