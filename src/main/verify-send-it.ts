/**
 * Live probe: insert harmless text into Interactive GPT, submit once, report status.
 * Run: MIKO_VERIFY_SEND_IT=1 npm run start
 */
import { app } from 'electron'
import { writeFileSync } from 'fs'
import { join } from 'path'
import {
  chatgptWebInsertTranscript,
  chatgptWebSubmitCurrentDraft,
  cancelChatGptWebSubmit,
  chatgptWebSubmitGeneration,
  openChatGptWebWindow,
  closeChatGptWebWindow,
  chatgptWebStatus
} from './chatgpt-web-window'
import { resolveSendDestination, type InteractiveGptDraftBinding } from '../shared/send-destination'

type Check = { name: string; status: 'passed' | 'failed' | 'untested'; detail: string }

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

export async function runSendItVerify(showPet: () => void): Promise<void> {
  const checks: Check[] = []
  const push = (name: string, status: Check['status'], detail: string): void => {
    checks.push({ name, status, detail })
    console.log(`[verify-send-it] ${status}: ${name} — ${detail}`)
  }

  const marker = `MIKO send-it verify ${Date.now()}`

  try {
    showPet()
    await sleep(600)

    // Pure resolver regressions (same as unit tests — live confirm wiring).
    const binding: InteractiveGptDraftBinding = {
      expectedText: marker,
      insertedAt: Date.now(),
      partition: 'persist:miko-chatgpt-web',
      source: 'type-in-gpt',
      generation: 1,
      status: 'pending'
    }
    const gptOnly = resolveSendDestination({ gptBinding: binding, waDraftActive: false })
    push('resolverGptOnly', gptOnly.kind === 'interactive-gpt' ? 'passed' : 'failed', gptOnly.kind)
    const compete = resolveSendDestination({
      gptBinding: binding,
      waDraftActive: true,
      waDraftChat: 'Santhosh'
    })
    push(
      'resolverCompeteClarify',
      compete.kind === 'clarify' ? 'passed' : 'failed',
      compete.kind
    )
    const staleWa = resolveSendDestination({
      gptBinding: binding,
      waDraftActive: false
    })
    push(
      'resolverIgnoresInactiveWa',
      staleWa.kind === 'interactive-gpt' ? 'passed' : 'failed',
      staleWa.kind
    )

    openChatGptWebWindow({ focus: true })
    await sleep(2500)
    const st = chatgptWebStatus()
    push('workspaceOpen', st.open && !st.collapsed ? 'passed' : 'failed', `open=${st.open} collapsed=${st.collapsed}`)

    const inserted = await chatgptWebInsertTranscript(marker)
    push('insertHarmless', inserted.ok ? 'passed' : 'failed', inserted.reason)

    // Empty expected mismatch path is covered by unit tests; here submit the real draft.
    const submitted = await chatgptWebSubmitCurrentDraft({ expectedText: marker })
    if (submitted.status === 'empty') {
      push('submitLive', 'failed', submitted.reason)
    } else if (submitted.status === 'changed') {
      push('submitLive', 'failed', submitted.reason)
    } else if (submitted.status === 'unavailable' || submitted.status === 'failed') {
      push('submitLive', 'failed', submitted.reason)
    } else if (submitted.status === 'submitted-observed') {
      push('submitLive', 'passed', submitted.reason)
    } else if (submitted.status === 'delivery-unverified') {
      push('submitLive', 'passed', `unverified-ok: ${submitted.reason}`)
    } else if (submitted.status === 'cancelled') {
      push('submitLive', 'failed', submitted.reason)
    } else {
      push('submitLive', 'untested', submitted.reason)
    }

    // Cancel must bump generation so a submit started on the old generation cannot succeed.
    const priorGen = chatgptWebSubmitGeneration()
    cancelChatGptWebSubmit()
    const late = await chatgptWebSubmitCurrentDraft({ expectedText: marker, generation: priorGen })
    push(
      'cancelBlocksLateSubmit',
      late.status === 'cancelled' ? 'passed' : 'failed',
      `${late.status}: ${late.reason}`
    )

    closeChatGptWebWindow()
  } catch (err) {
    push('fatal', 'failed', err instanceof Error ? err.message.slice(0, 200) : 'unknown')
  }

  const out = join(app.getPath('userData'), 'send-it-verify.json')
  writeFileSync(out, JSON.stringify({ at: new Date().toISOString(), checks }, null, 2))
  console.log(`[verify-send-it] wrote ${out}`)
  app.exit(checks.some((c) => c.status === 'failed') ? 2 : 0)
  setTimeout(() => process.exit(checks.some((c) => c.status === 'failed') ? 2 : 0), 800)
}
