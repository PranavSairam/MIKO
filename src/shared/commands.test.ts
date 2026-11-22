import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  MAIL_REQUEST,
  mailRequestFor,
  movementLine,
  planVoice,
  parseActionId,
  routeCommand,
  routeDiagnostics,
  type CatalogApp
} from './commands.ts'

const catalog: CatalogApp[] = [
  { id: 'chrome', name: 'Chrome', installed: true, familiar: true, aliases: ['chrome', 'google chrome'] },
  { id: 'browser', name: 'Browser', installed: true, familiar: true, aliases: ['browser', 'my browser'] },
  { id: 'excel', name: 'Excel', installed: true, familiar: true, aliases: ['excel', 'my spreadsheets app', 'office'] },
  { id: 'word', name: 'Word', installed: true, familiar: true, aliases: ['word', 'office'] },
  { id: 'powerpoint', name: 'PowerPoint', installed: false, familiar: true, aliases: ['powerpoint', 'office'] },
  { id: 'app-font-book', name: 'Font Book', installed: true, familiar: false, aliases: ['font book'] }
]

describe('command router', () => {
  it('walks and poses, by typing or by voice', () => {
    assert.deepEqual(routeCommand('move left', 'typed', catalog), { type: 'move', direction: 'left', distance: 150 })
    assert.deepEqual(routeCommand('a little right', 'typed', catalog), { type: 'move', direction: 'right', distance: 60 })
    assert.deepEqual(routeCommand('go to the left corner', 'typed', catalog), { type: 'corner', edge: 'left' })
    assert.deepEqual(routeCommand('come back', 'typed', catalog), { type: 'home' })
    assert.deepEqual(routeCommand('sit', 'typed', catalog), { type: 'pose', pose: 'sit' })
    assert.equal(routeCommand('resume wandering', 'typed', catalog).type, 'pose')
    assert.deepEqual(routeCommand('Move right.', 'voice', catalog), { type: 'move', direction: 'right', distance: 150 })
    assert.deepEqual(routeCommand('Sit.', 'voice', catalog), { type: 'pose', pose: 'sit' })
    assert.equal(movementLine('move', 'left', true, false), 'Walking left, up to the edge.')
    assert.equal(movementLine('home', 'right', false, true), 'I\u2019m already home.')
  })

  it('launches a known app, asks before an unfamiliar one, and lists ambiguous matches', () => {
    assert.deepEqual(routeCommand('open my spreadsheets app', 'typed', catalog), {
      type: 'launch',
      appId: 'excel',
      name: 'Excel'
    })
    assert.equal(routeCommand('open font book', 'typed', catalog).type, 'confirm')
    const choices = routeCommand('open office', 'typed', catalog)
    assert.equal(choices.type, 'choices')
    if (choices.type === 'choices') {
      assert.deepEqual(
        choices.options.map((option) => option.id),
        ['excel', 'word']
      )
    }
    const missing = routeCommand('open photoshop', 'typed', catalog)
    assert.equal(missing.type, 'missing')
    if (missing.type === 'missing') assert.match(missing.text, /Photoshop/)
  })

  it('routes go-to / switch-to / bring-forward app phrases before the assistant', () => {
    const apps: CatalogApp[] = [
      ...catalog,
      { id: 'app-cursor', name: 'Cursor', installed: true, familiar: false, aliases: ['cursor'] },
      { id: 'app-spotify', name: 'Spotify', installed: true, familiar: false, aliases: ['spotify'] },
      { id: 'whatsapp', name: 'WhatsApp', installed: true, familiar: true, aliases: ['whatsapp', 'whats app'] },
      { id: 'calculator', name: 'Calculator', installed: true, familiar: true, aliases: ['calculator', 'calc'] }
    ]
    for (const source of ['typed', 'voice'] as const) {
      const cursor = routeCommand('Go to Cursor', source, apps, [], { assistantActive: true })
      assert.equal(cursor.type, 'confirm', source)
      if (cursor.type === 'confirm') {
        assert.equal(cursor.appId, 'app-cursor')
        assert.equal(cursor.name, 'Cursor')
      }
      const spotify = routeCommand('Switch to Spotify', source, apps)
      assert.equal(spotify.type, 'confirm')
      if (spotify.type === 'confirm') assert.equal(spotify.appId, 'app-spotify')
      const wa = routeCommand('Bring WhatsApp forward', source, apps)
      assert.equal(wa.type, 'launch')
      if (wa.type === 'launch') assert.equal(wa.appId, 'whatsapp')
      const chrome = routeCommand('Take me back to Chrome', source, apps)
      assert.equal(chrome.type, 'launch')
      if (chrome.type === 'launch') assert.equal(chrome.appId, 'chrome')
      const calc = routeCommand('Open Calculator', source, apps)
      assert.equal(calc.type, 'launch')
      if (calc.type === 'launch') assert.equal(calc.appId, 'calculator')
    }
    // Website vs app
    const yt = routeCommand('Go to youtube.com', 'typed', apps)
    assert.equal(yt.type, 'open-url')
    if (yt.type === 'open-url') assert.match(yt.url, /youtube/i)
    // Question / negation / literal type
    assert.equal(routeCommand('How do I switch to Cursor?', 'typed', apps).type, 'question')
    assert.notEqual(routeCommand("Don't switch to Cursor", 'typed', apps).type, 'confirm')
    assert.notEqual(routeCommand("Don't switch to Cursor", 'typed', apps).type, 'launch')
    const literal = routeCommand('Type exactly: go to Cursor', 'typed', apps)
    assert.equal(literal.type, 'type-dest')
    // Bare back uses last external app; clarify when missing
    const backMiss = routeCommand('Take me back', 'typed', apps)
    assert.equal(backMiss.type, 'unknown')
    if (backMiss.type === 'unknown') assert.match(backMiss.text, /not sure which app/i)
    const backHit = routeCommand('go back', 'voice', apps, [], {
      lastExternalApp: { name: 'Chrome', bundleId: 'com.google.Chrome' }
    })
    assert.equal(backHit.type, 'launch')
    if (backHit.type === 'launch') assert.equal(backHit.appId, 'chrome')
    assert.equal(planVoice(routeCommand('Go to Cursor', 'voice', apps), true).kind, 'confirm')
  })

  it('closes a named app, asks before force or quitting itself, and follows on request', () => {
    assert.deepEqual(routeCommand('close excel', 'typed', catalog), { type: 'close', appId: 'excel', name: 'Excel' })
    assert.deepEqual(routeCommand('quit chrome', 'typed', catalog), { type: 'close', appId: 'chrome', name: 'Chrome' })
    assert.deepEqual(routeCommand('force quit excel', 'typed', catalog), {
      type: 'force-close',
      appId: 'excel',
      name: 'Excel'
    })
    assert.equal(routeCommand('quit', 'typed', catalog).type, 'close-self')
    assert.equal(routeCommand('close miko', 'typed', catalog).type, 'close-self')
    const which = routeCommand('close office', 'typed', catalog)
    assert.equal(which.type, 'choices')
    if (which.type === 'choices') {
      assert.equal(which.purpose, 'close')
      assert.deepEqual(
        which.options.map((option) => option.id),
        ['excel', 'word']
      )
    }
    assert.equal(routeCommand('close photoshop', 'typed', catalog).type, 'missing')
    assert.equal(routeCommand('How do I close Excel?', 'typed', catalog).type, 'question')
    assert.deepEqual(routeCommand('stay here', 'typed', catalog), { type: 'follow', mode: 'stay' })
    assert.deepEqual(routeCommand('follow me', 'typed', catalog), { type: 'follow', mode: 'follow' })
    assert.deepEqual(routeCommand('come here', 'typed', catalog), { type: 'follow', mode: 'come' })
    assert.equal(routeCommand('stay', 'typed', catalog).type, 'pose')
  })

  it('treats a question as a handoff and rejects raw action text', () => {
    const asked = routeCommand('How do I open Excel?', 'typed', catalog)
    assert.deepEqual(asked, { type: 'question', prompt: 'How do I open Excel?' })
    assert.equal(routeCommand('please write a haiku', 'typed', catalog).type, 'question')
    assert.equal(routeCommand('can you open excel', 'typed', catalog).type, 'launch')
    assert.equal(parseActionId('excel'), 'excel')
    assert.equal(parseActionId('app-font-book'), 'app-font-book')
    assert.equal(parseActionId('excel; rm -rf /'), null)
    assert.equal(parseActionId('../Downloads'), null)
  })
})

