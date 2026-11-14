/** Events from the "MIKO Keys" helper (Caps Lock + A hold-to-talk, Tab + Q switcher). */
export type KeyEvent = { kind: 'talk-start' } | { kind: 'talk-stop' } | { kind: 'switcher' } | { kind: 'permission' }

const EVENTS = new Set(['talk-start', 'talk-stop', 'switcher'])

export function parseKeyEvent(line: string): KeyEvent | null {
  let payload: unknown
  try {
    payload = JSON.parse(line)
  } catch {
    return null
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null
  const record = payload as { event?: unknown; error?: unknown }
  if (record.error === 'permission') return { kind: 'permission' }
  if (typeof record.event === 'string' && EVENTS.has(record.event)) {
    return { kind: record.event as 'talk-start' | 'talk-stop' | 'switcher' }
  }
  return null
}
