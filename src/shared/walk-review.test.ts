import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  WALK_CYCLE_SECONDS,
  WALK_FPS,
  WALK_FRAME_COUNT,
  WALK_SLOW_RATE,
  WALK_TORSO_TRAVEL_SOURCE,
  stepWalkFrame,
  travelExportPx,
  travelPxPerCycle,
  walkFrameIndex,
  walkImageTop,
  walkPawLine,
  walkTravelX
} from './walk-review.ts'

describe('walk review', () => {
  it('plays the stride at the original 24 fps timing', () => {
    assert.equal(WALK_CYCLE_SECONDS, 2.75)
    assert.equal(WALK_FRAME_COUNT / WALK_FPS, WALK_CYCLE_SECONDS)
    assert.equal(walkFrameIndex(0), 0)
    assert.equal(walkFrameIndex(1 / WALK_FPS), 1)
    assert.equal(walkFrameIndex(1), 24)
    assert.equal(walkFrameIndex(WALK_CYCLE_SECONDS - 0.001), 65)
    assert.equal(walkFrameIndex(WALK_CYCLE_SECONDS), 0)
    assert.equal(walkFrameIndex(-0.01), 65)
  })

  it('keeps 0.25× on the same stride over eleven seconds', () => {
    const wall = WALK_CYCLE_SECONDS / WALK_SLOW_RATE
    assert.equal(wall, 11)
    assert.equal(walkFrameIndex(wall * WALK_SLOW_RATE), 0)
    assert.equal(walkFrameIndex((1 / WALK_FPS) / WALK_SLOW_RATE * WALK_SLOW_RATE), 1)
  })

  it('matches the preview travel to the torso movement of one stride', () => {
    assert.equal(WALK_TORSO_TRAVEL_SOURCE, 128.5)
    assert.equal(travelExportPx(), 128.5 * (504 / 956))
    assert.equal(travelPxPerCycle(), 128.5 * (168 / 956))
    assert.equal(walkTravelX(0), 0)
    assert.equal(walkTravelX(WALK_CYCLE_SECONDS), travelPxPerCycle())
    assert.equal(walkTravelX(11 * WALK_SLOW_RATE), travelPxPerCycle())
  })

  it('keeps every frame on one ground line', () => {
    assert.equal(walkPawLine(), 184)
    assert.ok(walkImageTop() > 0)
  })

  it('steps one frame at a time and loops', () => {
    assert.equal(stepWalkFrame(0, -1), 65)
    assert.equal(stepWalkFrame(65, 1), 0)
    assert.equal(stepWalkFrame(24, 1), 25)
  })
})
