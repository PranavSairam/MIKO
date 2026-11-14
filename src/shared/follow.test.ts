import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { perchPoint, settleKey } from './follow.ts'

describe('follow the active window', () => {
  it('waits until the foreground window stops changing', () => {
    const first = settleKey(null, 'chrome', 1000, 600)
    assert.equal(first.ready, false)
    const flipped = settleKey(first.state, 'notes', 1200, 600)
    assert.equal(flipped.ready, false)
    const held = settleKey(flipped.state, 'notes', 1900, 600)
    assert.equal(held.ready, true)
  })

  it('stands on the nearest point of the window bottom, inside the work area', () => {
    const work = { x: 0, y: 0, width: 1800, height: 1130 }
    const near = perchPoint({ x: 40, y: 800 }, { x: 800, y: 100, width: 400, height: 500 }, work)
    assert.equal(near.x, 800 - 110)
    assert.equal(near.y, 600 - 250)
    const low = perchPoint({ x: 40, y: 800 }, { x: 100, y: 900, width: 400, height: 400 }, work)
    assert.equal(low.y, 1130 - 250 - 16)
    const edge = perchPoint({ x: 1700, y: 800 }, { x: 1600, y: 200, width: 500, height: 300 }, work)
    assert.equal(edge.x, 1800 - 220 - 16)
  })
})
