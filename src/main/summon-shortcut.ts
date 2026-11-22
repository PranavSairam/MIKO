import { globalShortcut } from 'electron'
import { displayAccelerator, type SummonShortcutStatus } from '../shared/setup'
import { isSummonAccelerator, DEFAULT_SUMMON_SHORTCUT } from '../shared/shortcut'
import { logDiag } from './diagnostics'
import { setSummonShortcut, summonShortcut } from './settings'

export interface SummonShortcut {
  readonly detail: string
  status: () => SummonShortcutStatus
  setAccelerator: (accelerator: string) => SummonShortcutStatus
  unregister: () => void
}

function label(accelerator: string): string {
  return displayAccelerator(accelerator, process.platform)
}

export function registerSummonShortcut(_userData: string, onToggle: () => void): SummonShortcut {
  let configured = summonShortcut()
  let active: string | null = null
  let detail = ''
  let presses = 0
  const fire = (): void => {
    presses += 1
    onToggle()
  }
  const tryRegister = (accelerator: string): boolean => {
    let ok = false
    let error = ''
    try {
      ok = globalShortcut.register(accelerator, fire)
    } catch (e) {
      error = String(e)
    }
    // register() returns false when another app already owns the combination.
    logDiag('shortcut', ok ? 'registered' : 'registration failed', {
      accelerator,
      ...(ok ? {} : { owned: globalShortcut.isRegistered(accelerator) ? 'by MIKO' : 'by another app or blocked' }),
      ...(error ? { error } : {})
    })
    return ok
  }

  if (tryRegister(configured)) active = configured
  if (!active && configured !== DEFAULT_SUMMON_SHORTCUT && tryRegister(DEFAULT_SUMMON_SHORTCUT)) {
    active = DEFAULT_SUMMON_SHORTCUT
  }

  if (!active) {
    detail = `${label(configured)} is taken by another app. Pick another shortcut in Setup & Help, or use the tray Show / Hide.`
  } else if (active !== configured) {
    detail = `${label(configured)} is unavailable. Using ${label(active)}.`
  } else {
    detail = label(active)
  }

  const status = (): SummonShortcutStatus => ({
    configured,
    active,
    ok: Boolean(active),
    detail,
    presses
  })

  const controller: SummonShortcut = {
    get detail() {
      return detail
    },
    status,
    setAccelerator: (raw: string): SummonShortcutStatus => {
      const next = raw.trim()
      if (!isSummonAccelerator(next)) {
        detail = `Use modifiers plus a key, like ${label('CommandOrControl+Shift+R')}.`
        return status()
      }
      if (next === active) {
        configured = next
        setSummonShortcut(next)
        detail = label(next)
        return status()
      }
      if (!tryRegister(next)) {
        detail = `${label(next)} is taken by another app. MIKO is still using ${active ? label(active) : 'the tray'}.`
        return status()
      }
      if (active) globalShortcut.unregister(active)
      active = next
      configured = next
      setSummonShortcut(next)
      detail = label(next)
      return status()
    },
    unregister: () => {
      if (active) globalShortcut.unregister(active)
      active = null
    }
  }
  return controller
}
