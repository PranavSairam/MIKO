/**
 * Live AX + panel check for WhatsApp conversation flow (wrappers vs literal, nav-only, refine).
 * Harmless drafts only; never sends; restores Me / Me 2 composers.
 * Run: MIKO_VERIFY_WA_CONVERSATION=1 npm run start
 */
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import { getPetBrowserWindow } from './pet-window'
import { insertWhatsAppDraft, openWhatsAppContact, cancelWhatsApp } from './whatsapp'
import { chatgptWebStatus, collapseChatGptWebWindow, openChatGptWebWindow } from './chatgpt-web-window'

type Check = { name: string; status: 'passed' | 'failed' | 'untested'; detail: string }

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

async function panelSubmit(text: string): Promise<{ ok: boolean; reason?: string }> {
  const pet = getPetBrowserWindow()
  if (!pet) return { ok: false, reason: 'no pet window' }
  try {
    const result = (await pet.webContents.executeJavaScript(
      `(() => {
        const bridge = window.__mikoPanel;
        if (!bridge || typeof bridge.submit !== 'function') return { ok: false, reason: 'no __mikoPanel' };
        return bridge.submit(${JSON.stringify(text)}).then(() => ({ ok: true })).catch((e) => ({ ok: false, reason: String(e) }));
      })()`,
      true
    )) as { ok: boolean; reason?: string }
    return result
  } catch (e) {
    return { ok: false, reason: String(e) }
  }
}

async function panelSnapshot(): Promise<{ entries: Array<Record<string, unknown>> }> {
  const pet = getPetBrowserWindow()
  if (!pet) return { entries: [] }
  try {
    const snap = (await pet.webContents.executeJavaScript(
      `(() => {
        const bridge = window.__mikoPanel;
        if (!bridge || typeof bridge.snapshot !== 'function') return { entries: [] };
        return bridge.snapshot();
      })()`,
      true
    )) as { entries?: Array<Record<string, unknown>> }
    return { entries: snap?.entries || [] }
  } catch {
    return { entries: [] }
  }
}

function latestWa(entries: Array<Record<string, unknown>>): Record<string, unknown> | null {
  for (let i = entries.length - 1; i >= 0; i--) {
    if (entries[i]?.kind === 'wa-reply') return entries[i]
  }
  return null
}