describe('planVoice', () => {
  it('runs clear commands when automatic execution is on', () => {
    assert.equal(planVoice(routeCommand('move left', 'voice', catalog), true).kind, 'run')
    assert.equal(planVoice(routeCommand('sit', 'voice', catalog), true).kind, 'run')
    assert.equal(planVoice(routeCommand('follow me', 'voice', catalog), true).kind, 'run')
    assert.equal(planVoice(routeCommand('open excel', 'voice', catalog), true).kind, 'run')
  })
  it('asks before closing, force quitting, quitting MIKO, or opening an unfamiliar app', () => {
    assert.equal(planVoice(routeCommand('close excel', 'voice', catalog), true).kind, 'confirm')
    assert.equal(planVoice(routeCommand('force quit excel', 'voice', catalog), true).kind, 'confirm')
    assert.equal(planVoice(routeCommand('quit miko', 'voice', catalog), true).kind, 'confirm')
    assert.equal(planVoice(routeCommand('open font book', 'voice', catalog), true).kind, 'confirm')
  })
  it('hands questions to the ChatGPT card', () => {
    assert.equal(planVoice(routeCommand('how do I center a div', 'voice', catalog), true).kind, 'handoff')
  })
  it('sends ambiguous, unknown and missing commands to review', () => {
    assert.deepEqual(planVoice({ type: 'choices', purpose: 'open', text: 'Which one?', options: [] }, true), {
      kind: 'review',
      reason: 'ambiguous'
    })
    assert.deepEqual(planVoice(routeCommand('bark twice', 'voice', catalog), true), { kind: 'review', reason: 'unclear' })
    assert.deepEqual(planVoice(routeCommand('open zzfakeapp', 'voice', catalog), true), { kind: 'review', reason: 'unclear' })
  })
  it('reviews everything when automatic execution is off', () => {
    assert.deepEqual(planVoice(routeCommand('move left', 'voice', catalog), false), { kind: 'review', reason: 'off' })
    assert.deepEqual(planVoice(routeCommand('close excel', 'voice', catalog), false), { kind: 'review', reason: 'off' })
  })
})

