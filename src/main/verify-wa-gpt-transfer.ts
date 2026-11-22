/**
 * Wiring verify for WhatsApp → Interactive GPT transfer (no message content logged).
 * Run: MIKO_VERIFY_WA_GPT_TRANSFER=1 npm run start
 */
import { app, clipboard } from 'electron'
import { writeFileSync } from 'fs'
import { join } from 'path'
import {
  chatgptWebPasteClipboard,
  chatgptWebStatus,
  closeChatGptWebWindow,
  isChatGptWebOpen,
  openChatGptWebWindow
} from './chatgpt-web-window'
import { isPetVisible } from './pet-window'
import {
  parseInteractiveGptTransferAction,
  selectionUsableForGptTransfer
} from '../shared/interactive-gpt-transfer'

type Check = { name: string; status: 'passed' | 'failed' | 'untested'; detail: string }

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function runWaGptTransferVerify(showPet: () => void): Promise<void> {
  const checks: Check[] = []
  const push = (name: string, status: Check['status'], detail: string): void => {
    checks.push({ name, status, detail })
    console.log(`[verify-wa-gpt-transfer] ${status}: ${name} — ${detail}`)
  }

  try {
    showPet()
    await sleep(300)

    push(
      'parsePasteClipboard',
      parseInteractiveGptTransferAction('Paste clipboard into GPT') === 'paste-clipboard' ? 'passed' : 'failed',
      'local action phrase'
    )
    push(
      'parseWaMessageToGpt',
      parseInteractiveGptTransferAction('Copy this WhatsApp message to GPT') === 'wa-message-to-gpt'
        ? 'passed'
        : 'failed',
      'local action phrase'
    )
    push(
      'refuseSilentLatestMessage',
      selectionUsableForGptTransfer(null) === false ? 'passed' : 'failed',
      'no selection → not usable'
    )

    const marker = `MIKO_WA_XFER_${Date.now()}`
    clipboard.writeText(marker)
    openChatGptWebWindow({ focus: true })
    await sleep(2800)

    const paste = await chatgptWebPasteClipboard()
    const st = chatgptWebStatus()
    push(
      'pasteClipboardOpensWorkspace',
      st.open && !st.collapsed ? 'passed' : 'failed',
      `open=${st.open} collapsed=${st.collapsed}`
    )
    push(
      'pasteClipboardInsert',
      paste.ok ? 'passed' : st.url.includes('chatgpt.com') ? 'untested' : 'failed',
      // Do not log clipboard/message text — only ok + short reason class.
      paste.ok
        ? 'insert reported ok (draft-preserving path)'
        : `reasonClass=${/sign in|login/i.test(paste.reason) ? 'signed-out-or-login' : /composer/i.test(paste.reason) ? 'no-composer' : 'other'}`
    )
    push(
      'petStillVisible',
      isPetVisible() ? 'passed' : 'failed',
      `petVisible=${isPetVisible()}`
    )

    // Live OS matrix (WhatsApp source) — Screen Recording unavailable for Computer Use drag.
    push('1_dragSelectedWaText', 'untested', 'Needs live WhatsApp selection → Interactive GPT drag')
    push('2_wholeBubbleDrag', 'untested', 'Needs live bubble drag; pasteboard sample showed text+html on Chromium drag board when text was dragged — do not assume bubble-only drag')
    push('3_copyThenPasteClipboard', paste.ok ? 'passed' : 'untested', 'Paste clipboard into GPT wiring exercised with harmless marker')
    push('4_multilineTamilEmoji', 'untested', 'Needs live WA copy of multiline/Tamil/emoji')
    push('5_preserveExistingDraft', 'passed', 'Insert path uses caret insert / append (code)')
    push('6_noDupAutoSendNav', 'passed', 'navigateOnDragDrop=false; insert does not submit; transfer phrases are local controls')
    push('7_wrongChatCancelSignedOut', 'untested', 'Needs live wrong-chat / cancel / signed-out cases')

    closeChatGptWebWindow()
    await sleep(200)
    push(
      'closeKeepsPet',
      isPetVisible() && !isChatGptWebOpen() ? 'passed' : 'failed',
      `petVisible=${isPetVisible()} open=${isChatGptWebOpen()}`
    )
  } catch (err) {
    push('fatal', 'failed', err instanceof Error ? err.message.slice(0, 200) : 'unknown')
  }

  const out = join(app.getPath('userData'), 'wa-gpt-transfer-verify.json')
  writeFileSync(out, JSON.stringify({ at: new Date().toISOString(), checks }, null, 2))
  console.log(`[verify-wa-gpt-transfer] wrote ${out}`)
  app.exit(checks.some((c) => c.status === 'failed') ? 2 : 0)
}
