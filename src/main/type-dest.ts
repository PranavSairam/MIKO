/**
 * Generic typing destinations: ChatGPT new-chat, omnibox, Notes, captured field.
 * Reuses AX insert/paste patterns from ChatGPT + WhatsApp — never presses Enter to “finish”.
 */

import { spawn } from 'node:child_process'
import { basename } from 'node:path'
import {
  destinationSummary,
  isChatGptBundle,
  isChromeBundle,
  isMikoBundle,
  isNotesBundle,
  type TypeDestination,
  type TypeInsertResult,
  type TypeMode
} from '../shared/destination'
import { runAx, type AxResult } from './ax'
import { findChatGptApp, openChatGpt } from './chatgpt'
import { lastExternalApp } from './foreground'

let generation = 0

const AX_UNSUPPORTED =
  'Typing into other apps via Accessibility is available on macOS only. On Windows, copy the text and paste it yourself, or use Interactive GPT.'

function requireDarwin(): { ok: false; reason: string } | null {
  if (process.platform === 'darwin') return null
  return { ok: false, reason: AX_UNSUPPORTED }
}

export function cancelTypeDest(): void {
  generation += 1
}

function bump(): number {
  generation += 1
  return generation
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

function axToDest(info: AxResult, kind: TypeDestination['kind'], label = ''): TypeDestination {
  return {
    kind,
    appName: info.app || 'App',
    bundleId: info.bundle || '',
    pid: info.pid || 0,
    fieldSig: info.sig || '',
    fieldRole: info.role || '',
    label,
    capturedAt: Date.now(),
    verified: Boolean(info.ok && info.editable && !info.secure),
    source: 'observed',
    secure: Boolean(info.secure)
  }
}

/** Snapshot the focused editable field, excluding MIKO. Used for “type here”. */
export async function captureFocusedDestination(excludePid: number): Promise<TypeDestination | null> {
  if (process.platform !== 'darwin') return null
  const info = await runAx(['focus-info'])
  if (!info.pid || info.pid === excludePid) return null
  if (isMikoBundle(info.bundle, info.app)) return null
  if (info.secure) {
    return axToDest(info, 'external-field')
  }
  let kind: TypeDestination['kind'] = 'external-field'
  if (isChatGptBundle(info.bundle)) kind = 'chatgpt-composer'
  else if (isChromeBundle(info.bundle) && /combo|search|text.?field/i.test(info.role)) kind = 'omnibox'
  else if (isNotesBundle(info.bundle)) kind = 'notes'
  return axToDest(info, kind)
}

/** Capture last external app’s focus info if still available (best-effort for “type here”). */
export async function captureHereDestination(excludePid: number): Promise<TypeDestination | null> {
  if (process.platform !== 'darwin') return null
  const last = lastExternalApp()
  if (last?.pid && last.pid !== excludePid) {
    const info = await runAx(['focus-info', '--activate', String(last.pid)])
    if (info.pid === last.pid && info.editable && !info.secure && !isMikoBundle(info.bundle, info.app)) {
      let kind: TypeDestination['kind'] = 'external-field'
      if (isChatGptBundle(info.bundle)) kind = 'chatgpt-composer'
      else if (isNotesBundle(info.bundle)) kind = 'notes'
      return axToDest(info, kind, last.name)
    }
    // App known but no editable field — still return an unverified app-level destination.
    return {
      kind: 'external-field',
      appName: last.name,
      bundleId: last.bundleId,
      pid: last.pid,
      fieldSig: '',
      fieldRole: '',
      label: last.name,
      capturedAt: Date.now(),
      verified: false,
      source: 'observed',
      secure: false
    }
  }
  return captureFocusedDestination(excludePid)
}

export async function openAndFocusChatGpt(): Promise<{ ok: boolean; reason: string; dest: TypeDestination | null }> {
  const blocked = requireDarwin()
  if (blocked) return { ...blocked, dest: null }
  const opened = await openChatGpt()
  if (!opened.ok) return { ok: false, reason: 'ChatGPT didn’t open.', dest: null }
  if (opened.target !== 'app') {
    return {
      ok: true,
      reason: `Opened ChatGPT in ${opened.appName || 'the browser'}. Focus the composer, then say “Paste now”.`,
      dest: {
        kind: 'choose',
        appName: opened.appName || 'Browser',
        bundleId: '',
        pid: 0,
        fieldSig: '',
        fieldRole: '',
        label: 'ChatGPT (browser)',
        capturedAt: Date.now(),
        verified: false,
        source: 'observed',
        secure: false
      }
    }
  }
  await sleep(400)
  let info = await runAx(['focus-info'])
  for (let i = 0; i < 10 && !isChatGptBundle(info.bundle); i += 1) {
    await sleep(250)
    info = await runAx(['focus-info'])
  }
  if (!isChatGptBundle(info.bundle)) {
    return { ok: false, reason: info.app ? `${info.app} is in front, not ChatGPT.` : 'ChatGPT didn’t come to the front.', dest: null }
  }
  return { ok: true, reason: '', dest: axToDest(info, 'chatgpt-composer', 'ChatGPT') }
}

/**
 * Create a new ChatGPT chat via ⌘N, then verify ChatGPT is still frontmost.
 * Does not claim the composer is empty unless AX exposes it.
 */
export async function chatgptNewChat(): Promise<{ ok: boolean; verified: boolean; reason: string; dest: TypeDestination | null }> {
  const blocked = requireDarwin()
  if (blocked) return { ...blocked, verified: false, dest: null }
  const gen = bump()
  const appPath = findChatGptApp()
  if (!appPath) {
    return {
      ok: false,
      verified: false,
      reason: 'The ChatGPT app isn’t installed. I can open chatgpt.com in your browser instead — say if you want that.',
      dest: null
    }
  }
  await openChatGpt()
  await sleep(400)
  if (gen !== generation) return { ok: false, verified: false, reason: 'Cancelled.', dest: null }
  let info = await runAx(['focus-info'])
  for (let i = 0; i < 8 && !isChatGptBundle(info.bundle); i += 1) {
    await sleep(250)
    info = await runAx(['focus-info'])
  }
  if (!isChatGptBundle(info.bundle)) {
    return { ok: false, verified: false, reason: 'ChatGPT isn’t in front, so I didn’t start a new chat.', dest: null }
  }
  const stroke = await runAx([
    'keystroke',
    '--key',
    'n',
    '--cmd',
    '--expect-bundles',
    'com.openai.chat,com.openai.codex'
  ])
  if (gen !== generation) return { ok: false, verified: false, reason: 'Cancelled.', dest: null }
  await sleep(500)
  const after = await runAx(['focus-info'])
  if (!isChatGptBundle(after.bundle)) {
    return { ok: false, verified: false, reason: 'Focus left ChatGPT after New Chat. Nothing was typed.', dest: null }
  }
  const dest = axToDest(after, 'chatgpt-composer', 'New chat')
  // If AX exposes the composer and it has text, new-chat likely failed.
  if (after.ok && after.editable && after.valueLength > 0) {
    return {
      ok: false,
      verified: false,
      reason:
        'The ChatGPT composer still has text after New Chat — I didn’t type into the previous conversation. Try New Chat in the app, then say “Paste now”.',
      dest
    }
  }
  return {
    ok: stroke.ok || isChatGptBundle(after.bundle),
    verified: after.ok && after.editable && after.valueLength === 0,
    reason: after.editable
      ? ''
      : 'Started New Chat (⌘N). ChatGPT doesn’t expose its composer to Accessibility — I’ll paste when the app is frontmost, or you can say “Paste now”.',
    dest
  }
}

export async function insertIntoDestination(opts: {
  text: string
  dest: TypeDestination
  mode?: TypeMode
  excludePid: number
  allowUnexposedChatGpt?: boolean
}): Promise<TypeInsertResult> {
  if (process.platform !== 'darwin') {
    return {
      status: 'unsupported',
      destination: opts.dest,
      composerText: '',
      verified: false,
      reason: AX_UNSUPPORTED
    }
  }
  const gen = bump()
  const text = opts.text
  if (!text) return { status: 'failed', destination: opts.dest, composerText: '', verified: false, reason: 'Nothing to type.' }
  if (opts.dest.secure) {
    return { status: 'secure', destination: opts.dest, composerText: '', verified: false, reason: 'That’s a password field. MIKO won’t type there.' }
  }
  if (opts.dest.pid && opts.dest.pid === opts.excludePid) {
    return { status: 'failed', destination: opts.dest, composerText: '', verified: false, reason: 'I won’t type into MIKO’s own panel.' }
  }

  const wantsChatGpt =
    opts.allowUnexposedChatGpt ||
    opts.dest.kind === 'chatgpt-composer' ||
    isChatGptBundle(opts.dest.bundleId)

  // Recheck destination immediately before write. ChatGPT often needs a few tries to stay frontmost.
  if (wantsChatGpt) {
    const appPath = findChatGptApp()
    if (appPath) await runOpen(['-a', appPath])
    else if (opts.dest.pid > 0) await runAx(['focus-info', '--activate', String(opts.dest.pid)])
  } else if (opts.dest.pid > 0) {
    await runAx(['focus-info', '--activate', String(opts.dest.pid)])
  }
  await sleep(250)
  if (gen !== generation) {
    return { status: 'cancelled', destination: opts.dest, composerText: '', verified: false, reason: 'Cancelled.' }
  }
  let info = await runAx(['focus-info'])
  if (wantsChatGpt) {
    for (let i = 0; i < 8 && !isChatGptBundle(info.bundle); i += 1) {
      await sleep(250)
      info = await runAx(['focus-info'])
      if (gen !== generation) {
        return { status: 'cancelled', destination: opts.dest, composerText: '', verified: false, reason: 'Cancelled.' }
      }
    }
  }
  if (isMikoBundle(info.bundle, info.app) || info.pid === opts.excludePid) {
    return {
      status: 'switched',
      destination: opts.dest,
      composerText: '',
      verified: false,
      reason: 'MIKO is in front. Click into the destination, then say “Paste now”.'
    }
  }
  if (
    !wantsChatGpt &&
    opts.dest.bundleId &&
    info.bundle &&
    info.bundle !== opts.dest.bundleId &&
    !bundlesCompatible(opts.dest.bundleId, info.bundle)
  ) {
    return {
      status: 'switched',
      destination: axToDest(info, 'external-field'),
      composerText: '',
      verified: false,
      reason: `${info.app || 'Another app'} is in front, not ${opts.dest.appName}.`
    }
  }
  if (wantsChatGpt && !isChatGptBundle(info.bundle)) {
    return {
      status: 'switched',
      destination: axToDest(info, 'external-field'),
      composerText: '',
      verified: false,
      reason: info.app ? `${info.app} is in front, not ChatGPT.` : 'ChatGPT didn’t come to the front.'
    }
  }
  if (info.secure) {
    return { status: 'secure', destination: axToDest(info, 'external-field'), composerText: '', verified: false, reason: 'That’s a password field. MIKO won’t type there.' }
  }

  const mode = opts.mode ?? 'ask'
  if (!mode || mode === 'ask') {
    if (info.ok && info.editable && info.valueLength > 0) {
      return {
        status: 'has-text',
        destination: axToDest(info, opts.dest.kind, opts.dest.label),
        composerText: '',
        verified: false,
        reason: `${info.app} already has text. Choose Replace, Append, or Cancel.`
      }
    }
  }

  if (info.ok && info.editable && info.pid) {
    if (opts.dest.fieldSig && info.sig && info.sig !== opts.dest.fieldSig && opts.dest.kind === 'external-field') {
      return {
        status: 'switched',
        destination: axToDest(info, 'external-field'),
        composerText: '',
        verified: false,
        reason: 'The focused field changed. Choose the destination again.'
      }
    }
    const insertMode = mode === 'append' ? 'append' : 'replace'
    const result = await runAx(
      ['insert', '--pid', String(info.pid), '--sig', info.sig, '--mode', insertMode],
      text,
      12000
    )
    if (gen !== generation) {
      return { status: 'cancelled', destination: opts.dest, composerText: '', verified: false, reason: 'Cancelled.' }
    }
    if (result.ok && result.verified) {
      return {
        status: 'inserted',
        destination: axToDest(result, opts.dest.kind, opts.dest.label),
        composerText: text,
        verified: true,
        reason: ''
      }
    }
  }

  // ChatGPT / unexposed composers — paste when ChatGPT is frontmost (composer often not AX-editable).
  if (wantsChatGpt && isChatGptBundle(info.bundle)) {
    const pasted = await runAx(
      [
        'paste',
        '--exclude-pid',
        String(opts.excludePid),
        '--allow-unexposed',
        '--expect-bundles',
        'com.openai.chat,com.openai.codex',
        '--settle-ms',
        '400'
      ],
      text,
      10000
    )
    if (gen !== generation) {
      return { status: 'cancelled', destination: opts.dest, composerText: '', verified: false, reason: 'Cancelled.' }
    }
    if (pasted.ok) {
      return {
        status: 'pasted-unverified',
        destination: axToDest(info, 'chatgpt-composer', opts.dest.label || 'ChatGPT'),
        composerText: text,
        verified: false,
        reason: 'Pasted into ChatGPT (composer not exposed to Accessibility — insertion unverified). Nothing was sent.'
      }
    }
    return {
      status: 'failed',
      destination: axToDest(info, 'chatgpt-composer', opts.dest.label || 'ChatGPT'),
      composerText: '',
      verified: false,
      reason: pasted.reason || 'The paste into ChatGPT didn’t go through. Click the message box, then Paste now.'
    }
  }

  return {
    status: 'unsupported',
    destination: axToDest(info, opts.dest.kind, opts.dest.label),
    composerText: '',
    verified: false,
    reason:
      info.editable
        ? `I couldn’t verify the insert in ${info.app || 'that app'}. Use Copy, or click the field and say “Paste now”.`
        : `${info.app || 'That app'} doesn’t expose an editable field. Click where you want the text, then say “Paste now”.`
  }
}

export async function setOmniboxText(text: string, excludePid: number): Promise<TypeInsertResult> {
  if (process.platform !== 'darwin') {
    return {
      status: 'unsupported',
      destination: null,
      composerText: '',
      verified: false,
      reason: AX_UNSUPPORTED
    }
  }
  const gen = bump()
  // Prefer bringing Chrome forward if last external was Chrome; else require Chrome frontmost.
  const last = lastExternalApp()
  if (last && isChromeBundle(last.bundleId) && last.pid !== excludePid) {
    await runAx(['focus-info', '--activate', String(last.pid)])
    await sleep(200)
  } else {
    await openChrome()
    await sleep(400)
  }
  if (gen !== generation) {
    return { status: 'cancelled', destination: null, composerText: '', verified: false, reason: 'Cancelled.' }
  }
  const result = await runAx(
    ['omnibox-set', '--expect-bundles', 'com.google.Chrome,com.google.Chrome.canary,com.brave.Browser'],
    text,
    10000
  )
  if (gen !== generation) {
    return { status: 'cancelled', destination: null, composerText: '', verified: false, reason: 'Cancelled.' }
  }
  const dest = axToDest(result, 'omnibox', 'Address bar')
  if (result.ok && result.verified) {
    return { status: 'inserted', destination: dest, composerText: text, verified: true, reason: 'Address bar set — not navigated.' }
  }
  if (result.ok) {
    return {
      status: 'pasted-unverified',
      destination: dest,
      composerText: text,
      verified: false,
      reason: 'Put text in the address bar (unverified). Nothing was opened — say “go to it” if you want to navigate.'
    }
  }
  return {
    status: 'failed',
    destination: dest,
    composerText: '',
    verified: false,
    reason: result.reason || 'Couldn’t set the address bar. Focus Chrome’s address bar and say “Paste now”.'
  }
}

export async function openNotes(): Promise<{ ok: boolean; reason: string; dest: TypeDestination | null }> {
  const blocked = requireDarwin()
  if (blocked) return { ...blocked, dest: null }
  const ok = await runOpen(['-a', 'Notes'])
  if (!ok) return { ok: false, reason: 'Notes didn’t open.', dest: null }
  await sleep(500)
  const info = await runAx(['focus-info'])
  if (!isNotesBundle(info.bundle) && !/notes/i.test(info.app)) {
    return {
      ok: true,
      reason: 'Notes opened. Click into the note body, then say “Paste now”.',
      dest: {
        kind: 'notes',
        appName: 'Notes',
        bundleId: 'com.apple.Notes',
        pid: info.pid || 0,
        fieldSig: '',
        fieldRole: '',
        label: 'Notes',
        capturedAt: Date.now(),
        verified: false,
        source: 'observed',
        secure: false
      }
    }
  }
  return {
    ok: true,
    reason: info.editable ? '' : 'Notes is open. Click into a note if needed.',
    dest: axToDest(info, 'notes', 'Notes')
  }
}

function bundlesCompatible(expected: string, actual: string): boolean {
  if (expected === actual) return true
  if (isChatGptBundle(expected) && isChatGptBundle(actual)) return true
  if (isChromeBundle(expected) && isChromeBundle(actual)) return true
  if (isNotesBundle(expected) && isNotesBundle(actual)) return true
  return false
}

function runOpen(args: string[]): Promise<boolean> {
  if (process.platform !== 'darwin') return Promise.resolve(false)
  return new Promise((resolve) => {
    const proc = spawn('/usr/bin/open', args, { shell: false, stdio: 'ignore' })
    proc.once('error', () => resolve(false))
    proc.once('close', (code) => resolve(code === 0))
  })
}

async function openChrome(): Promise<boolean> {
  return runOpen(['-a', 'Google Chrome'])
}

export function describeTypeResult(result: TypeInsertResult): string {
  if (result.status === 'inserted' && result.verified) {
    return `Inserted into ${destinationSummary(result.destination)} — not sent.`
  }
  if (result.status === 'pasted-unverified') return result.reason || 'Insertion unverified — not sent.'
  if (result.status === 'has-text') return result.reason
  if (result.status === 'secure') return result.reason
  if (result.status === 'switched') return result.reason
  if (result.status === 'cancelled') return 'Cancelled.'
  return result.reason || 'Couldn’t insert.'
}

export function chatgptAppDisplayName(): string {
  const path = findChatGptApp()
  return path ? basename(path, '.app') : 'ChatGPT'
}