describe('ChatGPT commands', () => {
  const chats = [
    { name: 'FreshNet', url: 'https://chatgpt.com/c/6735a1b2-0c1d' },
    { name: 'Major project', url: 'https://chatgpt.com/g/g-p-67a0b1c2d3e4-major/project' },
    { name: 'Major exam prep', url: 'https://chatgpt.com/c/aaaaaaaa-bbbb' }
  ]
  it('opens ChatGPT itself', () => {
    assert.deepEqual(routeCommand('open ChatGPT', 'typed', catalog, chats), { type: 'open-chatgpt' })
    assert.deepEqual(routeCommand('Open chat GPT.', 'voice', catalog, chats), { type: 'open-chatgpt' })
  })
  it('opens saved chats by name and asks when ambiguous', () => {
    assert.deepEqual(routeCommand('open my FreshNet chat', 'typed', catalog, chats), {
      type: 'open-chat',
      name: 'FreshNet',
      url: 'https://chatgpt.com/c/6735a1b2-0c1d'
    })
    assert.equal(routeCommand('Open my major project chat.', 'voice', catalog, chats).type, 'open-chat')
    const many = routeCommand('open my major chat', 'typed', catalog, chats)
    assert.equal(many.type, 'chat-choices')
    assert.deepEqual(many.type === 'chat-choices' && many.options.map((c) => c.name), ['Major project', 'Major exam prep'])
    assert.equal(routeCommand('open my biology chat', 'typed', catalog, chats).type, 'missing')
  })
  it('shows saved chats', () => {
    assert.deepEqual(routeCommand('show saved chats', 'typed', catalog, chats), { type: 'list-chats' })
    assert.deepEqual(routeCommand('Show my saved chats.', 'voice', catalog, chats), { type: 'list-chats' })
  })
  it('keeps the exact question for ask GPT', () => {
    assert.deepEqual(routeCommand('ask GPT What is a B-tree, really?', 'typed', catalog, chats), {
      type: 'ask-gpt',
      question: 'What is a B-tree, really?'
    })
    assert.deepEqual(routeCommand('Ask ChatGPT, how do I cook rice?', 'voice', catalog, chats), {
      type: 'ask-gpt',
      question: 'how do I cook rice?'
    })
    assert.equal(routeCommand('ask gpt', 'typed', catalog, chats).type, 'unknown')
  })
  it('plans voice: open runs, ask is a handoff, ambiguous chats are reviewed', () => {
    assert.equal(planVoice(routeCommand('open chatgpt', 'voice', catalog, chats), true).kind, 'run')
    assert.equal(planVoice(routeCommand('open my freshnet chat', 'voice', catalog, chats), true).kind, 'run')
    assert.equal(planVoice(routeCommand('show saved chats', 'voice', catalog, chats), true).kind, 'run')
    assert.equal(planVoice(routeCommand('ask gpt why is the sky blue', 'voice', catalog, chats), true).kind, 'handoff')
    assert.deepEqual(planVoice(routeCommand('open my major chat', 'voice', catalog, chats), true), { kind: 'review', reason: 'ambiguous' })
  })
})

describe('mail routing', () => {
  it('handles mail intent before app launching', () => {
    assert.deepEqual(routeCommand('chk mail', 'voice', catalog), { type: 'mail', intent: { kind: 'recent' } })
    assert.deepEqual(routeCommand('show my latest emails', 'typed', catalog), { type: 'mail', intent: { kind: 'recent' } })
    assert.deepEqual(routeCommand('important unread mail', 'typed', catalog), { type: 'mail', intent: { kind: 'important', unreadOnly: true } })
    assert.deepEqual(routeCommand('search mail invoice', 'typed', catalog), { type: 'mail', intent: { kind: 'search', query: 'invoice' } })
    assert.deepEqual(routeCommand('emails from Imran', 'typed', catalog), { type: 'mail', intent: { kind: 'search', query: 'from:Imran' } })
    assert.deepEqual(routeCommand('open the second email', 'typed', catalog), { type: 'mail', intent: { kind: 'open', index: 2 } })
    assert.equal(planVoice(routeCommand('chk mail', 'voice', catalog), true).kind, 'run')
  })
  it('keeps the ChatGPT mail handoff on request', () => {
    assert.deepEqual(routeCommand('check mail in ChatGPT', 'typed', catalog), { type: 'check-mail', prompt: MAIL_REQUEST })
    assert.match(MAIL_REQUEST, /Keep messages unread and make this a read-only check\./)
  })
  it('in the Mail tab, bare keywords search mail', () => {
    assert.deepEqual(routeCommand('invoice', 'typed', catalog, [], { mailTab: true }), { type: 'mail', intent: { kind: 'search', query: 'invoice' } })
    assert.deepEqual(routeCommand('find tax refund', 'typed', catalog, [], { mailTab: true }), { type: 'mail', intent: { kind: 'search', query: 'tax refund' } })
    assert.equal(routeCommand('move left', 'typed', catalog, [], { mailTab: true }).type, 'move')
  })
  it('outside it, ambiguous search phrases ask', () => {
    assert.deepEqual(routeCommand('find invoice', 'typed', catalog), { type: 'mail-or-app', query: 'invoice' })
    assert.deepEqual(planVoice(routeCommand('search tax refund', 'voice', catalog), true), { kind: 'review', reason: 'ambiguous' })
    assert.equal(routeCommand('open calculator', 'typed', catalog).type !== 'mail-or-app', true)
  })
})

describe('bridge commands', () => {
  it('recognises the bridge test and new-conversation commands', () => {
    assert.deepEqual(routeCommand('Reply with MIKO bridge test', 'typed', catalog), { type: 'bridge-test' })
    assert.deepEqual(routeCommand('miko bridge test.', 'voice', catalog), { type: 'bridge-test' })
    assert.deepEqual(routeCommand('bridge new conversation', 'typed', catalog), { type: 'bridge-new' })
    assert.equal(planVoice(routeCommand('miko bridge test', 'voice', catalog), true).kind, 'run')
  })
})

describe('assistant routing', () => {
  it('sends questions and writing requests to the assistant, keeps local commands local', () => {
    assert.equal(routeCommand('Write a two-line poem about rain', 'typed', catalog).type, 'question')
    assert.equal(routeCommand('summarize the benefits of sleep', 'voice', catalog).type, 'question')
    assert.equal(routeCommand('move left', 'typed', catalog, [], { assistantActive: true }).type, 'move')
    assert.equal(routeCommand('open chrome', 'typed', catalog, [], { assistantActive: true }).type, 'chrome-profiles')
    assert.deepEqual(routeCommand('check mail', 'typed', catalog, [], { assistantActive: true }), { type: 'mail', intent: { kind: 'recent' } })
  })
  it('treats other text as a follow-up while a conversation is active', () => {
    assert.deepEqual(routeCommand('shorter and friendlier', 'typed', catalog, [], { assistantActive: true }), { type: 'question', prompt: 'shorter and friendlier' })
    assert.equal(routeCommand('shorter and friendlier', 'typed', catalog).type, 'unknown')
  })
  it('treats imperative writing and knowledge requests as assistant requests', () => {
    for (const t of ['Say only the word ready.', 'Give me three name ideas for a dog', 'Translate hello to Tamil', 'List five fruits', 'Make a packing list for Goa', 'Help me plan my week'])
      assert.equal(routeCommand(t, 'typed', catalog).type, 'question', t)
    for (const t of ['show saved chats', 'sit', 'move left', 'open chrome', 'check mail'])
      assert.notEqual(routeCommand(t, 'typed', catalog).type, 'question', t)
  })
  it('starts a new conversation on request', () => {
    for (const t of ['new conversation', 'start a new conversation', 'bridge new conversation', 'New chat.'])
      assert.deepEqual(routeCommand(t, 'typed', catalog), { type: 'bridge-new' }, t)
  })
  it('keeps ChatGPT app shortcuts for existing chats and memory', () => {
    assert.equal(routeCommand('ask GPT what did we decide about FreshNet?', 'typed', catalog).type, 'ask-gpt')
    assert.equal(routeCommand('open ChatGPT', 'typed', catalog).type, 'open-chatgpt')
  })
})

