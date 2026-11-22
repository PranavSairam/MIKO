import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { routeCommand } from './commands.ts'
import {
  applyTimeClarification,
  detectAmbiguousTimes,
  formatVisibleContext,
  isAdditiveFollowUp,
  isInstructionFramingBody,
  parseCompactClockDigits,
  parseDraft,
  parseMessageBubble,
  parseWhatsAppReplyIntent,
  parseWhatsAppSummarizeIntent,
  recipientMatchesOpenChat,
  resolveAdditiveFollowUpMode,
  stripDraftInstructionFraming,
  stripFormalTone,
  whatsAppDraftPrompt
} from './whatsapp-reply.ts'

const catalog = [{ id: 'whatsapp', name: 'WhatsApp', installed: true, familiar: true, aliases: ['whatsapp'] }]

describe('WhatsApp reply intent', () => {
  it('recognizes tell / reply / write-to-this / refine / draft literal', () => {
    const tell = parseWhatsAppReplyIntent("Tell him I'll visit him next month, professionally.")
    assert.equal(tell?.pronoun, 'him')
    assert.equal(tell?.replyHere, true)
    assert.match(tell?.instruction ?? '', /visit him next month/i)
    assert.equal(tell?.autoInsert, true)
    assert.equal(tell?.needsContext, false)

    const named = parseWhatsAppReplyIntent("reply to Dad saying I'll call tomorrow")
    assert.equal(named?.recipient, 'Dad')
    assert.match(named?.instruction ?? '', /call tomorrow/i)

    const formal = parseWhatsAppReplyIntent('write a formal reply to this')
    assert.equal(formal?.needsContext, true)
    assert.equal(formal?.autoInsert, true)

    const refine = parseWhatsAppReplyIntent('make that shorter', { draftActive: true })
    assert.equal(refine?.refine, true)
    assert.equal(refine?.instruction, 'shorter')

    const literal = parseWhatsAppReplyIntent('Draft: The MIKO project is nearly complete.')
    assert.equal(literal?.literal, true)
    assert.equal(literal?.replyHere, true)
    assert.equal(literal?.instruction, 'The MIKO project is nearly complete.')

    const here = parseWhatsAppReplyIntent('reply here saying hi')
    assert.equal(here?.replyHere, true)
    assert.equal(here?.instruction, 'hi')

    assert.equal(parseWhatsAppReplyIntent('tell me a joke'), null)
  })

  it('types into an open chat and strips a formal-way tone', () => {
    assert.deepEqual(stripFormalTone('tht ill be goin chennai tmrw mrng in a formal way'), {
      instruction: 'tht ill be goin chennai tmrw mrng',
      formal: true
    })
    const typed = parseWhatsAppReplyIntent('type tht ill be goin chennai tmrw mrng in a formal way', {
      messaging: 'whatsapp',
      waChat: 'Me'
    })
    assert.equal(typed?.replyHere, true)
    assert.equal(typed?.literal, false)
    assert.match(typed?.instruction ?? '', /formal/i)
    assert.match(typed?.instruction ?? '', /tht ill be goin/)
    assert.equal(parseWhatsAppReplyIntent('type hi there', { messaging: 'whatsapp' })?.literal, true)
    assert.equal(parseWhatsAppReplyIntent('type hi there'), null)
  })

  it('routes WhatsApp replies and Draft: before ordinary questions', () => {
    const decision = routeCommand("Tell Dad the MIKO project is nearly done, with proper grammar.", 'typed', catalog, [], {
      messaging: 'whatsapp'
    })
    assert.equal(decision.type, 'whatsapp-reply')
    if (decision.type === 'whatsapp-reply') {
      assert.equal(decision.intent.recipient, 'Dad')
      assert.equal(decision.intent.autoInsert, true)
    }
    const draft = routeCommand('Draft: The MIKO project is nearly complete.', 'typed', catalog, [])
    assert.equal(draft.type, 'whatsapp-reply')
    if (draft.type === 'whatsapp-reply') assert.equal(draft.intent.literal, true)
  })
})

