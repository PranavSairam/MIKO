import { CYCLE } from './gait.ts'

/**
 * Scene root and clip contract.
 *
 * The scene root applies each of these once. Clips are in-place: no root
 * translation, no root yaw, and no root Y keys.
 *
 * - Walk translation: the root moves one stride along its facing per cycle.
 * - Turn yaw: the root yaws 180° about Y. The clip only steps in place.
 * - Climb slide: the root moves backward along its facing by SLIDE_BACK.
 * - Peek and Duck: the root moves vertically. Peek rises from PEEK_Y to 0
 *   across Peek and StepOn. Duck drops from 0 to DUCK_Y. The clips hold
 *   the crouch and head pose only.
 */
export const SLIDE_BACK = 0.16
export const PEEK_Y = -0.34
export const STEP_Y = -0.22
export const DUCK_Y = -0.42

/** CSS pixels per metre. The desktop window uses the same scale as the rig. */
export const PIXELS_PER_METRE = 240

/** Step-turn length. Linear yaw, so each planted paw covers the same angle. */
export const TURN_CYCLES = 4

export const TURN_SECONDS = TURN_CYCLES * CYCLE

export function smoothstep(value: number): number {
  const clamped = Math.min(1, Math.max(0, value))
  return clamped * clamped * (3 - 2 * clamped)
}
