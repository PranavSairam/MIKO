/**
 * Synthetic scenarios for recipient-aware writing + contextual WhatsApp opens.
 * Fixtures use placeholder names only — no private chat content.
 * Deterministic routing/intent checks only; model wording is not asserted as exact strings.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { planVoice, routeCommand, type CatalogApp } from './commands.ts'
import {
  detectAmbiguousTimes,
  isAdditiveFollowUp,
  parseWhatsAppReplyIntent,
  whatsAppDraftPrompt
} from './whatsapp-reply.ts'

const apps: CatalogApp[] = [
  { id: 'whatsapp', name: 'WhatsApp', installed: true, familiar: true, aliases: ['whatsapp', 'whats app'] },
  { id: 'chrome', name: 'Chrome', installed: true, familiar: true, aliases: ['chrome', 'google chrome'] },
  { id: 'calculator', name: 'Calculator', installed: true, familiar: true, aliases: ['calculator', 'calc'] }
]

describe('scenario: Gayu Sis four-step flow (routing)', () => {
  it('open WhatsApp → open contact → tell her → refine casual', () => {
    assert.equal(routeCommand('Open WhatsApp.', 'typed', apps).type, 'launch')

    const openContact = routeCommand('Open Gayu Sis.', 'typed', apps, [], { messaging: 'whatsapp' })
    assert.equal(openContact.type, 'whatsapp')
    if (openContact.type === 'whatsapp') assert.equal(openContact.query, 'Gayu Sis')

    const tell = routeCommand("Tell her I’ll take her to the movie tomorrow.", 'typed', apps, [], {
      messaging: 'whatsapp',
      waChat: 'Gayu Sis'
    })
    assert.equal(tell.type, 'whatsapp-reply')
    if (tell.type === 'whatsapp-reply') {
      assert.equal(tell.intent.pronoun, 'her')
      assert.equal(tell.intent.replyHere, true)
      assert.match(tell.intent.instruction, /take her to the movie tomorrow/i)
      assert.equal(tell.intent.literal, undefined)
    }

    const refine = routeCommand('Make it more casual.', 'typed', apps, [], {
      messaging: 'whatsapp',
      waChat: 'Gayu Sis',
      waDraftActive: true
    })
    assert.equal(refine.type, 'whatsapp-reply')
    if (refine.type === 'whatsapp-reply') {
      assert.equal(refine.intent.refine, true)
      assert.match(refine.intent.instruction, /casual/i)
    }
  })
})

describe('scenario: writing constraints in draft prompt', () => {
  it('direct recipient vs distinct third person appear as prompt rules', () => {
    const toGayu = whatsAppDraftPrompt({
      chatName: 'Gayu Sis',
      instruction: 'I’ll pick her up tomorrow.',
      pronoun: 'her'
    })
    assert.match(toGayu, /Gayu Sis/)
    assert.match(toGayu, /second person|“you”/i)
    assert.match(toGayu, /Do NOT blindly replace/)

    const toDad = whatsAppDraftPrompt({
      chatName: 'Dad',
      instruction: 'I’m taking Gayu to the movie tomorrow.',
      pronoun: 'him'
    })
    assert.match(toDad, /different person|third person/i)
    assert.match(toDad, /Gayu/)
  })

  it('question vs statement and missing date constraints', () => {
    const ask = whatsAppDraftPrompt({
      chatName: 'Gayu Sis',
      instruction: 'Ask her if she wants to watch a movie tomorrow.',
      pronoun: 'her'
    })
    assert.match(ask, /direct question|Would you like/i)
    assert.match(ask, /uncertainty|hedges|might/i)

    const noDate = whatsAppDraftPrompt({
      chatName: 'Gayu Sis',
      instruction: 'I want to take her to a movie',
      pronoun: 'her'
    })
    assert.match(noDate, /do not add a day/i)
    assert.match(noDate, /including “tomorrow”/)
  })

  it('casual default vs formal when requested; type exactly bypasses rewrite', () => {
    const casual = whatsAppDraftPrompt({ chatName: 'Gayu Sis', instruction: 'ok see you', tone: 'casual' })
    assert.match(casual, /casual by default|natural and casual/i)
    assert.match(casual, /Do not add stiff greetings/i)

    const formal = whatsAppDraftPrompt({
      chatName: 'Gayu Sis',
      instruction: 'Write this in a formal, polished way: ok see you',
      tone: 'formal'
    })
    assert.match(formal, /professional wording/i)

    const exact = parseWhatsAppReplyIntent('type exactly I’ll take you to the movie tomorrow.', {
      messaging: 'whatsapp',
      waChat: 'Gayu Sis'
    })
    assert.equal(exact?.literal, true)
    assert.equal(exact?.instruction, 'I’ll take you to the movie tomorrow.')
  })
})

describe('scenario: contact open + known apps during WhatsApp context', () => {
  it('multiple-match phrasing stays whatsapp; known apps still open', () => {
    const explicit = routeCommand('open Gayu Sis in WhatsApp', 'typed', apps)
    assert.equal(explicit.type, 'whatsapp')
    assert.equal(planVoice(explicit, true).kind, 'run')

    assert.equal(routeCommand('open Chrome', 'typed', apps, [], { messaging: 'whatsapp' }).type, 'chrome-profiles')
    assert.equal(routeCommand('open Calculator', 'typed', apps, [], { messaging: 'whatsapp' }).type, 'launch')

    // Without messaging, unknown names miss as apps.
    assert.equal(routeCommand('open Gayu Sis', 'typed', apps).type, 'missing')
  })

  it('cancel and deliberate later open remain separate intents', () => {
    assert.equal(routeCommand('never mind', 'typed', apps, [], { messaging: 'whatsapp' }).type, 'cancel-workflow')
    const later = routeCommand('open Gayu Sis in WhatsApp', 'typed', apps)
    assert.equal(later.type, 'whatsapp')
    // A second routeCommand call is a new task — not blocked by the first.
    const again = routeCommand('open Gayu Sis in WhatsApp', 'voice', apps)
    assert.equal(again.type, 'whatsapp')
    assert.equal(planVoice(again, true).kind, 'run')
  })
})

describe('scenario: follow-up drafting after an earlier message', () => {
  it('Also tell her / Add that route as additive whatsapp-reply; type exactly stays literal', () => {
    const also = routeCommand(
      'Also tell her that the movie is at 3 AM and tell her to be ready by 230',
      'typed',
      apps,
      [],
      { messaging: 'whatsapp', waChat: 'Gayu Sis', waDraftActive: true }
    )
    assert.equal(also.type, 'whatsapp-reply')
    if (also.type === 'whatsapp-reply') {
      assert.equal(also.intent.additive, true)
      assert.equal(also.intent.literal, undefined)
      assert.equal(also.intent.pronoun, 'her')
      assert.ok(isAdditiveFollowUp('Also tell her the movie is at 3 AM'))
    }

    const add = routeCommand('Add that I will pick her up', 'typed', apps, [], {
      messaging: 'whatsapp',
      waChat: 'Gayu Sis',
      waDraftActive: true
    })
    assert.equal(add.type, 'whatsapp-reply')
    if (add.type === 'whatsapp-reply') assert.equal(add.intent.additive, true)

    const exact = routeCommand('type exactly Be ready by 2:30 PM.', 'typed', apps, [], {
      messaging: 'whatsapp',
      waChat: 'Gayu Sis'
    })
    assert.equal(exact.type, 'whatsapp-reply')
    if (exact.type === 'whatsapp-reply') {
      assert.equal(exact.intent.literal, true)
      assert.equal(exact.intent.instruction, 'Be ready by 2:30 PM.')
    }
  })

  it('ambiguous times require clarification; cancel wording still cancels', () => {
    const amb = detectAmbiguousTimes('movie at 3 AM, ready by 230')
    assert.ok(amb)
    assert.match(amb!.question, /3 AM/)
    assert.match(amb!.question, /230/)
    assert.equal(routeCommand('cancel that', 'typed', apps, [], { messaging: 'whatsapp', waDraftActive: true }).type, 'cancel-workflow')
    // Cancel while a draft/clarify workflow is active uses the same cancel-workflow route.
    assert.equal(
      routeCommand('never mind', 'typed', apps, [], { messaging: 'whatsapp', waChat: 'Gayu Sis', waDraftActive: true }).type,
      'cancel-workflow'
    )
  })

  it('prompt strips Also-tell framing and keeps distinct third persons', () => {
    const toGayu = whatsAppDraftPrompt({
      chatName: 'Gayu Sis',
      instruction: 'Also tell her the movie is at 3 PM and ask her to be ready by 2:30 PM',
      pronoun: 'her'
    })
    assert.match(toGayu, /never paste that framing|Also tell her/i)
    assert.match(toGayu, /Nested framing/i)

    const toDad = whatsAppDraftPrompt({
      chatName: 'Dad',
      instruction: 'Add that I’m taking Gayu to the movie',
      pronoun: 'him'
    })
    assert.match(toDad, /Gayu/)
    assert.match(toDad, /third person|different person/i)
  })
})
