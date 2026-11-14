import { PET_WINDOW, layoutWindow, type Point, type Rect } from './layout.ts'
import { placeAtWorkAreaBottom } from './movement.ts'

/** Six approved frames, one cycle per second, at the preview travel speed. */
export const PHOTO_FRAME_COUNT = 6
export const PHOTO_CYCLE_SECONDS = 1
export const PHOTO_SPEED_PX = 51.7
/** One short crossing: two cycles, then hold. */
export const PHOTO_WALK_CYCLES = 2
export const PHOTO_WALK_SECONDS = PHOTO_WALK_CYCLES * PHOTO_CYCLE_SECONDS
/**
 * walk-01. Its four paws sit closest together, so the hold reads as a stand
 * rather than a reach.
 */
export const PHOTO_STAND_FRAME = 1
/** A little left of the bottom-center summon, in DIP. */
export const PHOTO_START_LEFT = 80

export const PHOTO_SOURCE_PX = 512
export const PHOTO_FRAME_PX = 168
export const PHOTO_BOTTOM_MARGIN = 16
/** Union of opaque pixels across walk-00 … walk-05. */
export const PHOTO_OPAQUE = { x: 24, y: 110, width: 439, height: 297 } as const

export interface PhotoHitRect {
  x: number
  y: number
  width: number
  height: number
}

export function photoFrameIndex(elapsedSeconds: number): number {
  const cycle = PHOTO_CYCLE_SECONDS
  const wrapped = ((elapsedSeconds % cycle) + cycle) % cycle
  const index = Math.floor((wrapped / cycle) * PHOTO_FRAME_COUNT + 1e-9)
  return index >= PHOTO_FRAME_COUNT ? 0 : index
}

/** After the crossing, hold the stand. During the crossing, follow the cycle. */
export function photoShownFrame(elapsedSeconds: number, finished: boolean): number {
  if (finished) return PHOTO_STAND_FRAME
  return photoFrameIndex(elapsedSeconds)
}

export function photoTravelPx(elapsedSeconds: number): number {
  const elapsed = Math.min(PHOTO_WALK_SECONDS, Math.max(0, elapsedSeconds))
  return elapsed * PHOTO_SPEED_PX
}

export function placeMotionWalkStart(work: Rect): Point {
  const centered = placeAtWorkAreaBottom(work)
  return layoutWindow({ x: centered.x - PHOTO_START_LEFT, y: centered.y }, false, work, 'left').pet
}

/** Opaque puppy inside the square frame. The clear margin stays click-through. */
export function photoHitRect(slotWidth = PET_WINDOW.width, slotHeight = PET_WINDOW.height): PhotoHitRect {
  const scale = PHOTO_FRAME_PX / PHOTO_SOURCE_PX
  const frameLeft = (slotWidth - PHOTO_FRAME_PX) / 2
  const frameTop = slotHeight - PHOTO_BOTTOM_MARGIN - PHOTO_FRAME_PX
  return {
    x: frameLeft + PHOTO_OPAQUE.x * scale,
    y: frameTop + PHOTO_OPAQUE.y * scale,
    width: PHOTO_OPAQUE.width * scale,
    height: PHOTO_OPAQUE.height * scale
  }
}

export function photoFrameBox(slotWidth = PET_WINDOW.width, slotHeight = PET_WINDOW.height): PhotoHitRect {
  return {
    x: (slotWidth - PHOTO_FRAME_PX) / 2,
    y: slotHeight - PHOTO_BOTTOM_MARGIN - PHOTO_FRAME_PX,
    width: PHOTO_FRAME_PX,
    height: PHOTO_FRAME_PX
  }
}