describe('mailRequestFor (ChatGPT mail handoff)', () => {
  it('uses the read-only check for browsing intents', () => {
    assert.equal(mailRequestFor({ kind: 'recent' }), MAIL_REQUEST)
    assert.match(mailRequestFor({ kind: 'unread' }), /^Show my unread email/)
    assert.match(mailRequestFor({ kind: 'important', unreadOnly: true }), /Urgent, Action needed, and Important FYI/)
  })
  it('turns a search into a read-only search request with the exact terms', () => {
    const text = mailRequestFor({ kind: 'search', query: 'from:Imran invoice' })
    assert.match(text, /for: from:Imran invoice\./)
    assert.match(text, /read-only/)
    assert.match(text, /Keep messages unread/)
  })
  it('has nothing to hand off for "open the second email"', () => {
    assert.equal(mailRequestFor({ kind: 'open', index: 2 }), '')
  })
})

describe('type into ChatGPT', () => {
  it('reads "type … in GPT" requests and keeps the exact text', () => {
    assert.deepEqual(routeCommand('type hello there in GPT', 'typed', catalog), { type: 'type-in-gpt', text: 'hello there' })
    assert.deepEqual(routeCommand('Type "What is a B-tree?" in ChatGPT.', 'voice', catalog), { type: 'type-in-gpt', text: 'What is a B-tree?' })
    assert.deepEqual(routeCommand('write Summarize my week into chat gpt', 'typed', catalog), { type: 'type-in-gpt', text: 'Summarize my week' })
    assert.deepEqual(routeCommand('put this in chatgpt: Draft a polite reminder', 'typed', catalog), { type: 'type-in-gpt', text: 'Draft a polite reminder' })
    assert.deepEqual(routeCommand('type in gpt: hi', 'typed', catalog), { type: 'type-in-gpt', text: 'hi' })
    assert.deepEqual(routeCommand('Type into GPT: open WhatsApp', 'voice', catalog), {
      type: 'type-in-gpt',
      text: 'open WhatsApp'
    })
    assert.deepEqual(routeCommand('dictate into GPT: hello there', 'typed', catalog), {
      type: 'type-in-gpt',
      text: 'hello there'
    })
  })

  it('keeps ordinary voice commands on the shared router (Interactive GPT open is not a mode)', () => {
    const apps: CatalogApp[] = [
      ...catalog,
      { id: 'whatsapp', name: 'WhatsApp', installed: true, familiar: true, aliases: ['whatsapp', 'whats app'] },
      { id: 'app-cursor', name: 'Cursor', installed: true, familiar: false, aliases: ['cursor'] }
    ]
    // Same decision path for typed and voice — source is metadata only.
    for (const source of ['typed', 'voice'] as const) {
      const wa = routeCommand('Open WhatsApp', source, apps)
      assert.equal(wa.type, 'launch', source)
      if (wa.type === 'launch') assert.equal(wa.appId, 'whatsapp')
      const cursor = routeCommand('Go to Cursor', source, apps)
      assert.equal(cursor.type, 'confirm', source)
      const move = routeCommand('Move left', source, apps)
      assert.deepEqual(move, { type: 'move', direction: 'left', distance: 150 })
      const chrome = routeCommand('Open ChatGPT in Chrome', source, apps)
      assert.equal(chrome.type, 'open-url', source)
    }
  })
  it('strips "type in gpt asking it to …" down to the request', () => {
    assert.deepEqual(routeCommand('type in gpt asking it to generate me a text file of a wrd saying cat', 'typed', catalog), {
      type: 'type-in-gpt',
      text: 'generate me a text file of a wrd saying cat'
    })
    assert.deepEqual(routeCommand('type in chatgpt to write a haiku', 'typed', catalog), { type: 'type-in-gpt', text: 'write a haiku' })
    assert.deepEqual(routeCommand('write in gpt and ask it to list 3 fruits', 'typed', catalog), { type: 'type-in-gpt', text: 'list 3 fruits' })
    assert.deepEqual(routeCommand('type in gpt summarize this article', 'typed', catalog), { type: 'type-in-gpt', text: 'summarize this article' })
  })
  it('sends messages addressed to GPT into ChatGPT', () => {
    assert.deepEqual(routeCommand('hi gpt', 'typed', catalog), { type: 'type-in-gpt', text: 'hi gpt' })
    assert.deepEqual(routeCommand('Hey ChatGPT, how are you?', 'typed', catalog), { type: 'type-in-gpt', text: 'Hey ChatGPT, how are you?' })
    assert.deepEqual(routeCommand('gpt: summarize my week', 'typed', catalog), { type: 'type-in-gpt', text: 'summarize my week' })
    assert.deepEqual(routeCommand('tell gpt to draft a leave letter', 'typed', catalog), { type: 'type-in-gpt', text: 'draft a leave letter' })
    assert.equal(routeCommand('open chatgpt', 'typed', catalog).type, 'open-chatgpt')
    assert.equal(routeCommand('ask gpt why is the sky blue', 'typed', catalog).type, 'ask-gpt')
  })
  it('asks for the text when none is given, and is a run for voice', () => {
    assert.equal(routeCommand('type in gpt', 'typed', catalog).type, 'unknown')
    assert.equal(planVoice(routeCommand('type hello in gpt', 'voice', catalog), true).kind, 'run')
  })
})

