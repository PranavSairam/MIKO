import { readFileSync } from 'fs'
import { join } from 'path'
import { globalShortcut } from 'electron'
import { chooseSummonShortcut, DEFAULT_SUMMON_SHORTCUT } from '../shared/shortcut'

export interface SummonShortcut {
  detail: string
  unregister: () => void
}

export function registerSummonShortcut(userData: string, onToggle: () => void): SummonShortcut {
  let configured: unknown
  let unreadable = false
  try {
    const raw = readFileSync(join(userData, 'miko-settings.json'), 'utf8')
    configured = (JSON.parse(raw) as { summonShortcut?: unknown }).summonShortcut
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    unreadable = code !== 'ENOENT'
  }

  const chosen = chooseSummonShortcut(configured)
  let active: string | null = null
  const tryRegister = (accelerator: string): boolean => {
    try {
      return globalShortcut.register(accelerator, onToggle)
    } catch {
      return false
    }
  }

  if (tryRegister(chosen.shortcut)) active = chosen.shortcut
  if (!active && chosen.shortcut !== DEFAULT_SUMMON_SHORTCUT && tryRegister(DEFAULT_SUMMON_SHORTCUT)) {
    active = DEFAULT_SUMMON_SHORTCUT
  }

  let detail = active ?? ''
  if (!active) {
    detail = `${chosen.shortcut} is already in use. Use the tray Show and Hide.`
  } else if (chosen.invalid) {
    detail = `${chosen.invalid} Using ${active}.`
  } else if (unreadable) {
    detail = `Could not read summon settings. Using ${active}.`
  } else {
    detail = active
  }

  return {
    detail,
    unregister: () => {
      if (active) globalShortcut.unregister(active)
    }
  }
}
