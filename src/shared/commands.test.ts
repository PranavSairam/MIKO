import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  MAIL_REQUEST,
  mailRequestFor,
  movementLine,
  planVoice,
  parseActionId,
  routeCommand,
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
    assert.equal(routeCommand('open chrome', 'typed', catalog, [], { assistantActive: true }).type, 'launch')
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
