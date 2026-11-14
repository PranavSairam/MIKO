import { EDGE_MARGIN, PET_WINDOW, clamp, type Point, type Rect } from './layout.ts'

export const FOLLOW_SETTLE_MS = 600

export interface SettleState {
  key: string
  since: number
}

/** A stable foreground key is ready only after it has stopped changing. */
export function settleKey(
  previous: SettleState | null,
  key: string,
  at: number,
  settleMs: number
): { state: SettleState; ready: boolean } {
  if (!previous || previous.key !== key) return { state: { key, since: at }, ready: false }
  return { state: previous, ready: at - previous.since >= settleMs }
}

/**
 * The closest point on the active window's bottom edge, then clamped so the
 * pet window stays inside the display work area.
 */
export function perchPoint(pet: Point, appWindow: Rect, work: Rect): Point {
  const center = pet.x + PET_WINDOW.width / 2
  const edgeRight = appWindow.x + Math.max(0, appWindow.width)
  const desiredCenter = clamp(center, appWindow.x, edgeRight)
  const x = desiredCenter - PET_WINDOW.width / 2
  const y = appWindow.y + appWindow.height - PET_WINDOW.height
  return {
    x: clamp(x, work.x + EDGE_MARGIN, work.x + work.width - PET_WINDOW.width - EDGE_MARGIN),
    y: clamp(y, work.y + EDGE_MARGIN, work.y + work.height - PET_WINDOW.height - EDGE_MARGIN)
  }
}
