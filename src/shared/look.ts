import { PANEL, petViewportOffset, type PanelSize } from './layout.ts'

/** About 30 pointer samples per second. */
export const POINTER_INTERVAL_MS = 33

/**
 * Total look, split across the neck and the head so the neck stays connected.
 * The snout sits well forward of the head bone, so the same angle moves the
 * muzzle a long way on screen. 26° / 8° still follows the pointer, without
 * the 35° / 15° glance that parked the muzzle on top of the skull.
 */
export const LOOK_YAW_LIMIT = (26 * Math.PI) / 180
export const LOOK_PITCH_LIMIT = (8 * Math.PI) / 180

/** Pointers this close to the head hold still. */
export const LOOK_DEAD_ZONE = 36

/** A far reference distance, so a nearby pointer does not swing the full limit. */
export const LOOK_DISTANCE = 480

export const LOOK_DAMP = 7

export type PointerWatch = 'start' | 'keep' | 'stop'

/** One scheduler: a second show while already polling must not start another timer. */
export function pointerWatch(running: boolean, visible: boolean): PointerWatch {
  if (!visible) return 'stop'
  return running ? 'keep' : 'start'
}

export interface PointerSample {
  /** Global desktop pointer, DIP. */
  x: number
  y: number
  /** Window content origin, DIP. */
  windowX: number
  windowY: number
  /** Display scale. Cursor and window are already DIP, so this is not a multiplier. */
  scaleFactor: number
}

/**
 * Global DIP to the pet canvas. `scaleFactor` is accepted so a 150% or 200%
 * display does not get applied twice: Electron's pointer and window origin
 * are already device-independent pixels, matching the canvas CSS pixel.
 */
export function pointerToViewport(sample: PointerSample, canvasX: number, canvasY: number): { x: number; y: number } {
  void sample.scaleFactor
  return {
    x: sample.x - sample.windowX - canvasX,
    y: sample.y - sample.windowY - canvasY
  }
}

export function canvasOrigin(
  panelOpen: boolean,
  panelSide: 'left' | 'right',
  panel: PanelSize = PANEL
): { x: number; y: number } {
  return petViewportOffset(panelOpen, panelSide, panel)
}

export function lookTarget(
  headX: number,
  headY: number,
  pointerX: number,
  pointerY: number
): { yaw: number; pitch: number } {
  const dx = pointerX - headX
  const dy = pointerY - headY
  if (Math.hypot(dx, dy) < LOOK_DEAD_ZONE) return { yaw: 0, pitch: 0 }
  return {
    yaw: clamp(Math.atan2(dx, LOOK_DISTANCE), -LOOK_YAW_LIMIT, LOOK_YAW_LIMIT),
    pitch: clamp(Math.atan2(-dy, LOOK_DISTANCE), -LOOK_PITCH_LIMIT, LOOK_PITCH_LIMIT)
  }
}

export function dampLook(current: number, target: number, dt: number, damp = LOOK_DAMP): number {
  if (dt <= 0) return current
  const gain = 1 - Math.exp(-damp * dt)
  return current + (target - current) * gain
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
