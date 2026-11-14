/** One stride from the locked side-view clip, at the clip's own 24 fps timing. */
export const WALK_FRAME_COUNT = 66
export const WALK_FPS = 24
export const WALK_CYCLE_SECONDS = WALK_FRAME_COUNT / WALK_FPS
export const WALK_SLOW_RATE = 0.25
export const WALK_BOX_WIDTH = 168
export const WALK_BOX_HEIGHT = 200

/** Exported aligned frame. The ground line is this many pixels from the top. */
export const WALK_FRAME_WIDTH = 504
export const WALK_FRAME_HEIGHT = 332
export const WALK_GROUND_Y = 300

/**
 * Forward travel of the torso from the front-paw landing at source frame 119
 * to the next landing of that paw at frame 185, in the original 1280px frame.
 */
export const WALK_TORSO_TRAVEL_SOURCE = 128.5

/** Width of the aligned crop before it was scaled into the exported frame. */
export const WALK_SOURCE_CROP_WIDTH = 956

/** Front paw toe on the locked camera, before the background was removed. */
export const WALK_TOE = { atFrame119: 889, atFrame143: 793 } as const

export function walkDisplayHeight(): number {
  return WALK_BOX_WIDTH * (WALK_FRAME_HEIGHT / WALK_FRAME_WIDTH)
}

/** Exported pixels the torso advances over one stride. */
export function travelExportPx(): number {
  return WALK_TORSO_TRAVEL_SOURCE * (WALK_FRAME_WIDTH / WALK_SOURCE_CROP_WIDTH)
}

/** CSS pixels the 168px-wide preview travels over one stride. */
export function travelPxPerCycle(): number {
  return travelExportPx() * (WALK_BOX_WIDTH / WALK_FRAME_WIDTH)
}

export function walkFrameIndex(elapsedSeconds: number): number {
  const cycle = WALK_CYCLE_SECONDS
  const wrapped = ((elapsedSeconds % cycle) + cycle) % cycle
  const index = Math.floor((wrapped / cycle) * WALK_FRAME_COUNT + 1e-9)
  return index >= WALK_FRAME_COUNT ? 0 : index
}

export function walkTravelX(elapsedSeconds: number): number {
  return (elapsedSeconds / WALK_CYCLE_SECONDS) * travelPxPerCycle()
}

/** Distance from the top of the 168×200 box to the aligned frame. */
export function walkImageTop(): number {
  const groundInImage = (WALK_GROUND_Y / WALK_FRAME_HEIGHT) * walkDisplayHeight()
  return WALK_BOX_HEIGHT - 16 - groundInImage
}

/** Paw baseline measured from the top of the 168×200 box. */
export function walkPawLine(): number {
  return walkImageTop() + (WALK_GROUND_Y / WALK_FRAME_HEIGHT) * walkDisplayHeight()
}

export function stepWalkFrame(frame: number, direction: -1 | 1): number {
  return (frame + direction + WALK_FRAME_COUNT) % WALK_FRAME_COUNT
}
