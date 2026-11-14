export const DEFAULT_SUMMON_SHORTCUT = 'CommandOrControl+Shift+R'

const MODIFIERS = ['CommandOrControl', 'Command', 'Cmd', 'Control', 'Ctrl', 'Alt', 'Option', 'AltGr', 'Shift', 'Super']

const KEYS =
  /^(?:[A-Z0-9]|F(?:[1-9]|1\d|2[0-4])|Plus|Space|Tab|Backspace|Delete|Insert|Return|Enter|Up|Down|Left|Right|Home|End|PageUp|PageDown|Escape)$/

/** Electron accelerator, such as CommandOrControl+Shift+R. */
export function isSummonAccelerator(value: string): boolean {
  const parts = value.split('+')
  if (parts.length < 2) return false
  const key = parts[parts.length - 1] ?? ''
  const modifiers = parts.slice(0, -1)
  if (!KEYS.test(key)) return false
  if (modifiers.length === 0 || modifiers.length > 4) return false
  return modifiers.every((modifier) => MODIFIERS.includes(modifier))
}

export function chooseSummonShortcut(configured: unknown): { shortcut: string; invalid: string | null } {
  if (configured === undefined || configured === null) {
    return { shortcut: DEFAULT_SUMMON_SHORTCUT, invalid: null }
  }
  if (typeof configured !== 'string' || !isSummonAccelerator(configured)) {
    const shown = typeof configured === 'string' ? configured : ''
    return {
      shortcut: DEFAULT_SUMMON_SHORTCUT,
      invalid: shown ? `Ignored invalid summon shortcut "${shown}".` : 'Ignored invalid summon shortcut.'
    }
  }
  return { shortcut: configured, invalid: null }
}
