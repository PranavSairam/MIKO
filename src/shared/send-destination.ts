/**
 * Resolve “Send it” to a fresh, explicit draft destination.
 * Workspace visibility alone never establishes a target.
 * Completed WhatsApp history / assistant prose never resurrect a send destination.
 */

/** Last MIKO-mediated insert into Interactive GPT (not page typing / native drops). */
export interface InteractiveGptDraftBinding {
  /** Text MIKO last inserted (fingerprint for change detection). */
  expectedText: string
  insertedAt: number
  /** Guest session partition id (workspace identity). */
  partition: string
  source: 'dictate' | 'type-in-gpt' | 'paste-clipboard' | 'transfer'
  /** Bumped on cancel / source change — stale submits must no-op. */
  generation: number
  status: 'pending' | 'submitted' | 'cancelled'
}

export type SendDestinationDecision =
  | { kind: 'interactive-gpt'; binding: InteractiveGptDraftBinding }
  | {
      kind: 'whatsapp-unsent'
      chatName: string
      /** WhatsApp stays insert-only — tell the owner to press Send themselves. */
      reason: string
    }
  | {
      kind: 'clarify'
      question: string
      options: { id: 'chatgpt' | 'whatsapp'; name: string }[]
    }
  | { kind: 'none'; reason: string }

export const GPT_DRAFT_BINDING_TTL_MS = 60 * 60 * 1000

export function normalizeDraftFingerprint(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

export function gptDraftBindingFresh(
  binding: InteractiveGptDraftBinding | null | undefined,
  now = Date.now(),
  maxAge = GPT_DRAFT_BINDING_TTL_MS
): binding is InteractiveGptDraftBinding {
  if (!binding || binding.status !== 'pending') return false
  if (!binding.partition || !binding.expectedText.trim()) return false
  return now - binding.insertedAt >= 0 && now - binding.insertedAt <= maxAge
}

/**
 * Pick where “Send it” should go from live snapshot facts only.
 * Does not read assistant message bodies or completed task summaries.
 */
export function resolveSendDestination(input: {
  gptBinding: InteractiveGptDraftBinding | null | undefined
  /** Live unsent WhatsApp draft in the current workflow (not history). */
  waDraftActive: boolean
  waDraftChat?: string | null
  now?: number
}): SendDestinationDecision {
  const now = input.now ?? Date.now()
  const gpt = gptDraftBindingFresh(input.gptBinding, now) ? input.gptBinding : null
  const waActive = input.waDraftActive === true
  const waChat = (input.waDraftChat || '').trim()

  if (gpt && waActive) {
    return {
      kind: 'clarify',
      question: 'Send in ChatGPT or WhatsApp?',
      options: [
        { id: 'chatgpt', name: 'ChatGPT' },
        { id: 'whatsapp', name: 'WhatsApp' }
      ]
    }
  }

  if (gpt) {
    return { kind: 'interactive-gpt', binding: gpt }
  }

  if (waActive) {
    return {
      kind: 'whatsapp-unsent',
      chatName: waChat || 'WhatsApp',
      reason:
        waChat
          ? `The draft for “${waChat}” is ready in WhatsApp and stays unsent — press Send there when you want it delivered.`
          : 'The WhatsApp draft is ready and stays unsent — press Send in WhatsApp when you want it delivered.'
    }
  }

  return {
    kind: 'none',
    reason:
      'Nothing to send — dictate or type into GPT first, or finish a WhatsApp draft. Opening Interactive GPT alone isn’t enough.'
  }
}

/** Compare live composer text to the bound insert fingerprint. */
export function composerMatchesBinding(
  composerText: string,
  binding: InteractiveGptDraftBinding
): 'empty' | 'match' | 'changed' {
  const live = normalizeDraftFingerprint(composerText)
  if (!live) return 'empty'
  const expected = normalizeDraftFingerprint(binding.expectedText)
  if (!expected) return 'match'
  // Append-style inserts: composer may contain prior draft + our text.
  if (live === expected || live.endsWith(expected) || live.includes(expected)) return 'match'
  return 'changed'
}

export function isSendItPhrase(raw: string): boolean {
  const t = raw
    .trim()
    .replace(/[.!,?]+$/g, '')
    .replace(/^(?:ok(?:ay)?|please|alright|sure)\s+/i, '')
    .trim()
  if (!t) return false
  // Bare send/submit of the current draft — not “send that to Dad” / “send the file”.
  return /^(?:send(?:\s+it)?|submit(?:\s+it)?|send\s+this(?:\s+draft)?|submit\s+this(?:\s+draft)?|send\s+the\s+draft|submit\s+the\s+draft)$/i.test(
    t
  )
}
