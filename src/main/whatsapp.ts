import { spawn, type ChildProcess } from 'node:child_process'
import { launchApplication } from './apps'
import { axHelperPath } from './ax'
import { logDiag } from './diagnostics'
import { sourcePath } from './helper-app'
import { powershellPath } from './win-keys'
import {
  setWhatsAppAliases,
  setWhatsAppContextNoticeSeen,
  whatsAppAliases,
  whatsAppContextNoticeSeen
} from './settings'
import {
  cleanContactQuery,
  forgetAlias,
  parseHelperOutput,
  planWhatsApp,
  rememberAlias,
  resolveAlias,
  type WhatsAppAlias,
  type WhatsAppMatch,
  type WhatsAppOpenResult
} from '../shared/whatsapp'
import type { WhatsAppInsertResult, WhatsAppPeekResult, WhatsAppVisibleMessage } from '../shared/whatsapp-reply'

/**
 * Open a WhatsApp chat by searching the app's accessibility tree: ax-mac.swift on macOS,
 * resources/whatsapp-win.ps1 (UI Automation) on Windows. Both speak the same JSON contract.
 * Contact search never writes the message composer. Reply capture/insert stay macOS-only.
 */

const empty = (status: WhatsAppOpenResult['status'], query: string, reason: string, matches: WhatsAppMatch[] = []): WhatsAppOpenResult => ({
  status,
  query,
  names: matches.map((m) => m.name),
  matches,
  header: '',
  reason,
  composerReady: false
})

let child: ChildProcess | null = null
let generation = 0

export function cancelWhatsApp(): void {
  generation += 1
  const current = child
  child = null
  current?.kill('SIGTERM')
}

interface HelperRow {
  name?: unknown
  snippet?: unknown
}

interface HelperPayload {
  ok?: boolean
  status?: string
  reason?: string
  query?: string
  header?: string
  rows?: unknown
  messages?: unknown
  inspected?: boolean
  composerReady?: boolean
  composerText?: string
  verified?: boolean
  atLatest?: boolean
  diag?: string
}

type HelperView = Omit<WhatsAppOpenResult, 'status' | 'matches' | 'names'> & {
  status: WhatsAppOpenResult['status'] | 'results'
  rows: { name: string; snippet: string }[]
  inspected: boolean
}

function parseRows(value: unknown): { name: string; snippet: string }[] {
  if (!Array.isArray(value)) return []
  const out: { name: string; snippet: string }[] = []
  for (const row of value.slice(0, 12)) {
    if (typeof row === 'string') {
      out.push({ name: row.slice(0, 80), snippet: '' })
      continue
    }
    if (!row || typeof row !== 'object') continue
    const name = (row as HelperRow).name
    const snippet = (row as HelperRow).snippet
    if (typeof name !== 'string' || !name.trim()) continue
    out.push({
      name: name.slice(0, 80),
      snippet: typeof snippet === 'string' ? snippet.slice(0, 120) : ''
    })
  }
  return out
}

function fromHelper(payload: HelperPayload, query: string): HelperView {
  const known = new Set([
    'opened',
    'assisted',
    'none',
    'choices',
    'lost-focus',
    'permission',
    'failed',
    'unsupported',
    'cancelled',
    'unverified',
    'results'
  ])
  const status = typeof payload.status === 'string' && known.has(payload.status) ? payload.status : 'failed'
  return {
    status: status as HelperView['status'],
    query,
    header: typeof payload.header === 'string' ? payload.header.slice(0, 80) : '',
    reason: typeof payload.reason === 'string' ? payload.reason.slice(0, 400) : '',
    composerReady: payload.composerReady === true,
    rows: parseRows(payload.rows),
    inspected: payload.inspected === true
  }
}

/** The contact-search helper for this platform, or null when it isn't available. */
function spawnSearchHelper(): ChildProcess | null {
  if (process.platform === 'win32') {
    const script = sourcePath('whatsapp-win.ps1')
    if (!script) return null
    return spawn(
      powershellPath(),
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, '-Mode', 'open'],
      { shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] }
    )
  }
  const path = axHelperPath()
  if (!path) return null
  return spawn(path, ['whatsapp'], { shell: false, stdio: ['pipe', 'pipe', 'ignore'] })
}

