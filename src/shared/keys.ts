/** Events from the "MIKO Keys" helper (Caps Lock + A hold-to-talk, Tab + Q switcher). */
export type KeyEvent =
  | { kind: 'talk-start' }
  | { kind: 'talk-stop' }
  /** front: pid of the app in front when Tab + Q was pressed (closing the fan returns there). */
  | { kind: 'switcher'; front?: number }
  | { kind: 'permission' }

const EVENTS = new Set(['talk-start', 'talk-stop', 'switcher'])

export function parseKeyEvent(line: string): KeyEvent | null {
  let payload: unknown
  try {
    payload = JSON.parse(line)
  } catch {
    return null
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null
  const record = payload as { event?: unknown; error?: unknown; front?: unknown }
  if (record.error === 'permission') return { kind: 'permission' }
  if (record.event === 'switcher') {
    const front = record.front
    return typeof front === 'number' && Number.isInteger(front) && front > 0 ? { kind: 'switcher', front } : { kind: 'switcher' }
  }
  if (typeof record.event === 'string' && EVENTS.has(record.event)) {
    return { kind: record.event as 'talk-start' | 'talk-stop' }
  }
  return null
}
