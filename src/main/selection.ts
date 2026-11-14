import { randomUUID } from 'node:crypto'
import { clipboard, globalShortcut } from 'electron'
import { IPC } from '../shared/api'
import { MAX_SELECTION } from '../shared/selection'
import { runAx } from './ax'
import { postToPet } from './pet-window'

/**
 * Selected-text assistant (macOS).
 * - Capture runs before MIKO shows itself, so the other app keeps focus.
 * - The original app/field/selection are remembered in the main process only;
 *   the renderer gets an opaque capture id.
 * - "Paste where I click" is an explicit armed state with a confirm shortcut,
 *   Esc to cancel, and a timeout. It pastes once, into a verified field.
 */

export const PASTE_CONFIRM = 'Control+Option+V'
const ARM_MS = 30_000

interface Capture {
  pid: number
  sig: string
  hash: string
  method: string
  app: string
}

const captures = new Map<string, Capture>()

export interface SelectionEvent {
  captureId: string
  ok: boolean
  text: string
  app: string
  method: string
  canReplace: boolean
  reason: string
}

export async function captureSelection(): Promise<SelectionEvent> {
  const result = await runAx(['capture'])
  const captureId = randomUUID()
  if (result.pid === process.pid) {
    return { captureId, ok: false, text: '', app: 'MIKO', method: '', canReplace: false, reason: 'Select text in another app first, then press the shortcut.' }
  }
  if (!result.ok || !result.text) {
    return { captureId, ok: false, text: '', app: result.app, method: '', canReplace: false, reason: result.reason || 'No selected text found.' }
  }
  const text = result.text.slice(0, MAX_SELECTION)
  const canReplace = result.editable && !result.secure
  captures.set(captureId, { pid: result.pid, sig: result.sig, hash: result.hash, method: result.method, app: result.app })
  while (captures.size > 10) captures.delete(captures.keys().next().value as string)
  return { captureId, ok: true, text, app: result.app, method: result.method, canReplace, reason: '' }
}

/** Clipboard text as a selection with no target (Replace is unavailable). */
export async function clipboardSelection(): Promise<SelectionEvent> {
  const text = String(await clipboard.readText()).slice(0, MAX_SELECTION)
  return {
    captureId: randomUUID(),
    ok: Boolean(text.trim()),
    text,
    app: 'Clipboard',
    method: 'clipboard',
    canReplace: false,
    reason: text.trim() ? '' : 'The clipboard has no text.'
  }
}

/** Replace the captured selection after re-verifying app, field and selection. */
export async function replaceSelection(captureId: string, text: string): Promise<{ ok: boolean; reason: string; verified: boolean }> {
  const capture = captures.get(captureId)
  if (!capture) return { ok: false, reason: 'That selection isn’t available any more. Select the text again.', verified: false }
  const result = await runAx(['replace', '--pid', String(capture.pid), '--sig', capture.sig, '--hash', capture.hash, '--method', capture.method], text, 12000)
  if (!result.ok) return { ok: false, reason: result.reason || 'Couldn’t replace the selection.', verified: false }
  captures.delete(captureId)
  return { ok: true, reason: '', verified: result.verified }
}

// ---------- Paste where I click ----------

let armed: { text: string; timer: NodeJS.Timeout } | null = null

function post(state: 'armed' | 'done' | 'cancelled' | 'expired' | 'failed', reason = '', verified = false): void {
  postToPet(IPC.pasteState, { state, reason, verified })
}

function unregister(): void {
  globalShortcut.unregister(PASTE_CONFIRM)
  globalShortcut.unregister('Escape')
}

export function disarmPaste(state: 'cancelled' | 'expired' = 'cancelled', reason = ''): void {
  if (!armed) return
  clearTimeout(armed.timer)
  armed = null
  unregister()
  post(state, reason)
}

export function armPaste(text: string): { ok: boolean; reason: string } {
  disarmPaste()
  if (!text.trim()) return { ok: false, reason: 'Nothing to paste.' }
  const timer = setTimeout(() => disarmPaste('expired', 'Paste expired. Arm it again if you still want it.'), ARM_MS)
  armed = { text, timer }
  const okConfirm = globalShortcut.register(PASTE_CONFIRM, () => void confirmPaste())
  globalShortcut.register('Escape', () => disarmPaste('cancelled', 'Paste cancelled.'))
  if (!okConfirm) {
    disarmPaste('cancelled', `${PASTE_CONFIRM} is in use by another app.`)
    return { ok: false, reason: `${PASTE_CONFIRM} is in use by another app.` }
  }
  post('armed')
  return { ok: true, reason: '' }
}

async function confirmPaste(): Promise<void> {
  if (!armed) return
  const { text, timer } = armed
  clearTimeout(timer)
  armed = null
  unregister()
  const result = await runAx(['paste', '--exclude-pid', String(process.pid)], text, 10000)
  if (result.ok) post('done', `Pasted into ${result.app}${result.verified ? ' and checked' : ''}. Sending is up to you.`, result.verified)
  else post('failed', result.reason || 'Couldn’t paste there.')
}
