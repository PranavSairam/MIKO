/**
 * Chrome profile matching helpers (no filesystem / no Chrome launch).
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  isValidChromeDirectoryId,
  matchChromeProfiles,
  parseChromeUsePhrase,
  profileInitials,
  safeHttpUrl,
  splitChromeProfilePhrase,
  withDuplicateLabels,
  type ChromeProfileView
} from './chrome-profiles.ts'

function profile(partial: Partial<ChromeProfileView> & Pick<ChromeProfileView, 'directoryId' | 'displayName'>): ChromeProfileView {
  return {
    secondaryLabel: null,
    initials: profileInitials(partial.displayName),
    avatarDataUrl: null,
    accent: null,
    isSavedDefault: false,
    ...partial
  }
}

describe('chrome profile helpers', () => {
  it('validates directory ids and builds initials / duplicate labels', () => {
    assert.equal(isValidChromeDirectoryId('Default'), true)
    assert.equal(isValidChromeDirectoryId('Profile 8'), true)
    assert.equal(isValidChromeDirectoryId('../etc'), false)
    assert.equal(isValidChromeDirectoryId('/tmp/evil'), false)
    assert.equal(profileInitials('Work'), 'WO')
    assert.equal(profileInitials('Pranav Sairam'), 'PS')
    assert.equal(profileInitials(''), '?')
    const labeled = withDuplicateLabels([
      { directoryId: 'Profile 7', displayName: 'srmist.edu.in' },
      { directoryId: 'Profile 9', displayName: 'srmist.edu.in' },
      { directoryId: 'Profile 8', displayName: 'Work' }
    ])
    assert.equal(labeled[0]?.secondaryLabel, 'Profile 7')
    assert.equal(labeled[1]?.secondaryLabel, 'Profile 9')
    assert.equal(labeled[2]?.secondaryLabel, null)
  })

  it('matches zero / one / many and aliases; never invents', () => {
    const profiles = [
      profile({ directoryId: 'Default', displayName: 'Pranav' }),
      profile({ directoryId: 'Profile 8', displayName: 'Work' }),
      profile({ directoryId: 'Profile 7', displayName: 'srmist.edu.in' }),
      profile({ directoryId: 'Profile 9', displayName: 'srmist.edu.in' })
    ]
    assert.equal(matchChromeProfiles('Work', profiles).kind, 'one')
    assert.equal(matchChromeProfiles('srmist.edu.in', profiles).kind, 'many')
    assert.equal(matchChromeProfiles('Nope', profiles).kind, 'none')
    assert.equal(matchChromeProfiles('', profiles).kind, 'none')
    assert.equal(matchChromeProfiles('Work', []).kind, 'none')
    const aliased = matchChromeProfiles('office', profiles, [{ alias: 'office', directoryId: 'Profile 8' }])
    assert.equal(aliased.kind, 'one')
    if (aliased.kind === 'one') assert.equal(aliased.profile.directoryId, 'Profile 8')
    // Unusual characters still match when present as the display name.
    const weird = [profile({ directoryId: 'Profile 1', displayName: 'José “Work” 🚀' })]
    assert.equal(matchChromeProfiles('José “Work” 🚀', weird).kind, 'one')
  })

  it('parses open/choose/profile phrases and keeps URL schemes safe', () => {
    assert.deepEqual(splitChromeProfilePhrase('choose chrome profile'), {
      rest: '',
      browser: 'chrome',
      profileQuery: null,
      forceChooser: true
    })
    assert.deepEqual(splitChromeProfilePhrase('open Chrome with Work'), {
      rest: '',
      browser: 'chrome',
      profileQuery: 'Work',
      forceChooser: false
    })
    const site = splitChromeProfilePhrase('gmail.com in my Personal Chrome profile')
    assert.equal(site.browser, 'chrome')
    assert.equal(site.profileQuery, 'Personal')
    assert.match(site.rest, /gmail\.com/i)
    assert.equal(parseChromeUsePhrase('use Work'), 'Work')
    assert.equal(parseChromeUsePhrase('the second one'), null)
    assert.equal(safeHttpUrl('https://www.youtube.com/'), 'https://www.youtube.com/')
    assert.equal(safeHttpUrl('javascript:alert(1)'), null)
    assert.equal(safeHttpUrl('file:///etc/passwd'), null)
  })

  it('treats explicit profile override as higher priority than a saved default in matching', () => {
    const profiles = [
      profile({ directoryId: 'Default', displayName: 'Pranav', isSavedDefault: true }),
      profile({ directoryId: 'Profile 8', displayName: 'Work' })
    ]
    const hit = matchChromeProfiles('Work', profiles)
    assert.equal(hit.kind, 'one')
    if (hit.kind === 'one') {
      assert.equal(hit.profile.directoryId, 'Profile 8')
      assert.equal(hit.profile.isSavedDefault, false)
    }
  })
})
