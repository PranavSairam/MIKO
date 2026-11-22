import { globalShortcut, ipcMain } from 'electron'
import { IPC } from '../shared/api'
import { isSummonAccelerator } from '../shared/shortcut'
import { isTrustedSender, postToPet } from './pet-window'
import { captureSelection, PASTE_CONFIRM } from './selection'
import { selectionShortcut, setSelectionShortcut } from './settings'

/**
 * Selection-assistant shortcut (default ⌃⌥S, configurable in MIKO preferences).
 * Captures first, while the other app still has focus, then shows MIKO.
 */
export function startSelectionShortcut(show: () => void): () => void {
  let active = ''
  let busy = false
  const onPress = async (): Promise<void> => {
    if (busy) return
    busy = true
    try {
      const event = await captureSelection()
      show()
      postToPet(IPC.selection, event)
    } finally {
      busy = false
    }
  }
  const register = (accelerator: string): boolean => {
    if (process.platform !== 'darwin') return false
    try {
      return globalShortcut.register(accelerator, () => void onPress())
    } catch {
      return false
    }
  }
  const wanted = selectionShortcut()
  if (process.platform === 'darwin' && register(wanted)) active = wanted

  ipcMain.handle(IPC.selectionShortcutGet, (event) => {
    if (!isTrustedSender(event.sender.id)) return ''
    return process.platform === 'darwin' ? active : ''
  })
  ipcMain.handle(IPC.selectionShortcutSet, (event, value: unknown) => {
    if (!isTrustedSender(event.sender.id) || typeof value !== 'string') return { ok: false, reason: 'Not allowed.', shortcut: active }
    if (process.platform !== 'darwin') {
      return {
        ok: false,
        reason: 'Selected-text shortcuts are available on macOS only.',
        shortcut: ''
      }
    }
    const next = value.trim()
    if (!isSummonAccelerator(next)) return { ok: false, reason: 'Use modifiers plus a key, like Control+Option+S.', shortcut: active }
    if (next === PASTE_CONFIRM) return { ok: false, reason: `${PASTE_CONFIRM} is MIKO’s paste confirmation.`, shortcut: active }
    if (next === active) return { ok: true, reason: '', shortcut: active }
    if (!register(next)) return { ok: false, reason: `${next} is in use by another app.`, shortcut: active }
    if (active) globalShortcut.unregister(active)
    active = next
    setSelectionShortcut(next)
    return { ok: true, reason: '', shortcut: active }
  })
  return () => {
    if (active) globalShortcut.unregister(active)
  }
}
