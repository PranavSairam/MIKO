import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { PET_WINDOW } from './layout.ts'
import {
  GUIDE_DEAD_ZONE,
  acceptDestination,
  clampTravel,
  guideDestination,
  nextGuideTarget
} from './guide.ts'

describe('guide destination', () => {
  it('maps the pointer onto the pet center inside the work area', () => {
    const span = 1600
    const centered = guideDestination(900, 400, 400, span)
    assert.equal(centered, 900 - PET_WINDOW.width / 2)
    const left = guideDestination(-200, 400, 400, span)
    assert.equal(left, 0)
    const right = guideDestination(5000, 400, 400, span)
    assert.equal(right, span)
  })

  it('ignores jitter and a reversal that has not cleared the dog', () => {
    assert.equal(nextGuideTarget(null, 810, 800), null)
    assert.equal(nextGuideTarget(null, 800 + GUIDE_DEAD_ZONE + 1, 800), 800 + GUIDE_DEAD_ZONE + 1)
    assert.equal(acceptDestination(1000, 1020, 800), 1000)
    assert.equal(nextGuideTarget(1000, 780, 800), 1000)
    assert.equal(nextGuideTarget(1000, 700, 800), 700)
  })

  it('clamps a typed step at the edge', () => {
    const step = clampTravel(1500, 1600, 150)
    assert.equal(step.destination, 1600)
    assert.equal(step.clamped, true)
    const little = clampTravel(400, 1600, -60)
    assert.equal(little.destination, 340)
    assert.equal(little.clamped, false)
  })
})
