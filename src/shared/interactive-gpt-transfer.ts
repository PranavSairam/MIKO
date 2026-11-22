/**
 * Local transfer actions: clipboard / selected WhatsApp text → Interactive GPT composer.
 * Never treats transferred text as a MIKO command; never auto-submits.
 */

export type InteractiveGptTransferAction = 'paste-clipboard' | 'wa-message-to-gpt' | null

/**
 * Whole-utterance transfer controls only.
 * Skips quoted / “type exactly …” bodies so message text is not intercepted as a command.
 */
export function parseInteractiveGptTransferAction(raw: string): InteractiveGptTransferAction {
  const t = raw
    .trim()
    .replace(/[.!,]+$/g, '')
    .replace(/^(?:ok(?:ay)?|please)\s+/i, '')
    .trim()
  if (!t) return null
  if (/^type\s+exactly\b/i.test(t)) return null
  if (/^(?:["'`“‘]).+(?:["'`”’])$/s.test(t)) return null

  if (
    /^(?:paste|put|insert)\s+(?:the\s+)?(?:clipboard|pasteboard)(?:\s+text)?\s+into\s+(?:interactive\s+gpt|chatgpt\s+web|gpt|chatgpt)$/i.test(
      t
    ) ||
    /^(?:paste|put|insert)\s+(?:clipboard|pasteboard)\s+(?:into\s+)?(?:interactive\s+gpt|chatgpt\s+web|gpt)$/i.test(t) ||
    /^paste\s+clipboard\s+into\s+gpt$/i.test(t)
  ) {
    return 'paste-clipboard'
  }

  if (
    /^(?:copy|send|transfer|move)\s+this\s+(?:whatsapp\s+)?message\s+(?:to|into)\s+(?:interactive\s+gpt|chatgpt\s+web|gpt|chatgpt)$/i.test(
      t
    ) ||
    /^copy\s+this\s+whatsapp\s+message\s+to\s+gpt$/i.test(t) ||
    /^(?:copy|transfer)\s+(?:the\s+)?(?:selected\s+)?(?:whatsapp\s+)?(?:message\s+)?(?:text\s+)?to\s+(?:interactive\s+gpt|gpt)$/i.test(
      t
    )
  ) {
    return 'wa-message-to-gpt'
  }

  return null
}

export function isInteractiveGptTransferControl(raw: string): boolean {
  return parseInteractiveGptTransferAction(raw) !== null
}

/** True when a selection capture is usable as an explicit WhatsApp (or any) message source. */
export function selectionUsableForGptTransfer(sel: {
  ok: boolean
  text: string
  app?: string
} | null): boolean {
  return Boolean(sel && sel.ok && sel.text.trim())
}

export function looksLikeWhatsAppApp(app: string): boolean {
  return /whatsapp/i.test(app || '')
}
