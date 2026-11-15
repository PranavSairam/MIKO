import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { hostMatchesSite, hostOf, isFresh } from './context.ts'

describe('working context helpers', () => {
  it('matches domain boundaries without confusing youtube.com and notyoutube.com', () => {
    assert.equal(hostMatchesSite('www.youtube.com', 'youtube.com'), true)
    assert.equal(hostMatchesSite('m.youtube.com', 'youtube.com'), true)
    assert.equal(hostMatchesSite('notyoutube.com', 'youtube.com'), false)
    assert.equal(hostOf('https://www.youtube.com/watch?v=1'), 'youtube.com')
  })

  it('treats captures as fresh within the window', () => {
    const now = Date.now()
    assert.equal(isFresh(now - 1000, now, 5000), true)
    assert.equal(isFresh(now - 10_000, now, 5000), false)
  })
})
