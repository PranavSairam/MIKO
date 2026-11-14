import { spawn, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { basename } from 'node:path'
import { shell } from 'electron'
import { CHATGPT_HOME, parseChatUrl } from '../shared/chatgpt'

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
