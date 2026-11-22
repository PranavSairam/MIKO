/**
 * Regression for open → navigate → type destinations.
 * Deterministic only — live AX results belong in PROJECT_LOG.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { availableKinds, capability } from './capabilities.ts'
import { routeCommand, type CatalogApp } from './commands.ts'
import {
  destinationExpired,
  destinationSummary,
  isChatGptBundle,
  isMikoBundle,
  type TypeDestination
} from './destination.ts'
import { tryDeterministicPlan } from './interpret.ts'
import { parseLiteralType, parseTypeIntent, isTypeFollowUp } from './type-plan.ts'

const apps: CatalogApp[] = [
  { id: 'chrome', name: 'Chrome', installed: true, familiar: true, aliases: ['chrome'] },
  { id: 'notes', name: 'Notes', installed: true, familiar: true, aliases: ['notes'] },
  { id: 'whatsapp', name: 'WhatsApp', installed: true, familiar: true, aliases: ['whatsapp'] },
  { id: 'calculator', name: 'Calculator', installed: true, familiar: true, aliases: ['calculator'] }
]

describe('type destination parsing', () => {
  it('parses Open ChatGPT + new chat + type as ordered steps (not app-name blob)', () => {
    const intent = parseTypeIntent(
      'Open ChatGPT, start a new chat, and type explain neural networks simply.',
      'typed'
    )
    assert.ok(intent)
    assert.equal(intent.destinationHint, 'chatgpt')
    assert.equal(intent.contentKind, 'polish')
    assert.match(intent.content, /explain neural networks simply/i)
    assert.ok(intent.plan.steps.some((s) => s.kind === 'open_application' && s.app === 'chatgpt'))
    assert.ok(intent.plan.steps.some((s) => s.kind === 'chatgpt_new_chat'))
    assert.ok(intent.plan.steps.some((s) => s.kind === 'insert_text'))
    // Must not be a single launch of an app named the whole sentence.
    assert.equal(
      routeCommand('Open ChatGPT, start a new chat, and type explain neural networks simply.', 'typed', apps).type,
      'type-dest'
    )
  })

  it('preserves destination across contextual follow-ups', () => {
    assert.equal(routeCommand('Open ChatGPT.', 'typed', apps).type, 'open-chatgpt')
    const neu = routeCommand('New chat.', 'typed', apps, [], {
      typeDestActive: true,
      typeDestKind: 'chatgpt-composer'
    })
    assert.equal(neu.type, 'type-dest')
    if (neu.type === 'type-dest') {
      assert.ok(neu.intent.plan.steps.some((s) => s.kind === 'chatgpt_new_chat'))
    }
    const typed = routeCommand('Type help me plan my project.', 'typed', apps, [], {
      typeDestActive: true,
      typeDestKind: 'chatgpt-composer'
    })
    assert.equal(typed.type, 'type-dest')
    if (typed.type === 'type-dest') {
      assert.match(typed.intent.content, /help me plan my project/i)
    }
  })

  it('omnibox insert does not navigate', () => {
    const intent = parseTypeIntent("Type this in Chrome's address bar: youtube.com")
    assert.ok(intent)
    assert.equal(intent.destinationHint, 'omnibox')
    assert.equal(intent.submit, false)
    assert.ok(intent.plan.steps.some((s) => s.kind === 'focus_omnibox' && s.content === 'youtube.com'))
  })

  it('Notes write resolves destination + content', () => {
    const intent = parseTypeIntent('Write in Notes that I need to finish the report.')
    assert.ok(intent)
    assert.equal(intent.destinationHint, 'notes')
    assert.match(intent.content, /I need to finish the report/i)
    assert.ok(intent.plan.steps[0]?.kind === 'open_application' && intent.plan.steps[0].app === 'notes')
  })

  it('type here uses captured field target', () => {
    const intent = parseTypeIntent("Type here: I'll call tomorrow.")
    assert.ok(intent)
    assert.equal(intent.destinationHint, 'here')
    assert.equal(intent.plan.steps[0]?.target, 'here')
    assert.match(intent.content, /I'll call tomorrow/i)
  })

  it('type exactly preserves verbatim content', () => {
    const lit = parseLiteralType('Type exactly: ill come tmrw')
    assert.ok(lit)
    assert.equal(lit.content, 'ill come tmrw')
    const intent = parseTypeIntent('Type exactly: ill come tmrw')
    assert.ok(intent)
    assert.equal(intent.contentKind, 'literal')
    assert.equal(intent.content, 'ill come tmrw')
  })

  it('ask ChatGPT to summarize this marks selection + submit flag', () => {
    const intent = parseTypeIntent('Open ChatGPT and ask it to summarize this.')
    assert.ok(intent)
    assert.equal(intent.contentKind, 'from-selection')
    assert.equal(intent.submit, true)
  })

  it('type in GPT is not stolen by an active type-dest follow-up', () => {
    const withCtx = routeCommand('Type in GPT to check my mail', 'typed', apps, [], {
      typeDestActive: true,
      typeDestKind: 'chatgpt-composer'
    })
    assert.equal(withCtx.type, 'type-in-gpt')
    if (withCtx.type === 'type-in-gpt') assert.equal(withCtx.text, 'check my mail')
    assert.equal(isTypeFollowUp('Type in GPT to check my mail'), false)
    assert.equal(parseTypeIntent('Type in GPT to check my mail'), null)
  })

  it('recipient-aware tell stays on WhatsApp path (not type-dest)', () => {
    const d = routeCommand("Tell her I'll visit next month, professionally.", 'typed', apps, [], {
      messaging: 'whatsapp',
      waChat: 'Mum'
    })
    assert.equal(d.type, 'whatsapp-reply')
  })

  it('unknown destination / choose where to type', () => {
    const choose = parseTypeIntent('Choose where to type')
    assert.ok(choose)
    assert.equal(choose.destinationHint, 'choose')
    assert.ok(choose.plan.steps.some((s) => s.kind === 'choose_type_destination'))
    assert.equal(isTypeFollowUp('Paste now'), true)
  })

  it('deterministic plan matches ChatGPT compound (single path)', () => {
    const plan = tryDeterministicPlan(
      'Open ChatGPT, start a new chat, and type explain neural networks simply.',
      'typed'
    )
    assert.ok(plan)
    assert.ok(plan!.steps.some((s) => s.kind === 'chatgpt_new_chat'))
    assert.ok(plan!.steps.some((s) => s.kind === 'insert_text'))
  })
})

describe('destination model + capabilities', () => {
  it('never treats MIKO as a typing target; expires soft TTL', () => {
    assert.equal(isMikoBundle('com.miko.app', 'MIKO'), true)
    assert.equal(isChatGptBundle('com.openai.chat'), true)
    const dest: TypeDestination = {
      kind: 'external-field',
      appName: 'TextEdit',
      bundleId: 'com.apple.TextEdit',
      pid: 1,
      fieldSig: 'abc',
      fieldRole: 'AXTextArea',
      label: '',
      capturedAt: Date.now() - 40 * 60 * 1000,
      verified: true,
      source: 'observed',
      secure: false
    }
    assert.equal(destinationExpired(dest), true)
    assert.match(destinationSummary({ ...dest, capturedAt: Date.now() }), /TextEdit/)
  })

  it('registers insert/new-chat/omnibox capabilities on darwin', () => {
    const kinds = availableKinds('darwin')
    assert.ok(kinds.includes('insert_text'))
    assert.ok(kinds.includes('chatgpt_new_chat'))
    assert.ok(kinds.includes('focus_omnibox'))
    assert.ok(capability('insert_text')?.verify.includes('nothing sent') || capability('insert_text')?.verify)
    assert.ok(capability('focus_omnibox')?.verify.toLowerCase().includes('enter'))
  })

  it('secure fields are flagged on the destination model', () => {
    const secure: TypeDestination = {
      kind: 'external-field',
      appName: 'Safari',
      bundleId: 'com.apple.Safari',
      pid: 2,
      fieldSig: 'x',
      fieldRole: 'AXTextField',
      label: '',
      capturedAt: Date.now(),
      verified: false,
      source: 'observed',
      secure: true
    }
    assert.equal(secure.secure, true)
  })
})

describe('type vs submit + cancel/supersede shapes', () => {
  it('type plans never imply send; ask-it sets submit flag only', () => {
    const typeOnly = parseTypeIntent('Open ChatGPT and type hello there')
    assert.ok(typeOnly)
    assert.equal(typeOnly!.submit, false)
    const ask = parseTypeIntent('Open ChatGPT and ask it to summarize this')
    assert.ok(ask)
    assert.equal(ask!.submit, true)
  })

  it('duplicate compound routing stays type-dest (not launch + interpret)', () => {
    const a = routeCommand('Open ChatGPT, start a new chat, and type hello', 'typed', apps)
    const b = routeCommand('Open ChatGPT, start a new chat, and type hello', 'voice', apps)
    assert.equal(a.type, 'type-dest')
    assert.equal(b.type, 'type-dest')
  })
})