describe('WhatsApp contacts', () => {
  const apps = [
    ...catalog,
    { id: 'whatsapp', name: 'WhatsApp', installed: true, familiar: true, aliases: ['whatsapp', 'whats app'] },
    { id: 'calculator', name: 'Calculator', installed: true, familiar: true, aliases: ['calculator', 'calc'] }
  ]
  const chats = [
    { name: 'FreshNet', url: 'https://chatgpt.com/c/6735a1b2-0c1d' },
    { name: 'Major project', url: 'https://chatgpt.com/g/g-p-67a0b1c2d3e4-major/project' },
    { name: 'Major exam prep', url: 'https://chatgpt.com/c/aaaaaaaa-bbbb' }
  ]
  it('sends an explicit WhatsApp person to WhatsApp and still launches the app', () => {
    assert.deepEqual(routeCommand('open Mum in WhatsApp', 'typed', apps, chats), { type: 'whatsapp', query: 'Mum' })
    assert.deepEqual(routeCommand('open WhatsApp chat with Mum', 'voice', apps, chats), { type: 'whatsapp', query: 'Mum' })
    assert.deepEqual(routeCommand('find Mukundan on WhatsApp', 'voice', apps, chats), { type: 'whatsapp', query: 'Mukundan' })
    assert.deepEqual(routeCommand('open WhatsApp', 'typed', apps, chats), { type: 'launch', appId: 'whatsapp', name: 'WhatsApp' })
    assert.equal(planVoice(routeCommand('open Mum in WhatsApp', 'voice', apps, chats), true).kind, 'run')
    assert.equal(routeCommand('How do I open Mum in WhatsApp?', 'typed', apps, chats).type, 'question')
  })
  it('routes open-and-search compounds through WhatsApp, not the app catalog', () => {
    for (const source of ['typed', 'voice'] as const) {
      const compound = routeCommand('Open WhatsApp and search for Mukundan.', source, apps, chats)
      assert.equal(compound.type, 'whatsapp', source)
      if (compound.type === 'whatsapp') assert.equal(compound.query, 'Mukundan')
      const openOpen = routeCommand('Open WhatsApp and open Mukundan.', source, apps, chats)
      assert.equal(openOpen.type, 'whatsapp', source)
      if (openOpen.type === 'whatsapp') assert.equal(openOpen.query, 'Mukundan')
      const searchIn = routeCommand('Search for Mukundan in WhatsApp.', source, apps, chats)
      assert.equal(searchIn.type, 'whatsapp', source)
      if (searchIn.type === 'whatsapp') assert.equal(searchIn.query, 'Mukundan')
      const typo = routeCommand('Open Mukundan in Whatsaappp.', source, apps, chats)
      assert.equal(typo.type, 'whatsapp', source)
      if (typo.type === 'whatsapp') assert.equal(typo.query, 'Mukundan')
      assert.equal(planVoice(compound, true).kind, 'run')
    }
    // Follow-up after WhatsApp is active — not mail-or-app.
    const follow = routeCommand('search for Mukundan', 'typed', apps, chats, { messaging: 'whatsapp' })
    assert.equal(follow.type, 'whatsapp')
    if (follow.type === 'whatsapp') assert.equal(follow.query, 'Mukundan')
    // Bare “open Gayu Sis” after Open WhatsApp → contact (catalog apps still win).
    const gayu = routeCommand('Open Gayu Sis.', 'typed', apps, chats, { messaging: 'whatsapp' })
    assert.equal(gayu.type, 'whatsapp')
    if (gayu.type === 'whatsapp') assert.equal(gayu.query, 'Gayu Sis')
    assert.equal(routeCommand('open calculator', 'typed', apps, chats, { messaging: 'whatsapp' }).type, 'launch')
    assert.equal(routeCommand('open Chrome', 'typed', apps, chats, { messaging: 'whatsapp' }).type, 'chrome-profiles')
    // Unknown product name with messaging → contact search (not a silent alias).
    const photoWhileWa = routeCommand('open photoshop', 'typed', apps, chats, { messaging: 'whatsapp' })
    assert.equal(photoWhileWa.type, 'whatsapp')
    // Genuine missing app still reports correctly without messaging context.
    const missing = routeCommand('open photoshop', 'typed', apps, chats)
    assert.equal(missing.type, 'missing')
    const routed = routeCommand('Open WhatsApp and search for Mukundan.', 'typed', apps, chats)
    const diag = routeDiagnostics('Open WhatsApp and search for Mukundan.', routed)
    assert.equal(diag.capability, 'open_whatsapp_chat')
    assert.match(diag.action, /whatsapp:Mukundan/)
    assert.doesNotMatch(diag.normalized, /I can.?t find/i)
  })
  it('keeps an exact saved chat, and asks when a bare chat could be either', () => {
    assert.deepEqual(routeCommand('open my FreshNet chat', 'typed', apps, chats), {
      type: 'open-chat',
      name: 'FreshNet',
      url: 'https://chatgpt.com/c/6735a1b2-0c1d'
    })
    assert.deepEqual(routeCommand('open FreshNet chat', 'typed', apps, chats), {
      type: 'open-chat',
      name: 'FreshNet',
      url: 'https://chatgpt.com/c/6735a1b2-0c1d'
    })
    assert.deepEqual(routeCommand('open Muku chat', 'typed', apps, chats), { type: 'chat-or-whatsapp', name: 'Muku' })
    assert.equal(planVoice(routeCommand('open Muku chat', 'voice', apps, chats), true).kind, 'review')
    assert.deepEqual(routeCommand('open Muku chat', 'typed', apps, chats, { messaging: 'whatsapp' }), { type: 'whatsapp', query: 'Muku' })
    assert.equal(routeCommand('open my major chat', 'typed', apps, chats).type, 'chat-choices')
    assert.equal(routeCommand('open my biology chat', 'typed', apps, chats).type, 'missing')
  })
  it('forgets a WhatsApp alias by name', () => {
    assert.deepEqual(routeCommand('forget WhatsApp alias Muku', 'typed', apps), { type: 'whatsapp-forget', alias: 'Muku' })
    assert.deepEqual(routeCommand('show WhatsApp aliases', 'voice', apps), { type: 'whatsapp-aliases' })
  })
})

