import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  buildMatches,
  chatRowName,
  forgetAlias,
  matchId,
  parseAliases,
  parseChooserIndex,
  planWhatsApp,
  rememberAlias,
  resolveAlias,
  sameContact
} from './whatsapp.ts'

describe('WhatsApp contact names', () => {
  it('reads a chat row without its unread count', () => {
    assert.equal(chatRowName('\u200eMum, \u200e1 unread message'), 'Mum')
    assert.equal(chatRowName('V T S MUKUNDAN'), 'V T S MUKUNDAN')
    assert.equal(chatRowName('HOME, 2 unread messages'), 'HOME')
  })

  it('puts exact name matches first and keeps a snippet identity', () => {
    const matches = buildMatches(
      [
        { name: 'Sandy Mum', snippet: 'Video call' },
        { name: 'Mum', snippet: 'ramayana tkt' },
        { name: 'Vishals Mum', snippet: 'You reacted' }
      ],
      'Mum'
    )
    assert.deepEqual(
      matches.map((m) => m.name),
      ['Mum', 'Sandy Mum', 'Vishals Mum']
    )
    assert.equal(matches[0].exact, true)
    assert.equal(matches[0].id, matchId('Mum', 'ramayana tkt'))
    assert.notEqual(matchId('Mum', 'a'), matchId('Mum', 'b'))
  })

  it('opens one exact row and asks when several remain', () => {
    const one = planWhatsApp('Mum', [{ name: 'Mum', snippet: 'hello' }], { inspected: true })
    assert.equal(one.action, 'open')
    if (one.action === 'open') assert.equal(one.match.name, 'Mum')

    const many = planWhatsApp(
      'Mum',
      [
        { name: 'Mum', snippet: 'a' },
        { name: 'Sandy Mum', snippet: 'b' }
      ],
      { inspected: true }
    )
    assert.equal(many.action, 'choices')
    if (many.action === 'choices') {
      assert.deepEqual(
        many.matches.map((m) => m.name),
        ['Mum', 'Sandy Mum']
      )
      assert.equal(many.matches[0].exact, true)
    }

    assert.equal(planWhatsApp('zzzznomatch', [], { inspected: true }).action, 'none')
    assert.equal(planWhatsApp('Mum', [], { inspected: false }).action, 'assisted')
  })

  it('revalidates a picked id and refreshes when it disappeared', () => {
    const id = matchId('Mum', 'ramayana')
    const ok = planWhatsApp('Mum', [{ name: 'Mum', snippet: 'ramayana' }], { inspected: true, pickId: id })
    assert.equal(ok.action, 'open')

    const gone = planWhatsApp(
      'Mum',
      [
        { name: 'Sandy Mum', snippet: 'x' },
        { name: 'Vishals Mum', snippet: 'y' }
      ],
      { inspected: true, pickId: id }
    )
    assert.equal(gone.action, 'choices')
    if (gone.action === 'choices') assert.equal(gone.matches.some((m) => m.id === id), false)

    const twin = planWhatsApp(
      'Mum',
      [
        { name: 'Mum', snippet: '' },
        { name: 'Mum', snippet: '' }
      ],
      { inspected: true, pickId: matchId('Mum', '') }
    )
    // Same name and empty snippet collapse to one match id, so a pick still opens.
    assert.equal(twin.action, 'open')
  })

  it('revalidates a saved destination and will not open a different chat', () => {
    assert.deepEqual(
      planWhatsApp('Muku', [{ name: 'V T S MUKUNDAN', snippet: 'hi' }], { inspected: true, expect: 'V T S MUKUNDAN' }).action,
      'open'
    )
    assert.equal(planWhatsApp('Muku', [{ name: 'Someone else', snippet: '' }], { inspected: true, expect: 'V T S MUKUNDAN' }).action, 'none')
  })
})

describe('WhatsApp chooser voice', () => {
  it('reads numbered and ordinal picks against the active list', () => {
    assert.equal(parseChooserIndex('the second one', 4), 1)
    assert.equal(parseChooserIndex('2', 4), 1)
    assert.equal(parseChooserIndex('number 3', 4), 2)
    assert.equal(parseChooserIndex('first', 3), 0)
    assert.equal(parseChooserIndex('last', 3), 2)
    assert.equal(parseChooserIndex('the fifth one', 3), null)
    assert.equal(parseChooserIndex('open Mum in WhatsApp', 3), null)
  })
})

describe('WhatsApp aliases', () => {
  it('remembers, finds, replaces, and forgets a name', () => {
    const saved = rememberAlias([], 'Muku', 'V T S MUKUNDAN')
    assert.equal(saved.ok, true)
    if (!saved.ok) return
    assert.deepEqual(resolveAlias(saved.list, 'muku'), { alias: 'Muku', name: 'V T S MUKUNDAN' })
    const replaced = rememberAlias(saved.list, 'Muku', 'Mum')
    assert.equal(replaced.ok, true)
    if (!replaced.ok) return
    assert.equal(resolveAlias(replaced.list, 'Muku')?.name, 'Mum')
    assert.equal(sameContact('Mum', 'mum'), true)
    const gone = forgetAlias(replaced.list, 'Muku')
    assert.equal(gone.ok, true)
    if (!gone.ok) return
    assert.equal(resolveAlias(gone.list, 'Muku'), null)
    assert.equal(forgetAlias(gone.list, 'Muku').ok, false)
  })

  it('drops a stored alias that is no longer valid', () => {
    assert.deepEqual(parseAliases([{ alias: 'Muku', name: 'V T S MUKUNDAN' }, { alias: '', name: 'x' }, 'nope']), [
      { alias: 'Muku', name: 'V T S MUKUNDAN' }
    ])
  })
})
