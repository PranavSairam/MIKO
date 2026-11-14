import { PET_WINDOW, clamp } from './layout.ts'

/** Pointer travel before a press becomes a guide drag instead of a click. */
export const DRAG_THRESHOLD_PX = 8

/**
 * Ignore destination jitter inside this band, and do not reverse until the
 * pointer is clearly on the other side of MIKO.
 */
export const GUIDE_DEAD_ZONE = 36

/** Close enough to a destination to stop, turn, and sit. */
export const ARRIVE_EPS = 4

export const MOVE_DIP = 150
export const LITTLE_DIP = 60

/**
 * Roam X of the pet's left edge when the pointer should sit on the pet's center.
 * `petScreenX` and `petRoamX` are the current left edge in screen DIP and roam DIP.
 * Screen DIP are not multiplied by the display scale.
 */
export function guideDestination(
  pointerX: number,
  petScreenX: number,
  petRoamX: number,
  span: number,
  petWidth = PET_WINDOW.width
): number {
  const roamOrigin = petScreenX - petRoamX
  const left = pointerX - roamOrigin - petWidth / 2
  return clamp(left, 0, Math.max(0, span))
}

/**
 * Keep the current target when the pointer only jitters, or when a reversal
 * has not cleared the dog. `null` means the press is still too close to start.
 */
export function nextGuideTarget(current: number | null, proposed: number, petX: number): number | null {
  if (current === null) {
    if (Math.abs(proposed - petX) < GUIDE_DEAD_ZONE) return null
    return proposed
  }
  if (Math.abs(proposed - current) < GUIDE_DEAD_ZONE) return current
  const proposedSide = Math.sign(proposed - petX)
  const currentSide = Math.sign(current - petX)
  if (
    proposedSide !== 0 &&
    currentSide !== 0 &&
    proposedSide !== currentSide &&
    Math.abs(proposed - petX) < GUIDE_DEAD_ZONE
  ) {
    return current
  }
  return proposed
}

/** Latest guide target, holding still inside the dead zone and across a shallow reversal. */
export function acceptDestination(current: number, proposed: number, petX: number): number {
  return nextGuideTarget(current, proposed, petX) ?? current
}

/** A typed step, clamped so the pet stops at the work-area edge. */
export function clampTravel(
  x: number,
  span: number,
  delta: number
): { destination: number; clamped: boolean } {
  const limit = Math.max(0, span)
  const raw = x + delta
  const destination = clamp(raw, 0, limit)
  return { destination, clamped: Math.abs(destination - raw) > 0.01 }
}