describe('clear', () => {
  it('clears the panel on "clear" and similar', () => {
    for (const t of ['clear', 'Clear.', 'clear chat', 'clear all', 'clear the screen', 'clear everything'])
      assert.deepEqual(routeCommand(t, 'typed', catalog, [], { assistantActive: true, mailTab: false }), { type: 'clear' }, t)
    assert.equal(planVoice(routeCommand('clear', 'voice', catalog), true).kind, 'run')
  })
  it('does not swallow other uses of the word', () => {
    assert.notEqual(routeCommand('clear my calendar for friday', 'typed', catalog).type, 'clear')
    assert.equal(routeCommand('type clear in gpt', 'typed', catalog).type, 'type-in-gpt')
  })
})

describe('screenshot command routing regressions', () => {
  const apps = [
    ...catalog,
    { id: 'whatsapp', name: 'WhatsApp', installed: true, familiar: true, aliases: ['whatsapp', 'whats app'] },
    { id: 'calculator', name: 'Calculator', installed: true, familiar: true, aliases: ['calculator', 'calc'] }
  ]

  it('opens YouTube locally even after ok/please and with an active assistant thread', () => {
    const open = routeCommand('ok open youtube', 'typed', apps, [], { assistantActive: true })
    assert.equal(open.type, 'open-url')
    if (open.type === 'open-url') {
      assert.equal(open.url, 'https://www.youtube.com/')
      assert.equal(open.name, 'YouTube')
      assert.equal(open.browser ?? null, null)
    }
    const chrome = routeCommand('open YouTube in Chrome', 'typed', apps)
    assert.equal(chrome.type, 'open-url')
    if (chrome.type === 'open-url') assert.equal(chrome.browser, 'chrome')
  })

  it('parses Open ChatGPT/GPT/YouTube + browser as website+browser, not an app name', () => {
    for (const source of ['typed', 'voice'] as const) {
      const gptChrome = routeCommand('Open ChatGPT in Chrome', source, apps)
      assert.equal(gptChrome.type, 'open-url')
      if (gptChrome.type === 'open-url') {
        assert.match(gptChrome.url, /chatgpt\.com/i)
        assert.equal(gptChrome.name, 'ChatGPT')
        assert.equal(gptChrome.browser, 'chrome')
      }
      const gptSafari = routeCommand('Open ChatGPT using Safari', source, apps)
      assert.equal(gptSafari.type, 'open-url')
      if (gptSafari.type === 'open-url') {
        assert.match(gptSafari.url, /chatgpt\.com/i)
        assert.equal(gptSafari.browser, 'safari')
      }
      const short = routeCommand('Open GPT in Chrome', source, apps)
      assert.equal(short.type, 'open-url')
      if (short.type === 'open-url') {
        assert.match(short.url, /chatgpt\.com/i)
        assert.equal(short.browser, 'chrome')
      }
      const yt = routeCommand('Open YouTube in Chrome', source, apps)
      assert.equal(yt.type, 'open-url')
      if (yt.type === 'open-url') {
        assert.match(yt.url, /youtube/i)
        assert.equal(yt.browser, 'chrome')
      }
    }
    const bare = routeCommand('Open ChatGPT', 'typed', apps)
    assert.equal(bare.type, 'open-chatgpt')
    const missingBlob = routeCommand('Open ChatGPT in Chrome', 'typed', apps)
    assert.notEqual(missingBlob.type, 'missing')
  })

  it('resolves a follow-up “in chrome” against the pending site', () => {
    const follow = routeCommand('in chrome', 'typed', apps, [], {
      pendingUrl: { url: 'https://www.youtube.com/', name: 'YouTube' }
    })
    assert.equal(follow.type, 'open-url')
    if (follow.type === 'open-url') {
      assert.equal(follow.url, 'https://www.youtube.com/')
      assert.equal(follow.name, 'YouTube')
      assert.equal(follow.browser, 'chrome')
    }
    const alone = routeCommand('in chrome', 'typed', apps)
    assert.equal(alone.type, 'unknown')
    if (alone.type === 'unknown') assert.match(alone.text, /Open what/i)
  })

  it('splits open+type so the message stays out of contact lookup', () => {
    const open = routeCommand(
      "open Me in WhatsApp and type hi Anna I'll be starting to Chennai tmrw",
      'typed',
      apps
    )
    assert.equal(open.type, 'whatsapp')
    if (open.type === 'whatsapp') {
      assert.equal(open.query, 'Me')
      assert.equal(open.pendingDraft, "hi Anna I'll be starting to Chennai tmrw")
    }
  })

  it('routes recipient corrections while awaiting a WhatsApp name — not the assistant', () => {
    const awaiting = { awaitingWaRecipient: true, messaging: 'whatsapp' as const, assistantActive: true }
    for (const [phrase, query] of [
      ['Santosh G', 'Santosh G'],
      ['I meant Santosh G', 'Santosh G'],
      ['Search Santosh G instead', 'Santosh G'],
      ['find Santosh G', 'Santosh G']
    ] as const) {
      const decision = routeCommand(phrase, 'typed', apps, [], awaiting)
      assert.equal(decision.type, 'whatsapp', phrase)
      if (decision.type === 'whatsapp') assert.equal(decision.query, query, phrase)
    }
    // Without a pending wait, a bare name must not invent a WhatsApp open.
    assert.notEqual(routeCommand('Santosh G', 'typed', apps, [], { assistantActive: true }).type, 'whatsapp')
    // Explicit app commands still supersede the wait.
    assert.equal(routeCommand('open calculator', 'typed', apps, [], awaiting).type, 'launch')
    assert.equal(routeCommand('never mind', 'typed', apps, [], awaiting).type, 'cancel-workflow')
  })

  it('types into the verified WhatsApp chat after open, including formal polish', () => {
    const typed = routeCommand('type tht ill be goin chennai tmrw mrng in a formal way', 'typed', apps, [], {
      messaging: 'whatsapp',
      waChat: 'Me'
    })
    assert.equal(typed.type, 'whatsapp-reply')
    if (typed.type === 'whatsapp-reply') {
      assert.equal(typed.intent.replyHere, true)
      assert.equal(typed.intent.autoInsert, true)
      assert.equal(typed.intent.literal, false)
      assert.match(typed.intent.instruction, /formal/i)
      assert.match(typed.intent.instruction, /tht ill be goin chennai tmrw mrng/i)
      assert.doesNotMatch(typed.intent.instruction, /in a formal way$/i)
    }
    const noTarget = routeCommand('type tht ill be goin chennai tmrw mrng in a formal way', 'typed', apps)
    assert.notEqual(noTarget.type, 'whatsapp-reply')
  })

  it('cancels pending workflow phrases locally', () => {
    for (const phrase of [
      'ok leave it',
      'leave it',
      'never mind',
      'cancel that',
      'scratch that',
      'abort that',
      'drop it',
      'skip that'
    ]) {
      assert.equal(routeCommand(phrase, 'typed', apps, [], { assistantActive: true }).type, 'cancel-workflow', phrase)
    }
  })

  it('routes Chrome profile open / choose / explicit profile commands', () => {
    const open = routeCommand('open Chrome', 'typed', apps)
    assert.equal(open.type, 'chrome-profiles')
    if (open.type === 'chrome-profiles') {
      assert.equal(open.forceChooser, false)
      assert.equal(open.profileQuery ?? null, null)
    }
    const choose = routeCommand('choose chrome profile', 'typed', apps)
    assert.equal(choose.type, 'chrome-profiles')
    if (choose.type === 'chrome-profiles') assert.equal(choose.forceChooser, true)
    const withProfile = routeCommand('open Chrome with Work', 'typed', apps)
    assert.equal(withProfile.type, 'chrome-profiles')
    if (withProfile.type === 'chrome-profiles') assert.equal(withProfile.profileQuery, 'Work')
    const yt = routeCommand('open YouTube in Chrome', 'typed', apps)
    assert.equal(yt.type, 'open-url')
    if (yt.type === 'open-url') {
      assert.equal(yt.browser, 'chrome')
      assert.match(yt.url, /youtube/i)
    }
    const gmail = routeCommand('open gmail.com in my Personal Chrome profile', 'typed', apps)
    assert.equal(gmail.type, 'open-url')
    if (gmail.type === 'open-url') {
      assert.equal(gmail.browser, 'chrome')
      assert.equal(gmail.chromeProfileQuery, 'Personal')
      assert.match(gmail.url, /mail\.google|gmail/i)
    }
  })

  it('opens/closes sites with slang verbs and strips for-me trailers', () => {
    const boot = routeCommand('can you boot up that video site for me', 'typed', apps)
    assert.equal(boot.type, 'open-url')
    if (boot.type === 'open-url') assert.match(boot.url, /youtube/i)
    const fire = routeCommand('fire up netflix for me', 'typed', apps)
    assert.equal(fire.type, 'open-url')
    if (fire.type === 'open-url') assert.match(fire.url, /netflix/i)
    const kill = routeCommand('get rid of every youtube tab', 'voice', apps)
    assert.equal(kill.type, 'close-website')
    if (kill.type === 'close-website') assert.equal(kill.all, true)
    const ditch = routeCommand('ditch every github tab', 'voice', apps)
    assert.equal(ditch.type, 'close-website')
  })

  it('routes browser-instead follow-ups, mail slang search, and WA paraphrases', () => {
    const safari = routeCommand('actually use safari instead', 'typed', apps, [], {
      pendingUrl: { url: 'https://www.youtube.com/', name: 'YouTube' }
    })
    assert.equal(safari.type, 'open-url')
    if (safari.type === 'open-url') assert.equal(safari.browser, 'safari')
    const chrome = routeCommand('switch that to chrome', 'typed', apps, [], {
      pendingUrl: { url: 'https://www.youtube.com/', name: 'YouTube' }
    })
    assert.equal(chrome.type, 'open-url')
    if (chrome.type === 'open-url') assert.equal(chrome.browser, 'chrome')

    const invoice = routeCommand('dig up that invoice mail from last week', 'typed', apps)
    assert.equal(invoice.type, 'mail')
    if (invoice.type === 'mail') assert.equal(invoice.intent.kind, 'search')

    const scoop = routeCommand("what's the scoop on that chat", 'typed', apps, [], {
      waChat: 'Mum',
      messaging: 'whatsapp'
    })
    assert.equal(scoop.type, 'whatsapp-summarize')

    const gist = routeCommand('gimme the gist of this chat', 'typed', apps, [], { waChat: 'Dad' })
    assert.equal(gist.type, 'whatsapp-summarize')

    const trim = routeCommand('trim that down a bit', 'typed', apps, [], { waDraftActive: true })
    assert.equal(trim.type, 'whatsapp-reply')
    if (trim.type === 'whatsapp-reply') {
      assert.equal(trim.intent.refine, true)
      assert.equal(trim.intent.instruction, 'shorter')
    }
    const briefer = routeCommand('make the draft briefer', 'typed', apps, [], { waDraftActive: true })
    assert.equal(briefer.type, 'whatsapp-reply')
    if (briefer.type === 'whatsapp-reply') assert.equal(briefer.intent.refine, true)

    const tell = routeCommand('tell them hi from me', 'voice', apps, [], {
      waChat: 'Me 2',
      messaging: 'whatsapp'
    })
    assert.equal(tell.type, 'whatsapp-reply')
  })

  it('keeps ordinary questions on the assistant and gates WA shorthand without a verified chat', () => {
    assert.equal(routeCommand('how tall is the eiffel tower roughly', 'typed', apps).type, 'question')
    assert.equal(routeCommand('why is the sky blue', 'typed', apps).type, 'question')
    // “say …” only binds when a WA target is verified; pronoun “tell them …” still routes but insert revalidates.
    assert.notEqual(routeCommand('say thanks and that I will look tomorrow', 'typed', apps).type, 'whatsapp-reply')
    const tell = routeCommand('tell them hi from me', 'typed', apps)
    assert.equal(tell.type, 'whatsapp-reply')
    if (tell.type === 'whatsapp-reply') {
      assert.equal(tell.intent.pronoun, 'them')
      assert.equal(tell.intent.replyHere, true)
    }
  })

  it('summarizes the open WhatsApp chat instead of the assistant thread', () => {
    const sum = routeCommand('summarize', 'typed', apps, [], { waChat: 'Me', messaging: 'whatsapp', assistantActive: true })
    assert.equal(sum.type, 'whatsapp-summarize')
    if (sum.type === 'whatsapp-summarize') assert.equal(sum.intent.scope, 'incoming')
    const noWa = routeCommand('summarize', 'typed', apps, [], { assistantActive: true })
    assert.equal(noWa.type, 'question')
  })

  it('routes reply saying into WhatsApp when a chat is verified, not Mail', () => {
    const reply = routeCommand("reply saying thanks, I'll check tomorrow", 'typed', apps, [], {
      waChat: 'Me 2',
      messaging: 'whatsapp'
    })
    assert.equal(reply.type, 'whatsapp-reply')
    if (reply.type === 'whatsapp-reply') {
      assert.match(reply.intent.instruction, /thanks/i)
      assert.equal(reply.intent.autoInsert, true)
    }
    const mailish = routeCommand("reply saying thanks, I'll check tomorrow", 'typed', apps, [])
    assert.equal(mailish.type, 'mail')
  })

  it('refines an active WhatsApp draft with make it shorter', () => {
    const refine = routeCommand('make it shorter', 'typed', apps, [], {
      waChat: 'Me 2',
      messaging: 'whatsapp',
      waDraftActive: true
    })
    assert.equal(refine.type, 'whatsapp-reply')
    if (refine.type === 'whatsapp-reply') {
      assert.equal(refine.intent.refine, true)
      assert.equal(refine.intent.instruction, 'shorter')
    }
  })

  it('closes a website by host without quitting the browser app', () => {
    const close = routeCommand('close YouTube', 'typed', apps)
    assert.equal(close.type, 'close-website')
    if (close.type === 'close-website') {
      assert.equal(close.name, 'YouTube')
      assert.match(close.host || '', /youtube/i)
    }
    const closeIt = routeCommand('close it', 'typed', apps, [], {
      lastWebsite: { url: 'https://www.youtube.com/', name: 'YouTube' }
    })
    assert.equal(closeIt.type, 'close-website')
  })

  it('parses open Dad and tell him without eating the message into the contact name', () => {
    const open = routeCommand(
      "Open Dad in WhatsApp and tell him I'll visit next month, professionally.",
      'typed',
      apps
    )
    assert.equal(open.type, 'whatsapp')
    if (open.type === 'whatsapp') {
      assert.equal(open.query, 'Dad')
      assert.match(open.pendingDraft || '', /visit next month/i)
    }
  })

  it('strips reply-saying wrappers from compound open+draft and supports go-to navigation', () => {
    const replySaying = routeCommand('Open Dad in WhatsApp and reply saying good morning', 'typed', apps)
    assert.equal(replySaying.type, 'whatsapp')
    if (replySaying.type === 'whatsapp') {
      assert.equal(replySaying.query, 'Dad')
      assert.equal(replySaying.pendingDraft, 'good morning')
    }

    const openWaGo = routeCommand('Open WhatsApp, go to Dad and say good morning', 'typed', apps)
    assert.equal(openWaGo.type, 'whatsapp')
    if (openWaGo.type === 'whatsapp') {
      assert.equal(openWaGo.query, 'Dad')
      assert.equal(openWaGo.pendingDraft, 'good morning')
    }

    const goOnly = routeCommand('Go to Dad', 'typed', apps, [], {
      messaging: 'whatsapp',
      waChat: 'Me'
    })
    assert.equal(goOnly.type, 'whatsapp')
    if (goOnly.type === 'whatsapp') {
      assert.equal(goOnly.query, 'Dad')
      assert.equal(goOnly.pendingDraft, undefined)
    }

    const multiTurn = routeCommand('Tell him good morning', 'voice', apps, [], {
      messaging: 'whatsapp',
      waChat: 'Dad'
    })
    assert.equal(multiTurn.type, 'whatsapp-reply')
    if (multiTurn.type === 'whatsapp-reply') {
      assert.equal(multiTurn.intent.instruction, 'good morning')
      assert.notEqual(multiTurn.intent.literal, true)
    }
  })

  it('preserves original casing and negations for questions', () => {
    const q = routeCommand("please don't open that", 'typed', apps, [], { assistantActive: true })
    // Not an open command after lead strip — “don't open that” is not matchOpen.
    assert.notEqual(q.type, 'open-url')
    assert.notEqual(q.type, 'launch')
  })
})

describe('pet commands in the router', () => {
  it('switches pets by name and leaves other switch commands alone', () => {
    assert.deepEqual(routeCommand('switch to the cat', 'typed', catalog), { type: 'pet', pet: 'cat' })
    assert.deepEqual(routeCommand('make miko a koala', 'voice', catalog), { type: 'pet', pet: 'koala' })
    assert.deepEqual(routeCommand('be a dog again', 'typed', catalog), { type: 'pet', pet: 'doberman' })
    assert.deepEqual(routeCommand('change pet', 'typed', catalog), { type: 'pet-choose' })
    assert.notEqual(routeCommand('switch to chrome', 'typed', catalog).type, 'pet')
    assert.equal(planVoice({ type: 'pet', pet: 'bird' }, true).kind, 'run')
  })
})