function runHelper(
  search: string,
  pick: { name: string; snippet: string } | null,
  gen: number,
  reuseSearch = false
): Promise<ReturnType<typeof fromHelper>> {
  let proc: ChildProcess | null
  try {
    proc = spawnSearchHelper()
  } catch {
    proc = null
  }
  if (!proc) {
    const reason = process.platform === 'win32' ? 'MIKO’s Windows WhatsApp helper isn’t available.' : 'MIKO’s Accessibility helper isn’t available.'
    return Promise.resolve(fromHelper({ status: 'failed', reason }, search))
  }
  const helper: ChildProcess = proc
  const started = Date.now()
  // Windows compiles its UI Automation helper on first use, so allow longer there.
  const limitMs = process.platform === 'win32' ? 30000 : 20000
  return new Promise((resolve) => {
    child = helper
    let out = ''
    let settled = false
    const finish = (payload: HelperPayload): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (child === helper) child = null
      if (process.platform === 'win32') {
        // State and counts only: never message text.
        logDiag('whatsapp', pick ? 'open result' : 'search', {
          status: typeof payload.status === 'string' ? payload.status : 'failed',
          ms: Date.now() - started,
          diag: typeof payload.diag === 'string' ? payload.diag.slice(0, 300) : ''
        })
      }
      if (gen !== generation) {
        resolve(fromHelper({ status: 'cancelled', reason: 'WhatsApp search cancelled.' }, search))
        return
      }
      resolve(fromHelper(payload, search))
    }
    const timer = setTimeout(() => {
      helper.kill('SIGTERM')
      finish({ status: 'failed', reason: 'WhatsApp search took too long, so I stopped.' })
    }, limitMs)
    helper.stdout?.on('data', (chunk: Buffer) => {
      out += chunk.toString('utf8')
    })
    helper.once('error', () => finish({ status: 'failed', reason: 'MIKO’s Accessibility helper isn’t available.' }))
    helper.once('close', () => {
      if (gen !== generation) {
        finish({ status: 'cancelled', reason: 'WhatsApp search cancelled.' })
        return
      }
      try {
        finish(parseHelperOutput(out) as HelperPayload)
      } catch {
        finish({ status: 'failed', reason: 'WhatsApp didn’t answer.' })
      }
    })
    const body = pick
      ? { search, name: pick.name, snippet: pick.snippet, reuseSearch: reuseSearch || undefined }
      : { search }
    helper.stdin?.end(JSON.stringify(body))
  })
}

/** In-flight opens keyed by task id — coalesces concurrent duplicate submits for the same task. */
const openByTask = new Map<string, Promise<WhatsAppOpenResult>>()

export interface WhatsAppOpenRequest {
  query: string
  /** Re-open a specific chooser result after revalidation. */
  pickId?: string
  /**
   * Opaque id for this user-submitted task. Concurrent duplicate invokes with the same
   * taskId share one execution; a later new taskId may search again for the same person.
   */
  taskId?: string
}

