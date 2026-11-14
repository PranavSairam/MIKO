import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { PET_WINDOW } from './layout.ts'
import { placeAtWorkAreaBottom } from './movement.ts'
import {
  PHOTO_CYCLE_SECONDS,
  PHOTO_FRAME_COUNT,
  PHOTO_SPEED_PX,
  PHOTO_STAND_FRAME,
  PHOTO_START_LEFT,
  PHOTO_WALK_SECONDS,
  photoFrameBox,
  photoFrameIndex,
  photoHitRect,
  photoShownFrame,
  photoTravelPx,
  placeMotionWalkStart
} from './photo-walk.ts'

describe('photo walk', () => {
  it('plays the six frames on a one-second cycle', () => {
    assert.equal(PHOTO_CYCLE_SECONDS, 1)
    assert.equal(PHOTO_FRAME_COUNT, 6)
    assert.equal(photoFrameIndex(0), 0)
    assert.equal(photoFrameIndex(1 / 6), 1)
    assert.equal(photoFrameIndex(1 - 1e-6), 5)
    assert.equal(photoFrameIndex(1), 0)
    assert.equal(photoFrameIndex(1 + 1 / 6), 1)
  })

  it('travels at the preview speed and then holds the stand', () => {
    assert.equal(PHOTO_SPEED_PX, 51.7)
    assert.equal(photoTravelPx(0), 0)
    assert.equal(photoTravelPx(PHOTO_CYCLE_SECONDS), PHOTO_SPEED_PX)
    assert.equal(photoTravelPx(PHOTO_WALK_SECONDS), PHOTO_SPEED_PX * PHOTO_WALK_SECONDS)
    assert.equal(photoTravelPx(PHOTO_WALK_SECONDS + 4), photoTravelPx(PHOTO_WALK_SECONDS))
    assert.equal(photoShownFrame(0.5, false), photoFrameIndex(0.5))
    assert.equal(photoShownFrame(PHOTO_WALK_SECONDS, true), PHOTO_STAND_FRAME)
    assert.equal(PHOTO_STAND_FRAME, 1)
  })

  it('starts a little left of bottom center and keeps the clear margin out of the hit box', () => {
    const work = { x: 100, y: 40, width: 1800, height: 1000 }
    const centered = placeAtWorkAreaBottom(work)
    const start = placeMotionWalkStart(work)
    assert.equal(start.x, centered.x - PHOTO_START_LEFT)
    assert.equal(start.y, centered.y)
    assert.equal(PHOTO_START_LEFT, 80)

    const frame = photoFrameBox()
    const hit = photoHitRect()
    assert.ok(hit.x > frame.x)
    assert.ok(hit.y > frame.y)
    assert.ok(hit.x + hit.width < frame.x + frame.width)
    assert.ok(hit.y + hit.height < frame.y + frame.height)
    assert.equal(frame.width, 168)
    assert.equal(frame.x, (PET_WINDOW.width - 168) / 2)
  })
})
