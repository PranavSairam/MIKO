import { existsSync, unlinkSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { app, shell } from 'electron'
import { diagnosticsPath, logDiag } from './diagnostics'

/**
 * Optional per-user conveniences for the installed Windows app: start MIKO when you sign in,
 * and a desktop shortcut. Neither is on by default; both are the owner's choice in
 * Help & Setup. No admin rights, no system settings, nothing outside this user's account.
 */

export interface SystemOptions {
  launchAtLogin: boolean
  desktopShortcut: boolean
  canLaunchAtLogin: boolean
  canDesktopShortcut: boolean
  /** Why an option isn't available (development build, platform). */
  detail: string
}

function desktopLink(): string {
  return join(app.getPath('desktop'), 'MIKO.lnk')
}

export function systemOptions(): SystemOptions {
  const packaged = app.isPackaged
  const win = process.platform === 'win32'
  let launchAtLogin = false
  try {
    launchAtLogin = packaged && app.getLoginItemSettings().openAtLogin
  } catch {
    launchAtLogin = false
  }
  let desktopShortcut = false
  try {
    desktopShortcut = win && existsSync(desktopLink())
  } catch {
    desktopShortcut = false
  }
  return {
    launchAtLogin,
    desktopShortcut,
    canLaunchAtLogin: packaged && (win || process.platform === 'darwin'),
    canDesktopShortcut: packaged && win,
    detail: packaged ? '' : 'These options work in the installed app, not in a development build.'
  }
}

export function setSystemOptions(next: { launchAtLogin?: boolean; desktopShortcut?: boolean }): SystemOptions & { reason: string } {
  const before = systemOptions()
  let reason = ''
  if (typeof next.launchAtLogin === 'boolean') {
    if (!before.canLaunchAtLogin) reason = before.detail || 'Start at sign-in isn’t available here.'
    else {
      try {
        app.setLoginItemSettings({ openAtLogin: next.launchAtLogin })
        logDiag('setup', 'launch at login', { on: next.launchAtLogin })
      } catch (error) {
        reason = 'Windows didn’t accept the start-at-sign-in setting.'
        logDiag('setup', 'launch at login failed', { error: String(error).slice(0, 200) })
      }
    }
  }
  if (typeof next.desktopShortcut === 'boolean') {
    if (!before.canDesktopShortcut) reason = before.detail || 'Desktop shortcuts are for the installed Windows app.'
    else {
      const link = desktopLink()
      try {
        if (next.desktopShortcut) {
          const ok = shell.writeShortcutLink(link, existsSync(link) ? 'replace' : 'create', {
            target: process.execPath,
            cwd: dirname(process.execPath),
            description: 'MIKO desktop companion',
            icon: process.execPath,
            iconIndex: 0
          })
          if (!ok) reason = 'Windows didn’t create the desktop shortcut.'
        } else if (existsSync(link)) {
          unlinkSync(link)
        }
        logDiag('setup', 'desktop shortcut', { on: next.desktopShortcut, ok: !reason })
      } catch (error) {
        reason = 'Couldn’t change the desktop shortcut.'
        logDiag('setup', 'desktop shortcut failed', { error: String(error).slice(0, 200) })
      }
    }
  }
  return { ...systemOptions(), reason }
}

/** Show MIKO's troubleshooting log in Explorer / Finder (nobody has to find AppData by hand). */
export async function openLogsFolder(): Promise<boolean> {
  try {
    const log = diagnosticsPath()
    if (existsSync(log)) {
      shell.showItemInFolder(log)
      return true
    }
    return (await shell.openPath(app.getPath('userData'))) === ''
  } catch {
    return false
  }
}