/** Search once, then open a unique exact chat (reuseSearch on press). With pickId, revalidates first. */
export async function openWhatsAppContact(request: WhatsAppOpenRequest | string): Promise<WhatsAppOpenResult> {
  const raw = typeof request === 'string' ? request : request.query
  const pickId = typeof request === 'string' ? undefined : request.pickId
  const taskId =
    typeof request === 'string' || !request.taskId
      ? `auto-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
      : request.taskId
  const query = cleanContactQuery(raw)
  if (!query) return empty('failed', '', 'That name isn’t one I can search for.')
  if (process.platform !== 'darwin' && process.platform !== 'win32') {
    return empty('unsupported', query, 'WhatsApp contact search isn’t available on this computer.')
  }

  const coalesceKey = `${taskId}::${query}::${pickId ?? ''}`
  const existing = openByTask.get(coalesceKey)
  if (existing) return existing

  const work = openWhatsAppContactOnce(query, pickId, taskId)
  openByTask.set(coalesceKey, work)
  try {
    return await work
  } finally {
    openByTask.delete(coalesceKey)
  }
}

async function openWhatsAppContactOnce(
  query: string,
  pickId: string | undefined,
  taskId: string
): Promise<WhatsAppOpenResult> {
  const gen = ++generation
  child?.kill('SIGTERM')
  const launched = await launchApplication('whatsapp', true)
  if (gen !== generation) return empty('cancelled', query, 'WhatsApp search cancelled.')
  if (!launched.ok) return empty('failed', query, launched.reason || 'I couldn’t open WhatsApp.')

  const alias = pickId ? null : resolveAlias(whatsAppAliases(), query)
  const searchFor = alias?.name ?? query
  // One typed search for this task.
  const listed = await runHelper(searchFor, null, gen, false)
  if (gen !== generation) return empty('cancelled', query, 'WhatsApp search cancelled.')
  if (listed.status === 'assisted') {
    return empty('assisted', query, listed.reason || `I put “${searchFor}” in WhatsApp’s search. Pick the chat there.`)
  }
  if (listed.status === 'none') {
    return empty(
      'none',
      query,
      alias ? `“${alias.alias}” is saved as “${alias.name}”, but that chat isn’t in WhatsApp’s results.` : `No WhatsApp chat matched “${query}”.`
    )
  }
  if (listed.status !== 'results') {
    return {
      status: listed.status,
      query,
      names: [],
      matches: [],
      header: listed.header,
      reason: listed.reason,
      composerReady: false
    }
  }

  const plan = planWhatsApp(searchFor, listed.rows, {
    inspected: listed.inspected,
    expect: alias?.name,
    pickId
  })
  if (plan.action === 'assisted') {
    return empty('assisted', query, plan.reason || `I put “${searchFor}” in WhatsApp’s search. Pick the chat there.`)
  }
  if (plan.action === 'none') {
    return empty(
      'none',
      query,
      alias ? `“${alias.alias}” is saved as “${alias.name}”, but that chat isn’t in WhatsApp’s results.` : `No WhatsApp chat matched “${query}”.`
    )
  }
  if (plan.action === 'choices') {
    return {
      status: 'choices',
      query,
      names: plan.matches.map((m) => m.name),
      matches: plan.matches,
      header: '',
      reason: pickId ? 'WhatsApp’s results changed. Which chat did you mean?' : '',
      composerReady: false
    }
  }

  // Press the chosen row without retyping the query (reuseSearch). One bounded retry if stale.
  let opened = await runHelper(searchFor, { name: plan.match.name, snippet: plan.match.snippet }, gen, true)
  if (gen !== generation) return empty('cancelled', query, 'WhatsApp search cancelled.')
  if (opened.status === 'failed' && /stale/i.test(opened.reason || '')) {
    if (typeof process !== 'undefined' && process.env.NODE_ENV !== 'production') {
      console.info('[miko:wa-open]', taskId, 'reuseSearch stale → one full re-search before press')
    }
    opened = await runHelper(searchFor, { name: plan.match.name, snippet: plan.match.snippet }, gen, false)
    if (gen !== generation) return empty('cancelled', query, 'WhatsApp search cancelled.')
  }
  if (opened.status === 'assisted') {
    return empty('assisted', query, opened.reason || 'Several chats look the same in WhatsApp. Pick the one you want there.')
  }
  if (opened.status === 'opened') {
    return {
      status: 'opened',
      query,
      names: [opened.header || plan.match.name],
      matches: [plan.match],
      header: opened.header || plan.match.name,
      reason: '',
      composerReady: opened.composerReady
    }
  }
  if (opened.status === 'none' || opened.status === 'results') {
    const again = planWhatsApp(searchFor, opened.rows, { inspected: opened.inspected })
    if (again.action === 'choices') {
      return {
        status: 'choices',
        query,
        names: again.matches.map((m) => m.name),
        matches: again.matches,
        header: '',
        reason: 'WhatsApp’s results changed. Which chat did you mean?',
        composerReady: false
      }
    }
    return empty(
      'none',
      query,
      alias ? `“${alias.alias}” is saved as “${alias.name}”, but that chat isn’t in WhatsApp’s results.` : `No WhatsApp chat matched “${plan.match.name}”.`
    )
  }
  return {
    status: opened.status,
    query,
    names: [],
    matches: [],
    header: '',
    reason: opened.reason || 'I couldn’t open that WhatsApp chat.',
    composerReady: false
  }
}

export function listWhatsAppAliases(): WhatsAppAlias[] {
  return whatsAppAliases()
}

export function saveWhatsAppAlias(alias: string, name: string): { ok: boolean; reason: string; list: WhatsAppAlias[] } {
  const saved = rememberAlias(whatsAppAliases(), alias, name)
  if (!saved.ok) return { ok: false, reason: saved.reason, list: whatsAppAliases() }
  if (!setWhatsAppAliases(saved.list)) return { ok: false, reason: 'Couldn’t save that on this Mac.', list: whatsAppAliases() }
  return { ok: true, reason: '', list: saved.list }
}

export function removeWhatsAppAlias(alias: string): { ok: boolean; reason: string; list: WhatsAppAlias[] } {
  const saved = forgetAlias(whatsAppAliases(), alias)
  if (!saved.ok) return { ok: false, reason: saved.reason, list: whatsAppAliases() }
  if (!setWhatsAppAliases(saved.list)) return { ok: false, reason: 'Couldn’t update the saved names.', list: whatsAppAliases() }
  return { ok: true, reason: '', list: saved.list }
}

export type { WhatsAppPeekResult, WhatsAppInsertResult }

function parseMessages(value: unknown): WhatsAppVisibleMessage[] {
  if (!Array.isArray(value)) return []
  const out: WhatsAppVisibleMessage[] = []
  for (const row of value.slice(0, 12)) {
    if (!row || typeof row !== 'object') continue
    const { sender, text, mine, raw } = row as Partial<WhatsAppVisibleMessage>
    if (typeof text !== 'string' || !text.trim()) continue
    out.push({
      sender: typeof sender === 'string' ? sender.slice(0, 80) : 'Contact',
      text: text.slice(0, 500),
      mine: mine === true,
      raw: typeof raw === 'string' ? raw.slice(0, 600) : text.slice(0, 600)
    })
  }
  return out
}

function runWhatsAppCommand(args: string[], input: string, gen: number, timeoutMs = 12000): Promise<HelperPayload> {
  const path = axHelperPath()
  if (!path) return Promise.resolve({ status: 'failed', reason: 'MIKO’s Accessibility helper isn’t available.' })
  return new Promise((resolve) => {
    const proc = spawn(path, args, { shell: false, stdio: ['pipe', 'pipe', 'ignore'] })
    child = proc
    let out = ''
    let settled = false
    const finish = (payload: HelperPayload): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (child === proc) child = null
      if (gen !== generation) {
        resolve({ status: 'cancelled', reason: 'WhatsApp action cancelled.' })
        return
      }
      resolve(payload)
    }
    const timer = setTimeout(() => {
      proc.kill('SIGTERM')
      finish({ status: 'failed', reason: 'WhatsApp took too long, so I stopped.' })
    }, timeoutMs)
    proc.stdout?.on('data', (chunk: Buffer) => {
      out += chunk.toString('utf8')
    })
    proc.once('error', () => finish({ status: 'failed', reason: 'MIKO’s Accessibility helper isn’t available.' }))
    proc.once('close', () => {
      if (gen !== generation) {
        finish({ status: 'cancelled', reason: 'WhatsApp action cancelled.' })
        return
      }
      try {
        finish(JSON.parse(out.trim().split('\n').pop() ?? '{}') as HelperPayload)
      } catch {
        finish({ status: 'failed', reason: 'WhatsApp didn’t answer.' })
      }
    })
    proc.stdin?.end(input)
  })
}

/** Read the open chat header (and optional visible messages) before MIKO keeps focus. */
export async function peekWhatsApp(opts: { messages?: boolean; latest?: boolean } = {}): Promise<WhatsAppPeekResult> {
  const notice = !whatsAppContextNoticeSeen()
  if (process.platform !== 'darwin') {
    return {
      status: 'unsupported',
      header: '',
      messages: [],
      composerText: '',
      composerReady: false,
      reason: 'WhatsApp reply capture isn’t available on Windows yet.',
      contextNotice: notice
    }
  }
  const gen = ++generation
  child?.kill('SIGTERM')
  const args = opts.messages ? ['whatsapp-peek', '--messages'] : ['whatsapp-peek']
  if (opts.latest) args.splice(0, args.length, 'whatsapp-latest')
  const payload = await runWhatsAppCommand(args, '', gen)
  if (gen !== generation) {
    return { status: 'cancelled', header: '', messages: [], composerText: '', composerReady: false, reason: 'WhatsApp capture cancelled.', contextNotice: notice }
  }
  const status = typeof payload.status === 'string' ? payload.status : 'failed'
  const known = new Set(['peeked', 'lost-focus', 'permission', 'failed', 'cancelled'])
  // Diagnostics never include message bodies.
  if (typeof payload.diag === 'string' && payload.diag) {
    console.info('[whatsapp]', payload.diag.slice(0, 240))
  }
  return {
    status: (known.has(status) ? status : 'failed') as WhatsAppPeekResult['status'],
    header: typeof payload.header === 'string' ? payload.header.slice(0, 80) : '',
    messages: parseMessages(payload.messages),
    composerText: typeof payload.composerText === 'string' ? payload.composerText.slice(0, 4000) : '',
    composerReady: payload.composerReady === true,
    reason: typeof payload.reason === 'string' ? payload.reason.slice(0, 400) : '',
    contextNotice: notice,
    atLatest: payload.atLatest !== false,
    diag: typeof payload.diag === 'string' ? payload.diag.slice(0, 240) : ''
  }
}

export async function insertWhatsAppDraft(request: {
  expectHeader: string
  text: string
  mode: 'replace' | 'append' | 'ask'
}): Promise<WhatsAppInsertResult> {
  if (process.platform !== 'darwin') {
    return { status: 'unsupported', header: '', composerText: '', verified: false, reason: 'WhatsApp draft insertion isn’t available on Windows yet.' }
  }
  const header = cleanContactQuery(request.expectHeader) ?? ''
  const text = request.mode === 'ask' ? '' : request.text.slice(0, 4000)
  if (!header || (request.mode !== 'ask' && !text.trim())) {
    return { status: 'failed', header: '', composerText: '', verified: false, reason: 'That draft isn’t one I can insert.' }
  }
  const gen = ++generation
  child?.kill('SIGTERM')
  const payload = await runWhatsAppCommand(
    ['whatsapp-insert'],
    JSON.stringify({ expectHeader: header, text, mode: request.mode }),
    gen,
    10000
  )
  if (gen !== generation) {
    return { status: 'cancelled', header: '', composerText: '', verified: false, reason: 'WhatsApp insert cancelled.' }
  }
  const status = typeof payload.status === 'string' ? payload.status : 'failed'
  const known = new Set(['inserted', 'empty', 'has-text', 'switched', 'lost-focus', 'permission', 'failed', 'cancelled'])
  if (typeof payload.diag === 'string' && payload.diag) {
    console.info('[whatsapp]', payload.diag.slice(0, 240))
  }
  return {
    status: (known.has(status) ? status : 'failed') as WhatsAppInsertResult['status'],
    header: typeof payload.header === 'string' ? payload.header.slice(0, 80) : '',
    composerText: typeof payload.composerText === 'string' ? payload.composerText.slice(0, 4000) : '',
    verified: payload.verified === true,
    reason: typeof payload.reason === 'string' ? payload.reason.slice(0, 400) : '',
    diag: typeof payload.diag === 'string' ? payload.diag.slice(0, 240) : ''
  }
}

export function markWhatsAppContextNoticeSeen(): boolean {
  return setWhatsAppContextNoticeSeen(true)
}
