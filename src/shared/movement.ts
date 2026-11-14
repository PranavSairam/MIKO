import { EDGE_MARGIN, PET_WINDOW, clamp, layoutWindow, placeInitially, type Point, type Rect } from './layout.ts'

export interface MotionGate {
  hidden: boolean
  dragging: boolean
  panelOpen: boolean
  reducedMotion: boolean
}

/**
 * Bottom-center of a display work area, in DIP. Electron's work area already
 * excludes the Dock or taskbar, so this is not multiplied by the display scale.
 */
export function placeAtWorkAreaBottom(work: Rect): Point {
  return layoutWindow(
    {
      x: work.x + (work.width - PET_WINDOW.width) / 2,
      y: work.y + work.height - PET_WINDOW.height - EDGE_MARGIN
    },
    false,
    work,
    'left'
  ).pet
}

/**
 * Bottom-right of the work area, in DIP. The work area already excludes the
 * Dock or taskbar, and these coordinates are not multiplied by display scale.
 */
export function placeAtWorkAreaRight(work: Rect): Point {
  return placeInitially(work).pet
}

/** Left edge of the rightmost quarter, in the same DIP travel coordinates as a stroll. */
export function rightQuarterMin(span: number): number {
  const workWidth = span + PET_WINDOW.width + EDGE_MARGIN * 2
  const min = workWidth * 0.75 - EDGE_MARGIN - PET_WINDOW.width / 2
  return clamp(min, 0, Math.max(0, span))
}

/**
 * Strolls stay in the rightmost quarter while home is there. A drag elsewhere
 * keeps the short walks near that new home until the next summon.
 */
export function roamFor(home: number, span: number): { min: number; max: number } {
  const limit = Math.max(0, span)
  const quarterMin = rightQuarterMin(limit)
  const clampedHome = clamp(home, 0, limit)
  if (clampedHome >= quarterMin - 0.5) return { min: quarterMin, max: limit }
  const workWidth = limit + PET_WINDOW.width + EDGE_MARGIN * 2
  const radius = Math.max(96, workWidth * 0.125)
  return {
    min: clamp(clampedHome - radius, 0, limit),
    max: clamp(clampedHome + radius, 0, limit)
  }
}

/** Autonomous travel waits. Dragging, the note, hiding, and reduced motion all hold still. */
export function movementBlocked(gate: MotionGate): boolean {
  return gate.hidden || gate.dragging || gate.panelOpen || gate.reducedMotion
}