describe('WhatsApp visible messages', () => {
  it('parses text bubbles, skips media/contacts, and labels older history', () => {
    const received = parseMessageBubble('message, C for ramayana tkt today nite, 2:51 PM, Received from Mum', 'Mum')
    assert.equal(received?.mine, false)
    assert.equal(received?.sender, 'Mum')
    assert.match(received?.text ?? '', /ramayana/i)

    const mine = parseMessageBubble('Your message, Okok, 13 November at 7:34 PM, Sent to Mum, Red', 'Mum')
    assert.equal(mine?.mine, true)
    assert.equal(mine?.text, 'Okok')

    assert.equal(parseMessageBubble('Your photo, 27 April at 1:19 AM, Sent to You', 'Me'), null)
    assert.equal(parseMessageBubble('Your contact, Suraj Kumar, 4 June at 10:21 AM, Sent to You', 'Me'), null)

    const older = formatVisibleContext([mine!], 'Mum', false)
    assert.match(older, /older history/i)

    const latest = formatVisibleContext([mine!], 'Mum', true)
    assert.match(latest, /latest messages/i)
  })

  it('keeps drafting prompt free of invented commitments and matches recipients exactly', () => {
    const prompt = whatsAppDraftPrompt({
      chatName: 'Dad',
      instruction: 'the MIKO project is nearly done, with proper grammar',
      pronoun: 'him'
    })
    assert.match(prompt, /Do not invent/)
    assert.match(prompt, /point of view|my point of view|from my point of view/i)
    assert.match(prompt, /Do not invent facts, dates \(including/)
    assert.match(prompt, /Do not add offers to confirm later/)
    assert.match(prompt, /Do NOT blindly replace/)
    const draft = parseDraft('The MIKO project is nearly done.')
    assert.equal(draft.kind, 'draft')
    assert.equal(recipientMatchesOpenChat('Dad', 'Dad'), true)
    assert.equal(recipientMatchesOpenChat('Mum', 'Dad'), false)
    assert.equal(recipientMatchesOpenChat('Mum', 'Sandy Mum'), false)
    assert.equal(recipientMatchesOpenChat('Me', 'Me'), true)
  })

  it('treats type exactly as a literal insert', () => {
    const exact = parseWhatsAppReplyIntent('type exactly I’ll take you to the movie tomorrow.', {
      messaging: 'whatsapp',
      waChat: 'Gayu Sis'
    })
    assert.equal(exact?.literal, true)
    assert.equal(exact?.instruction, 'I’ll take you to the movie tomorrow.')
  })

  it('strips saying/reply wrappers — never pastes them as literal draft text', () => {
    assert.equal(stripDraftInstructionFraming('saying good morning'), 'good morning')
    assert.equal(stripDraftInstructionFraming('reply saying good morning'), 'good morning')
    assert.equal(isInstructionFramingBody('saying good morning'), true)
    assert.equal(isInstructionFramingBody('hello dad'), false)

    const typedSaying = parseWhatsAppReplyIntent('type saying good morning', {
      messaging: 'whatsapp',
      waChat: 'Dad'
    })
    assert.equal(typedSaying?.literal, undefined)
    assert.equal(typedSaying?.instruction, 'good morning')

    const replySaying = parseWhatsAppReplyIntent('reply saying good morning', {
      messaging: 'whatsapp',
      waChat: 'Dad'
    })
    assert.equal(replySaying?.instruction, 'good morning')
    assert.notEqual(replySaying?.literal, true)

    const tell = parseWhatsAppReplyIntent('Tell him good morning', {
      messaging: 'whatsapp',
      waChat: 'Dad'
    })
    assert.equal(tell?.instruction, 'good morning')
    assert.equal(tell?.pronoun, 'him')

    const ask = parseWhatsAppReplyIntent('Ask him if he’s free', {
      messaging: 'whatsapp',
      waChat: 'Dad'
    })
    assert.equal(ask?.pronoun, 'him')
    assert.match(ask?.instruction ?? '', /free/i)

    const warmer = parseWhatsAppReplyIntent('Make it warmer', {
      messaging: 'whatsapp',
      waChat: 'Dad',
      draftActive: true
    })
    assert.equal(warmer?.refine, true)
    assert.match(warmer?.instruction ?? '', /warm/i)

    const prompt = whatsAppDraftPrompt({
      chatName: 'Dad',
      instruction: 'saying good morning',
      pronoun: 'him'
    })
    // Prompt strips wrappers before the instruction fence; framing rules still warn the model.
    assert.match(prompt, /<instruction>\s*good morning\s*<\/instruction>/i)
    assert.doesNotMatch(prompt, /<instruction>\s*saying good morning\s*<\/instruction>/i)
    assert.match(prompt, /never paste that framing|Never paste the word “saying”/i)
  })

  it('routes Also tell / Add that / Let her know / Ask her as recipient-aware drafts (not literal)', () => {
    const also = parseWhatsAppReplyIntent(
      'Also tell her that the movie is at 3 AM and tell her to be ready by 230',
      { messaging: 'whatsapp', waChat: 'Gayu Sis' }
    )
    assert.ok(also)
    assert.equal(also?.literal, undefined)
    assert.equal(also?.additive, true)
    assert.equal(also?.pronoun, 'her')
    assert.equal(also?.replyHere, true)
    assert.match(also?.instruction ?? '', /movie is at 3 AM/i)
    assert.equal(routeCommand('Also tell her the movie is at 3 PM', 'typed', catalog, [], {
      messaging: 'whatsapp',
      waChat: 'Gayu Sis'
    }).type, 'whatsapp-reply')

    const add = parseWhatsAppReplyIntent('Add that I will bring snacks', {
      messaging: 'whatsapp',
      waChat: 'Gayu Sis',
      draftActive: true
    })
    assert.equal(add?.additive, true)
    assert.equal(add?.literal, undefined)
    assert.match(add?.instruction ?? '', /bring snacks/i)

    const letKnow = parseWhatsAppReplyIntent('Let her know the gate code is 1234', {
      messaging: 'whatsapp',
      waChat: 'Gayu Sis'
    })
    assert.equal(letKnow?.additive, true)
    assert.equal(letKnow?.pronoun, 'her')
    assert.match(letKnow?.instruction ?? '', /gate code/i)

    const ask = parseWhatsAppReplyIntent('Ask her if she wants popcorn', {
      messaging: 'whatsapp',
      waChat: 'Gayu Sis'
    })
    assert.equal(ask?.pronoun, 'her')
    assert.equal(ask?.literal, undefined)
    assert.match(ask?.instruction ?? '', /Ask her/i)

    assert.equal(isAdditiveFollowUp('Also tell her the time'), true)
    assert.equal(isAdditiveFollowUp('Add that we leave early'), true)
    assert.equal(isAdditiveFollowUp('type exactly hello'), false)

    // “type Also tell her …” must not become a literal paste of the framing.
    const typedAlso = parseWhatsAppReplyIntent(
      'type Also tell her the movie is at 3 PM and ask her to be ready by 2:30 PM',
      { messaging: 'whatsapp', waChat: 'Gayu Sis' }
    )
    assert.equal(typedAlso?.literal, undefined)
    assert.equal(typedAlso?.additive, true)
    assert.equal(typedAlso?.pronoun, 'her')
  })

  it('refines an unsent composer draft and starts a new follow-up when the box is empty', () => {
    assert.equal(
      resolveAdditiveFollowUpMode({
        composerStatus: 'has-text',
        composerText: 'I’ll take you to the movie tomorrow.',
        draft: 'I’ll take you to the movie tomorrow.',
        insertedText: 'I’ll take you to the movie tomorrow.',
        entryStatus: 'inserted'
      }),
      'refine-unsent'
    )
    assert.equal(
      resolveAdditiveFollowUpMode({
        composerStatus: 'empty',
        composerText: '',
        draft: 'I’ll take you to the movie tomorrow.',
        insertedText: 'I’ll take you to the movie tomorrow.',
        entryStatus: 'inserted'
      }),
      'new-follow-up'
    )
    assert.equal(
      resolveAdditiveFollowUpMode({
        composerStatus: 'has-text',
        composerText: 'edited by me',
        draft: 'edited by me',
        insertedText: 'original insert',
        entryStatus: 'inserted',
        draftEditedLocally: true
      }),
      'blocked-edit'
    )
  })

  it('keeps a distinct third person in the draft prompt and does not treat tell-her as literal', () => {
    const prompt = whatsAppDraftPrompt({
      chatName: 'Dad',
      instruction: 'Also tell him I’m taking Gayu to the movie at 7 PM',
      pronoun: 'him'
    })
    assert.match(prompt, /Also tell her…|also tell/i)
    assert.match(prompt, /different person|third person/i)
    assert.match(prompt, /Never change AM to PM/)
    const tell = parseWhatsAppReplyIntent('Tell her I’ll take her to the movie tomorrow.', {
      messaging: 'whatsapp',
      waChat: 'Gayu Sis'
    })
    assert.notEqual(tell?.literal, true)
  })

  it('flags ambiguous times like 3 AM + 230 without guessing AM/PM', () => {
    assert.deepEqual(parseCompactClockDigits('230'), { hour: 2, minute: 30 })
    assert.equal(parseCompactClockDigits('2024'), null)
    const amb = detectAmbiguousTimes('the movie is at 3 AM and be ready by 230')
    assert.ok(amb)
    assert.match(amb?.question ?? '', /You said 3 AM/i)
    assert.match(amb?.question ?? '', /230/)
    assert.ok(amb?.choices.some((c) => /2:30 PM/i.test(c)))
    assert.ok(amb?.choices.some((c) => /Keep as written/i.test(c)))
    assert.equal(amb?.originalInstruction.includes('3 AM'), true)
    assert.equal(detectAmbiguousTimes('the movie is at 3 PM. Be ready by 2:30 PM'), null)
    assert.equal(
      applyTimeClarification('movie at 3 AM, ready by 230', '230', '2:30 PM'),
      'movie at 3 AM, ready by 2:30 PM'
    )
    assert.equal(
      applyTimeClarification('movie at 3 AM, ready by 230', '230', 'Keep as written'),
      'movie at 3 AM, ready by 230'
    )
  })

  it('parses summarize/refine paraphrases and preserves destination exactness', () => {
    const scoop = parseWhatsAppSummarizeIntent("what's the scoop on that chat", { waChat: 'Mum' })
    assert.equal(scoop?.scope, 'incoming')
    const gist = parseWhatsAppSummarizeIntent('gimme the gist of this chat', { waChat: 'Dad' })
    assert.equal(gist?.scope, 'incoming')
    assert.equal(parseWhatsAppSummarizeIntent("what's the scoop on that chat"), null)

    const trim = parseWhatsAppReplyIntent('trim that down a bit', { draftActive: true })
    assert.equal(trim?.refine, true)
    assert.equal(trim?.instruction, 'shorter')
    const briefer = parseWhatsAppReplyIntent('make the draft briefer', { draftActive: true })
    assert.equal(briefer?.refine, true)
    assert.equal(briefer?.instruction, 'shorter')

    // Ambiguous near-matches still fail destination checks (unsent draft safety).
    assert.equal(recipientMatchesOpenChat('Me 2', 'Me'), false)
    assert.equal(recipientMatchesOpenChat('Me', 'Me 2'), false)
  })
})
