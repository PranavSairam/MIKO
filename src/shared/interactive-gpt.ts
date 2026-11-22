/**
 * Local controls for the Interactive GPT / ChatGPT Web workspace.
 * Distinct from GPT Mode (forwarding) and Lens (mirror).
 */

export type InteractiveGptLocalAction = 'open' | 'show' | 'hide' | 'dictate' | 'stop-dictate' | null

/**
 * Whole-utterance workspace controls only.
 * Skips quoted / “type exactly …” bodies so prompts are not intercepted.
 * “Dictate into GPT: …” with a body is handled by type-in-gpt, not here.
 */
export function parseInteractiveGptLocalAction(raw: string): InteractiveGptLocalAction {
  const t = raw
    .trim()
    .replace(/[.!,]+$/g, '')
    .replace(/^(?:ok(?:ay)?|please)\s+/i, '')
    .trim()
  if (!t) return null
  // Literal / quoted prompt text — never treat as a workspace control.
  if (/^type\s+exactly\b/i.test(t)) return null
  if (/^(?:["'`“‘]).+(?:["'`”’])$/s.test(t)) return null
  if (/^(?:ask|tell|say|write|prompt|draft)\b/i.test(t) && /interactive\s+gpt|chatgpt\s+web/i.test(t)) {
    return null
  }
  // “Dictate into GPT: hello” has a body → leave for type-in-gpt / router.
  if (/^(?:dictate|type|write)\s+(?:in|into)\s+(?:interactive\s+gpt|chatgpt\s+web|chat\s*-?\s*gpt|gpt)\s*[:,\-]/i.test(t)) {
    return null
  }

  // Dictation spells it out: “interactive G P T”, “interactive g.p.t.”, “interactive chat GPT”.
  const w = normalizeGptWords(t)
  const target = '(?:the\\s+)?(?:interactive\\s+(?:gpt|chatgpt)|chatgpt\\s+web)(?:\\s+(?:window|workspace))?'
  if (new RegExp(`^(?:hide|collapse)\\s+${target}$`, 'i').test(w)) return 'hide'
  if (new RegExp(`^show\\s+${target}$`, 'i').test(w)) return 'show'
  if (new RegExp(`^(?:open|launch|start|bring\\s+up)\\s+${target}$`, 'i').test(w)) return 'open'
  if (new RegExp(`^${target}$`, 'i').test(w)) return 'open'
  if (
    /^(?:dictate|start\s+dictating)(?:\s+to|\s+into)?\s+(?:interactive\s+gpt|chatgpt\s+web|chat\s*-?\s*gpt|gpt)$/i.test(t) ||
    /^dictate\s+to\s+gpt$/i.test(t)
  ) {
    return 'dictate'
  }
  if (
    /^(?:stop|cancel)\s+dictat(?:e|ing)(?:\s+to|\s+into)?\s+(?:interactive\s+gpt|chatgpt\s+web|chat\s*-?\s*gpt|gpt)?$/i.test(
      t
    ) ||
    /^stop\s+dictating$/i.test(t)
  ) {
    return 'stop-dictate'
  }
  return null
}

/** Joins spelled-out “G P T” / “g.p.t.” and “chat gpt” so voice and typing match the same phrases. */
export function normalizeGptWords(text: string): string {
  return text
    .toLowerCase()
    .replace(/\bg\s*\.?\s*p\s*\.?\s*t\b\.?/g, 'gpt')
    .replace(/\bchat\s*-?\s*gpt\b/g, 'chatgpt')
    .replace(/\s+/g, ' ')
    .trim()
}

export function isInteractiveGptLocalControl(raw: string): boolean {
  return parseInteractiveGptLocalAction(raw) !== null
}
