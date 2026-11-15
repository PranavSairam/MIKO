/**
 * Structured preferences + correction examples (local, not training).
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  DEFAULT_PREFERENCES,
  parseExamples,
  parsePreferences,
  retrieveExamples
} from './preferences.ts'

describe('preferences and correction examples', () => {
  it('parses structured preferences defensively', () => {
    assert.deepEqual(parsePreferences(null), {
      preferredBrowser: null,
      writingTone: 'natural',
      preferredLanguage: null,
      notes: '',
      defaultChromeProfileDirectory: null,
      defaultChromeProfileName: null,
      chromeProfileAliases: []
    })
    const p = parsePreferences({
      preferredBrowser: 'chrome',
      writingTone: 'formal',
      preferredLanguage: 'English',
      notes: 'Keep replies short.',
      defaultChromeProfileDirectory: 'Profile 8',
      defaultChromeProfileName: 'Work',
      chromeProfileAliases: [{ alias: 'office', directoryId: 'Profile 8' }, { alias: 'bad', directoryId: '../x' }]
    })
    assert.equal(p.preferredBrowser, 'chrome')
    assert.equal(p.writingTone, 'formal')
    assert.equal(p.preferredLanguage, 'English')
    assert.equal(p.notes, 'Keep replies short.')
    assert.equal(p.defaultChromeProfileDirectory, 'Profile 8')
    assert.equal(p.defaultChromeProfileName, 'Work')
    assert.deepEqual(p.chromeProfileAliases, [{ alias: 'office', directoryId: 'Profile 8' }])
    assert.equal(DEFAULT_PREFERENCES.writingTone, 'natural')
    assert.equal(parsePreferences({ defaultChromeProfileDirectory: '/tmp' }).defaultChromeProfileDirectory, null)
  })

  it('parses and retrieves correction examples without private bodies', () => {
    const list = parseExamples([
      { id: 'a', wording: 'boot up that video site', actionKind: 'open_website', createdAt: 1 },
      { id: 'b', wording: 'ping Dad on WA', actionKind: 'open_whatsapp_chat', targetAlias: 'Dad', createdAt: 2 },
      { id: 'bad', wording: 12, actionKind: 'x' }
    ])
    assert.equal(list.length, 2)
    const hit = retrieveExamples(list, 'boot up youtube for me', 3)
    assert.equal(hit[0]?.actionKind, 'open_website')
    assert.ok(!JSON.stringify(hit).includes('message body'))
  })
})
