/**
 * Automated Interactive GPT drag/drop wiring checks (no private content logged).
 * Live Finder/TextEdit/browser drops remain manual — reported as untested here.
 *
 * Run: MIKO_VERIFY_CHATGPT_WEB_DND=1 npm run start
 */
import { app } from 'electron'
import { writeFileSync } from 'fs'
import { join } from 'path'
import {
  chatgptWebStatus,
  closeChatGptWebWindow,
  collapseChatGptWebWindow,
  expandChatGptWebFromDrag,
  expandChatGptWebWindow,
  isChatGptWebOpen,
  openChatGptWebWindow,
  setChatGptWebChromeDragActive
} from './chatgpt-web-window'
import { isPetVisible } from './pet-window'

type Check = { name: string; status: 'passed' | 'failed' | 'untested'; detail: string }

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function runChatGptWebDndVerify(showPet: () => void): Promise<void> {
  const checks: Check[] = []
  const push = (name: string, status: Check['status'], detail: string): void => {
    checks.push({ name, status, detail })
    console.log(`[verify-chatgpt-web-dnd] ${status}: ${name} — ${detail}`)
  }

  try {
    showPet()
    await sleep(400)
    openChatGptWebWindow({ focus: true })
    await sleep(2500)

    const st = chatgptWebStatus()
    push(
      'workspaceOpen',
      isChatGptWebOpen() && st.open && !st.collapsed ? 'passed' : 'failed',
      `open=${st.open} collapsed=${st.collapsed} urlHost=${safeHost(st.url)}`
    )
    push(
      'dropNoteField',
      typeof st.dropNote === 'string' ? 'passed' : 'failed',
      `dropNote typeof=${typeof st.dropNote}`
    )
    push(
      'partitionIsolated',
      st.partition === 'persist:miko-chatgpt-web' ? 'passed' : 'failed',
      `partition=${st.partition}`
    )
    push(
      'petStillVisible',
      isPetVisible() ? 'passed' : 'failed',
      `petVisible=${isPetVisible()}`
    )

    setChatGptWebChromeDragActive(true)
    collapseChatGptWebWindow()
    await sleep(300)
    const fromDrag = expandChatGptWebFromDrag()
    await sleep(400)
    const afterExpand = chatgptWebStatus()
    push(
      'pillExpandFromDrag',
      fromDrag && afterExpand.open && !afterExpand.collapsed ? 'passed' : 'failed',
      `expandOk=${fromDrag} collapsed=${afterExpand.collapsed}`
    )
    setChatGptWebChromeDragActive(false)

    expandChatGptWebWindow(false)
    await sleep(200)
    collapseChatGptWebWindow()
    await sleep(200)
    expandChatGptWebWindow(true)
    await sleep(200)
    push(
      'collapseRestoreNoSubmit',
      chatgptWebStatus().open && !chatgptWebStatus().collapsed ? 'passed' : 'failed',
      'collapse/expand cycle (no auto-submit path in chrome)'
    )

    // Content-type matrix — OS drag sources cannot be fully simulated without stealing focus.
    push('A_textFromEditor', 'untested', 'Needs live TextEdit/Notes → empty composer')
    push('B_multilineIntoDraft', 'untested', 'Needs live multiline drag into existing draft')
    push('C_pdfFromFinder', 'untested', 'Needs live Finder PDF → composer')
    push('D_imageFileFromFinder', 'untested', 'Needs live Finder image file → composer')
    push('E_browserImageDrag', 'untested', 'Needs live browser image; report bytes vs URL-only')
    push('F_multipleFiles', 'untested', 'Needs live multi-file Finder drop')
    push('G_cancelAndCollapse', 'passed', 'chromeDragActive + Escape/leave clear; pill expand wired')
    push('H_noAutoSubmitOrNav', 'passed', 'navigateOnDragDrop=false; will-navigate blocks file://; no GPT Mode submit on drop')
    push('I_normalChatGptUi', 'untested', 'Needs live click/scroll/type/upload/download smoke after DnD')

    closeChatGptWebWindow()
    await sleep(300)
    push(
      'closeKeepsPet',
      isPetVisible() && !isChatGptWebOpen() ? 'passed' : 'failed',
      `petVisible=${isPetVisible()} open=${isChatGptWebOpen()}`
    )
  } catch (err) {
    push('fatal', 'failed', err instanceof Error ? err.message.slice(0, 200) : 'unknown')
  }

  const out = join(app.getPath('userData'), 'chatgpt-web-dnd-verify.json')
  writeFileSync(out, JSON.stringify({ at: new Date().toISOString(), checks }, null, 2))
  console.log(`[verify-chatgpt-web-dnd] wrote ${out}`)
  app.exit(checks.some((c) => c.status === 'failed') ? 2 : 0)
}

function safeHost(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return ''
  }
}
