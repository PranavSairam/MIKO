import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { parseBrowserOnly, resolveSite, splitBrowserPreference } from './sites.ts'

describe('sites', () => {
  it('resolves YouTube and common hosts', () => {
    assert.deepEqual(resolveSite('youtube'), { url: 'https://www.youtube.com/', name: 'YouTube' })
    assert.deepEqual(resolveSite('YouTube'), { url: 'https://www.youtube.com/', name: 'YouTube' })
    assert.equal(resolveSite('chrome'), null)
    assert.equal(resolveSite('not-a-site-xyz'), null)
  })

  it('splits a trailing browser preference', () => {
    assert.deepEqual(splitBrowserPreference('youtube in Chrome'), { rest: 'youtube', browser: 'chrome' })
    assert.deepEqual(splitBrowserPreference('youtube'), { rest: 'youtube', browser: null })
  })

  it('parses a browser-only follow-up', () => {
    assert.equal(parseBrowserOnly('in chrome'), 'chrome')
    assert.equal(parseBrowserOnly('in Google Chrome'), 'chrome')
    assert.equal(parseBrowserOnly('open it in safari'), 'safari')
    assert.equal(parseBrowserOnly('actually use safari instead'), 'safari')
    assert.equal(parseBrowserOnly('switch that to chrome'), 'chrome')
    assert.equal(parseBrowserOnly('open youtube'), null)
  })

  it('resolves video-site and netflix aliases', () => {
    assert.deepEqual(resolveSite('that video site'), { url: 'https://www.youtube.com/', name: 'YouTube' })
    assert.deepEqual(resolveSite('netflix'), { url: 'https://www.netflix.com/', name: 'Netflix' })
    assert.deepEqual(resolveSite('github'), { url: 'https://github.com/', name: 'GitHub' })
  })
})
