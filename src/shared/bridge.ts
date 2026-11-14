/**
 * ChatGPT bridge proof of concept: parsing `codex exec --json` events.
 * The supported interface is OpenAI's Codex CLI (bundled in ChatGPT.app,
 * signed in with ChatGPT); the ChatGPT window itself is never automated.
 */

export const BRIDGE_TEST_PROMPT = 'Reply with MIKO bridge test'

export interface BridgeState {
  thread: string
  reply: string
  completed: boolean
  error: string
}

export function emptyBridge(): BridgeState {
  return { thread: '', reply: '', completed: false, error: '' }
}

/** Fold one JSON Lines event into the state. Unknown or malformed lines are ignored. */
export function readBridgeEvent(state: BridgeState, line: string): BridgeState {
  let event: Record<string, unknown>
  try {
    const parsed: unknown = JSON.parse(line)
    if (!parsed || typeof parsed !== 'object') return state
    event = parsed as Record<string, unknown>
  } catch {
    return state
  }
  const type = event.type
  if (type === 'thread.started' && typeof event.thread_id === 'string') return { ...state, thread: event.thread_id }
  if (type === 'item.completed') {
    const item = event.item as { type?: unknown; text?: unknown } | undefined
    if (item?.type === 'agent_message' && typeof item.text === 'string') return { ...state, reply: item.text }
    return state
  }
  if (type === 'turn.completed') return { ...state, completed: true }
  if (type === 'turn.failed' || type === 'error') {
    const err = event.error as { message?: unknown } | undefined
    const message = typeof err?.message === 'string' ? err.message : typeof event.message === 'string' ? event.message : 'ChatGPT reported an error.'
    return { ...state, error: message.slice(0, 300) }
  }
  return state
}

/** Success needs a completed turn, a reply, and (when one was chosen) the same conversation. */
export function bridgeResult(
  state: BridgeState,
  expectedThread: string | null
): { ok: true; reply: string; thread: string } | { ok: false; reason: string } {
  if (state.error) return { ok: false, reason: state.error }
  if (expectedThread && state.thread && state.thread !== expectedThread) {
    return { ok: false, reason: 'The reply came from a different conversation than the one chosen.' }
  }
  if (!state.completed) return { ok: false, reason: 'The reply hasn’t finished.' }
  if (!state.reply.trim()) return { ok: false, reason: 'No reply text came back.' }
  return { ok: true, reply: state.reply, thread: state.thread }
}

export const MAX_PREFERENCES = 2000

/**
 * The whole system prompt for MIKO's assistant (replaces Codex's agent
 * instructions). Kept small; the assistant gets no tools.
 */
export function assistantInstructions(preferences: string): string {
  const prefs = preferences.replace(/\r/g, '').trim().slice(0, MAX_PREFERENCES)
  const lines = [
    'You are the assistant inside MIKO, a desktop pet on the user\'s Mac.',
    'Answer questions and writing requests directly in plain text. Be concise unless asked for more.',
    'You have no tools: no files, no web browsing, no email, no calendar, and no access to the user\'s ChatGPT chats or ChatGPT memory.',
    'Never invent emails, inbox contents, messages, files, or personal facts. If asked about mail, say MIKO\'s Mail tab shows the real mailbox.',
    'If something needs a tool you don\'t have, say so briefly.'
  ]
  if (prefs) {
    lines.push(
      '',
      'MIKO preferences (things the user explicitly asked MIKO to remember; follow them when relevant):',
      prefs
    )
  }
  return lines.join('\n') + '\n'
}
