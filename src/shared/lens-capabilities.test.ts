import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { lensCapabilityProfile } from './lens-capabilities.ts'

describe('lensCapabilityProfile', () => {
  it('exposes Media for Spotify but not Interactive', () => {
    const p = lensCapabilityProfile('Spotify', 'Spotify Premium', 'com.spotify.client')
    assert.equal(p.ownerKind, 'spotify')
    const byId = Object.fromEntries(p.capabilities.map((c) => [c.id, c]))
    assert.equal(byId.view?.available, true)
    assert.equal(byId.media?.available, true)
    assert.equal(byId.interactive?.available, false)
    assert.equal(byId['control-original']?.available, true)
    assert.match(byId.interactive?.detail || '', /not reliable|not offered/i)
  })

  it('does not grant Media to ChatGPT or Finder', () => {
    const gpt = lensCapabilityProfile('ChatGPT', 'New chat', 'com.openai.chat')
    assert.equal(gpt.capabilities.find((c) => c.id === 'media')?.available, false)
    const finder = lensCapabilityProfile('Finder', 'Documents', 'com.apple.finder')
    assert.equal(finder.capabilities.find((c) => c.id === 'media')?.available, false)
    assert.equal(finder.capabilities.find((c) => c.id === 'interactive')?.available, false)
  })

  it('does not advertise Lens actions on Windows', () => {
    const p = lensCapabilityProfile('ChatGPT', 'New chat', 'com.openai.chat', 'win32')
    assert.equal(p.ownerKind, 'chatgpt')
    assert.equal(p.defaultMode, 'view')
    assert.equal(p.capabilities.every((c) => c.available === false), true)
    assert.match(p.capabilities.find((c) => c.id === 'view')?.detail || '', /not available on Windows/i)
  })
})
