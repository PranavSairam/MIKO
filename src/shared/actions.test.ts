import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { detectNegations, toneFromText } from './actions.ts'
import { tryDeterministicPlan } from './interpret.ts'
import { availableKinds, capability } from './capabilities.ts'

describe('actions and capabilities', () => {
  it('keeps message content intact while detecting negations and tone', () => {
    const n = detectNegations("I'll visit next month, don't send it")
    assert.equal(n.send, true)
    assert.match(n.rest, /visit next month/i)
    const t = toneFromText("I'll visit next month professionally")
    assert.equal(t.tone, 'professional')
    assert.match(t.rest, /visit next month/i)
    const polite = toneFromText('dinner is at 8, keep it polite')
    assert.equal(polite.tone, 'polite')
    assert.match(polite.rest, /dinner is at 8/i)
    const proper = toneFromText("I'll drop by next month, keep it proper")
    assert.equal(proper.tone, 'formal')
    assert.match(proper.rest, /drop by next month/i)
  })

  it('builds a compound WhatsApp plan without eating the message into the target', () => {
    const plan = tryDeterministicPlan("Open Dad in WhatsApp and tell him I'll visit next month, professionally.", 'typed')
    assert.ok(plan)
    assert.equal(plan!.steps[0].kind, 'open_whatsapp_chat')
    assert.equal(plan!.steps[0].target, 'Dad')
    assert.equal(plan!.steps[1].kind, 'draft_whatsapp')
    assert.match(plan!.steps[1].content || '', /visit next month/i)
    assert.equal(plan!.steps[1].tone, 'professional')
  })

  it('exposes platform-filtered capabilities', () => {
    assert.ok(capability('summarize_whatsapp'))
    assert.ok(availableKinds('darwin').includes('close_browser_tab'))
    assert.ok(!availableKinds('win32').includes('close_browser_tab'))
    // macOS-only automation must not claim success on Windows.
    // WhatsApp contact search/open has a Windows UI Automation adapter (whatsapp-win.ps1).
    for (const kind of ['search_whatsapp_contacts', 'open_whatsapp_chat'] as const) {
      assert.ok(availableKinds('darwin').includes(kind), kind)
      assert.ok(availableKinds('win32').includes(kind), kind)
    }
    for (const kind of [
      'read_whatsapp_messages',
      'list_browser_tabs',
      'read_selected_text',
      'chatgpt_new_chat',
      'insert_text',
      'choose_type_destination'
    ] as const) {
      assert.ok(availableKinds('darwin').includes(kind), kind)
      assert.ok(!availableKinds('win32').includes(kind), kind)
    }
    assert.ok(availableKinds('win32').includes('open_application'))
    assert.ok(availableKinds('win32').includes('ask_assistant'))
  })
})
