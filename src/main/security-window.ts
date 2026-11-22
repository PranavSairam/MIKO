/**
 * Harden BrowserWindows for packaged beta builds.
 * Disabling DevTools is not an anti-tamper claim — it only removes casual developer controls.
 */

import { app, type BrowserWindow } from 'electron'

export function hardenWindow(win: BrowserWindow): void {
  if (!app.isPackaged) return
  win.webContents.on('before-input-event', (event, input) => {
    const key = input.key?.toLowerCase?.() || ''
    const openDev =
      (input.meta || input.control) && input.alt && (key === 'i' || key === 'j') ||
      key === 'f12'
    if (openDev) event.preventDefault()
  })
  win.webContents.on('devtools-opened', () => {
    try {
      win.webContents.closeDevTools()
    } catch {
      // Ignore.
    }
  })
}