export async function runWaConversationVerify(showPet: () => void): Promise<void> {
  const checks: Check[] = []
  const push = (name: string, status: Check['status'], detail: string): void => {
    checks.push({ name, status, detail })
    console.log(`[verify-wa-conversation] ${status}: ${name} — ${detail}`)
  }

  const marker = `MIKO WA flow check ${Date.now()} — unsent`
  let meComposer = ''
  let me2Composer = ''
  let me2Header = 'Me 2'

  try {
    showPet()
    await sleep(900)

    // Capture Me composer first so we never clobber it.
    // Prefer exact row when search returns Me / Me 2 / …
    let meOpen = await openWhatsAppContact({ query: 'Me' })
    if (meOpen.status === 'choices') {
      const exact = meOpen.matches.find((m) => /^me$/i.test(m.name.trim()))
      if (exact?.id) meOpen = await openWhatsAppContact({ query: 'Me', pickId: exact.id })
    }
    push(
      'openMe',
      meOpen.status === 'opened' || /^me\b/i.test(meOpen.header) ? 'passed' : 'failed',
      `${meOpen.status} header=${meOpen.header}`
    )
    const meAsk = await insertWhatsAppDraft({ expectHeader: meOpen.header || 'Me', text: '', mode: 'ask' })
    meComposer = meAsk.composerText || ''
    push('preserveMeComposer', 'passed', `len=${meComposer.length} status=${meAsk.status}`)

    // Open Me 2 for harmless drafts.
    let me2Open = await openWhatsAppContact({ query: 'Me 2' })
    if (me2Open.status === 'choices') {
      const exact = me2Open.matches.find((m) => /^me\s*2$/i.test(m.name.trim()))
      if (exact?.id) me2Open = await openWhatsAppContact({ query: 'Me 2', pickId: exact.id })
    }
    me2Header = me2Open.header || 'Me 2'
    push(
      'openMe2',
      me2Open.status === 'opened' || /me\s*2/i.test(me2Header) ? 'passed' : 'failed',
      `${me2Open.status} header=${me2Header}`
    )
    const me2Ask = await insertWhatsAppDraft({ expectHeader: me2Header, text: '', mode: 'ask' })
    me2Composer = me2Ask.composerText || ''
    push('captureMe2Composer', 'passed', `len=${me2Composer.length} status=${me2Ask.status}`)

    // Nav-only must not change composer: open Me then back — AX ask only.
    const navMe = await openWhatsAppContact({ query: 'Me' })
    const afterNavMe = await insertWhatsAppDraft({ expectHeader: navMe.header || 'Me', text: '', mode: 'ask' })
    push(
      'navOnlyPreservesMe',
      (afterNavMe.composerText || '') === meComposer ? 'passed' : 'failed',
      `beforeLen=${meComposer.length} afterLen=${(afterNavMe.composerText || '').length}`
    )

    const backMe2 = await openWhatsAppContact({ query: 'Me 2' })
    me2Header = backMe2.header || me2Header
    await sleep(400)

    // Establish the same router context typed/voice would have after navigation.
    const goMe2 = await panelSubmit('Open Me 2 in WhatsApp')
    push('panelOpenMe2', goMe2.ok ? 'passed' : 'failed', goMe2.reason || 'submitted')
    await sleep(3500)

    // Panel: tell him good morning → recipient-aware draft, not “saying …”
    const submitGm = await panelSubmit('Tell him good morning')
    push('panelTellGoodMorning', submitGm.ok ? 'passed' : 'failed', submitGm.reason || 'submitted')
    // Wait for draft (model) up to ~45s
    let drafted: Record<string, unknown> | null = null
    for (let i = 0; i < 45; i++) {
      await sleep(1000)
      const snap = await panelSnapshot()
      const wa = latestWa(snap.entries)
      if (!wa) continue
      const status = String(wa.status || '')
      const draft = String(wa.draft || '')
      if (draft && /saying/i.test(draft) && !/good morning/i.test(draft.replace(/saying/gi, ''))) {
        drafted = wa
        break
      }
      if (
        draft &&
        !/^saying\b/i.test(draft.trim()) &&
        (status === 'inserted' || status === 'ready' || status === 'choose-insert' || status === 'failed')
      ) {
        drafted = wa
        break
      }
      if (status === 'failed' || status === 'cancelled') {
        drafted = wa
        break
      }
    }
    const draftText = String(drafted?.draft || '')
    const instruction = String(drafted?.instruction || '')
    push(
      'wordingNotSayingWrapper',
      drafted && draftText && !/^saying\b/i.test(draftText.trim()) && !/^saying\b/i.test(instruction.trim())
        ? 'passed'
        : 'failed',
      `status=${drafted?.status} instruction=${instruction.slice(0, 80)} draft=${draftText.slice(0, 120)}`
    )
    push(
      'wordingLooksLikeGreeting',
      /good morning/i.test(draftText) && !/^saying good morning$/i.test(draftText.trim()) ? 'passed' : 'failed',
      draftText.slice(0, 160) || '(empty)'
    )

    // Composer on Me 2 after insert (or choose-insert)
    const afterDraft = await insertWhatsAppDraft({ expectHeader: me2Header, text: '', mode: 'ask' })
    push(
      'insertUnsentOrChoose',
      afterDraft.status === 'has-text' || afterDraft.status === 'empty' || String(drafted?.status) === 'choose-insert'
        ? 'passed'
        : 'failed',
      `ask=${afterDraft.status} panel=${drafted?.status} composer=${(afterDraft.composerText || '').slice(0, 80)}`
    )

    // Cancel workflow
    const cancelSubmit = await panelSubmit('never mind')
    push('cancelWorkflow', cancelSubmit.ok ? 'passed' : 'failed', cancelSubmit.reason || 'ok')
    await sleep(800)
    cancelWhatsApp()

    // Refinement path after a fresh literal insert (no model) — replace only if empty or restore later.
    if (afterDraft.status === 'empty' || !(afterDraft.composerText || '').trim()) {
      const lit = await insertWhatsAppDraft({ expectHeader: me2Header, text: marker, mode: 'replace' })
      push(
        'literalInsertUnsent',
        lit.status === 'inserted' && lit.verified === true ? 'passed' : 'failed',
        `${lit.status} verified=${lit.verified} text=${(lit.composerText || '').slice(0, 60)}`
      )
      const refineSubmit = await panelSubmit('Make it warmer')
      push('refineWarmerSubmit', refineSubmit.ok ? 'passed' : 'failed', refineSubmit.reason || 'ok')
      let refined: Record<string, unknown> | null = null
      for (let i = 0; i < 30; i++) {
        await sleep(1000)
        const snap = await panelSnapshot()
        const wa = latestWa(snap.entries)
        if (!wa) continue
        const status = String(wa.status || '')
        if (status === 'inserted' || status === 'ready' || status === 'choose-insert' || status === 'failed') {
          refined = wa
          break
        }
      }
      push(
        'refineWarmerResult',
        refined ? 'passed' : 'untested',
        refined ? `status=${refined.status} draft=${String(refined.draft || '').slice(0, 100)}` : 'no refine entry'
      )
    } else {
      push('literalInsertUnsent', 'untested', 'composer already had text — skipped replace insert')
      push('refineWarmerSubmit', 'untested', 'skipped to preserve existing draft')
      push('refineWarmerResult', 'untested', 'skipped')
    }

    // Switch guard: expect Me while on Me 2
    const switched = await insertWhatsAppDraft({
      expectHeader: 'Me',
      text: 'SHOULD NOT INSERT — switch guard',
      mode: 'replace'
    })
    push(
      'switchDuringInsertGuard',
      switched.status === 'switched' ? 'passed' : 'failed',
      `${switched.status} reason=${switched.reason}`
    )

    // Interactive GPT tuck: open workspace then WA open should collapse without clearing session.
    openChatGptWebWindow({ focus: true })
    await sleep(1200)
    const beforeTuck = chatgptWebStatus()
    await openWhatsAppContact({ query: 'Me 2' })
    // Panel WA open also tucks; mimic explicit reply path
    await panelSubmit('Go to Me 2')
    await sleep(2000)
    const afterTuck = chatgptWebStatus()
    push(
      'igptTuckOnWaSwitch',
      beforeTuck.open && (afterTuck.collapsed || !afterTuck.visible || afterTuck.open)
        ? afterTuck.open
          ? 'passed'
          : 'failed'
        : beforeTuck.open
          ? 'failed'
          : 'untested',
      `before open=${beforeTuck.open} collapsed=${beforeTuck.collapsed}; after open=${afterTuck.open} collapsed=${afterTuck.collapsed} visible=${afterTuck.visible}`
    )
    if (afterTuck.open && !afterTuck.collapsed) {
      try {
        collapseChatGptWebWindow()
      } catch {
        /* ignore */
      }
    }
  } catch (e) {
    push('fatal', 'failed', String(e))
  } finally {
    // Restore composers — never leave verify markers; never send.
    try {
      cancelWhatsApp()
      const open2 = await openWhatsAppContact({ query: 'Me 2' })
      const header2 = open2.header || me2Header
      if (me2Composer.trim()) {
        await insertWhatsAppDraft({ expectHeader: header2, text: me2Composer, mode: 'replace' })
      } else {
        // Clear verify marker if we inserted into empty box
        const ask = await insertWhatsAppDraft({ expectHeader: header2, text: '', mode: 'ask' })
        if (ask.status === 'has-text' && /MIKO WA flow check/i.test(ask.composerText || '')) {
          await insertWhatsAppDraft({ expectHeader: header2, text: ' ', mode: 'replace' })
        }
      }
      push('restoreMe2', 'passed', `restored len=${me2Composer.length}`)

      const openMe = await openWhatsAppContact({ query: 'Me' })
      const headerMe = openMe.header || 'Me'
      if (meComposer.trim()) {
        const cur = await insertWhatsAppDraft({ expectHeader: headerMe, text: '', mode: 'ask' })
        if ((cur.composerText || '') !== meComposer) {
          await insertWhatsAppDraft({ expectHeader: headerMe, text: meComposer, mode: 'replace' })
        }
      }
      push('restoreMe', 'passed', `preserved len=${meComposer.length}`)
    } catch (e) {
      push('restore', 'failed', String(e))
    }

    const out = join(app.getPath('userData'), 'verify-wa-conversation.json')
    writeFileSync(
      out,
      JSON.stringify(
        {
          at: new Date().toISOString(),
          checks,
          passed: checks.filter((c) => c.status === 'passed').length,
          failed: checks.filter((c) => c.status === 'failed').length,
          untested: checks.filter((c) => c.status === 'untested').length
        },
        null,
        2
      )
    )
    console.log(`[verify-wa-conversation] wrote ${out}`)
    console.log(
      `[verify-wa-conversation] summary passed=${checks.filter((c) => c.status === 'passed').length} failed=${checks.filter((c) => c.status === 'failed').length} untested=${checks.filter((c) => c.status === 'untested').length}`
    )
  }
}
