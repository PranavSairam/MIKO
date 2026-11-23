import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { frameBudgetMs, shouldDrawFrame } from './frame-pacing.ts'

describe('pet frame pacing', () => {
  it('uses 60 fps while anything visibly moves', () => {
    for (const k of ['walking', 'dragging', 'flying', 'playing', 'exiting', 'pointerMoving'] as const) {
      assert.equal(frameBudgetMs({ [k]: true }), 1000 / 60, k)
    }
  })

  it('drops to 30 fps when the pet is just idling', () => {
    assert.equal(frameBudgetMs({}), 1000 / 30)
  })

  it('on a 120 Hz display draws every 2nd frame when active and every 4th when idle', () => {
    const tick = 1000 / 120
    const count = (budget: number): number => {
      let last = 0
      let drawn = 0
      for (let i = 1; i <= 120; i++) {
        const now = i * tick
        if (shouldDrawFrame(now, last, budget)) {
          drawn += 1
          last = now
        }
      }
      return drawn
    }
    assert.equal(count(frameBudgetMs({ walking: true })), 60)
    assert.equal(count(frameBudgetMs({})), 30)
  })

  it('never skips on a 60 Hz display when active', () => {
    let last = 0
    let drawn = 0
    for (let i = 1; i <= 60; i++) {
      const now = i * (1000 / 60) + (i % 2 ? 0.4 : -0.4) // jitter
      if (shouldDrawFrame(now, last, frameBudgetMs({ walking: true }))) {
        drawn += 1
        last = now
      }
    }
    assert.equal(drawn, 60)
  })
})
