import { spawn, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { basename } from 'node:path'
import { shell } from 'electron'
import { CHATGPT_HOME, parseChatUrl } from '../shared/chatgpt'
import { runAx } from './ax'
import { chatgptAutoPaste } from './settings'

/**
 * Opening ChatGPT and saved ChatGPT links.
 *
 * The ChatGPT desktop app has no officially documented link that opens a
 * specific chatgpt.com conversation, Project or custom GPT (its documented
 * codex:// links cover new/local chats, settings and plugins only), and it
 * claims no associated domains. So MIKO does not invent app deep links:
 * saved chats open through the system's normal https handler, and MIKO
 * reports which app that is.
 */

export interface OpenResult {
  ok: boolean
  /** Where it opened: the ChatGPT app, a browser, or nowhere. */
  target: 'app' | 'browser' | 'none'
  /** Display name of the app that handled it, when known. */
  appName: string
}

const BUNDLE_IDS = ['com.openai.chat', 'com.openai.codex']
const FALLBACK_PATHS = ['/Applications/ChatGPT.app']

/** The installed ChatGPT desktop app, or null. macOS only for now. */
export function findChatGptApp(): string | null {
  if (process.platform !== 'darwin') return null
  for (const id of BUNDLE_IDS) {
    const found = spawnSync('/usr/bin/mdfind', [`kMDItemCFBundleIdentifier == '${id}'`], {
      shell: false,
      encoding: 'utf8',
      timeout: 3000
    })
    const path = (found.stdout ?? '')
      .split('\n')
      .map((line) => line.trim())
      .find((line) => line.endsWith('.app') && existsSync(line))
    if (path) return path
  }
  return FALLBACK_PATHS.find((path) => existsSync(path)) ?? null
}

/** Launch or bring forward the ChatGPT app; otherwise open chatgpt.com in the default browser. */
export async function openChatGpt(): Promise<OpenResult> {
  // Windows/Linux: no native ChatGPT app path here. Never silently open the default browser;
  // the IPC layer sends "open ChatGPT" to MIKO's Interactive GPT workspace instead.
  if (process.platform !== 'darwin') return { ok: false, target: 'none', appName: '' }
  const appPath = findChatGptApp()
  if (appPath && (await run('/usr/bin/open', ['-a', appPath]))) {
    return { ok: true, target: 'app', appName: basename(appPath, '.app') }
  }
  const opened = await shell.openExternal(CHATGPT_HOME).then(
    () => true,
    () => false
  )
  return opened ? { ok: true, target: 'browser', appName: handlerName(CHATGPT_HOME) } : { ok: false, target: 'none', appName: '' }
}

/** Open a validated saved-chat link with the system's normal URL handler. */
export async function openChatUrl(raw: string): Promise<OpenResult> {
  const parsed = parseChatUrl(raw)
  if (!parsed.ok) return { ok: false, target: 'none', appName: '' }
  const opened = await shell.openExternal(parsed.url).then(
    () => true,
    () => false
  )
  if (!opened) return { ok: false, target: 'none', appName: '' }
  const name = handlerName(parsed.url)
  const app = findChatGptApp()
  const isApp = Boolean(app && name && basename(app, '.app') === name)
  return { ok: true, target: isApp ? 'app' : 'browser', appName: name }
}

/** Name of the app macOS uses for this URL (NSWorkspace), e.g. "Google Chrome". */
function handlerName(url: string): string {
  if (process.platform !== 'darwin') return ''
  const script = `ObjC.import('AppKit'); function run(argv) {
  const app = $.NSWorkspace.sharedWorkspace.URLForApplicationToOpenURL($.NSURL.URLWithString(argv[0]))
  return (app && !app.isNil()) ? ObjC.unwrap(app.path) : '' }`
  const found = spawnSync('/usr/bin/osascript', ['-l', 'JavaScript', '-e', script, url], {
    shell: false,
    encoding: 'utf8',
    timeout: 3000
  })
  const path = (found.stdout ?? '').trim()
  return path.endsWith('.app') ? basename(path, '.app') : ''
}

function run(command: string, args: string[]): Promise<boolean> {
  return new Promise((resolve) => {
    const proc = spawn(command, args, { shell: false, stdio: 'ignore' })
    proc.once('error', () => resolve(false))
    proc.once('close', (code) => resolve(code === 0))
  })
}

export type InsertState =
  | { state: 'inserted'; mode: string }
  | { state: 'pasted'; reason: string }
  | { state: 'has-text'; length: number }
  | { state: 'unavailable'; reason: string }
  | { state: 'failed'; reason: string }

/**
 * Put a prepared prompt into the ChatGPT app's message box, ready to send.
 * Only types when macOS Accessibility identifies the focused field in
 * ChatGPT itself; otherwise stops and reports why (nothing is typed).
 * mode: undefined = check first (ask when the box has text), 'append' | 'replace'.
 */
export async function insertIntoChatGpt(prompt: string, mode?: 'append' | 'replace'): Promise<InsertState> {
  const appPath = findChatGptApp()
  if (!appPath) return { state: 'unavailable', reason: 'The ChatGPT app isn\u2019t installed.' }
  if (!(await run('/usr/bin/open', ['-a', appPath]))) return { state: 'failed', reason: 'ChatGPT didn\u2019t come to the front.' }
  let info = await runAx(['focus-info'])
  for (let i = 0; i < 8 && !/^com\.openai\.(codex|chat)$/.test(info.bundle); i += 1) {
    await new Promise((r) => setTimeout(r, 250))
    info = await runAx(['focus-info'])
  }
  const isChatGpt = /^com\.openai\.(codex|chat)$/.test(info.bundle)
  if (!isChatGpt) return { state: 'failed', reason: info.app ? `${info.app} is in front, not ChatGPT.` : 'ChatGPT didn\u2019t come to the front.' }
  if ((!info.ok || !info.editable) && chatgptAutoPaste()) {
    // ChatGPT hides its message box from Accessibility, but focuses it when it comes forward.
    // With ChatGPT verified as the front app, paste once (never sends); clipboard restored if untouched.
    const pasted = await runAx(
      ['paste', '--exclude-pid', String(process.pid), '--allow-unexposed', '--expect-bundles', 'com.openai.codex,com.openai.chat', '--settle-ms', '350'],
      prompt,
      10000
    )
    if (pasted.ok) return { state: 'pasted', reason: '' }
    return { state: 'failed', reason: pasted.reason || 'The paste into ChatGPT didn\u2019t go through.' }
  }
  if (!info.ok || !info.editable) {
    return {
      state: 'unavailable',
      reason: 'ChatGPT doesn\u2019t expose its message box to macOS Accessibility, so MIKO can\u2019t tell where text would go and typed nothing.'
    }
  }
  if (!mode && info.valueLength > 0) return { state: 'has-text', length: info.valueLength }
  const result = await runAx(['insert', '--pid', String(info.pid), '--sig', info.sig, '--mode', mode ?? 'selection'], prompt)
  if (result.ok && result.verified) return { state: 'inserted', mode: mode ?? 'insert' }
  return { state: 'failed', reason: result.reason || 'The text couldn\u2019t be inserted and verified.' }
}
