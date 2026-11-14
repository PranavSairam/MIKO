import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
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
