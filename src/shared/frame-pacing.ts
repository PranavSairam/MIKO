/**
 * How often the pet canvas redraws. requestAnimationFrame runs at the display rate
 * (120 Hz on ProMotion Macs and many Windows laptops), which made an idle pet redraw a
 * transparent always-on-top window 120 times a second. Movement is smooth at 60 fps;
 * idle breathing and blinking look the same at 30 fps.
 */
export interface FrameActivity {
  walking?: boolean
  dragging?: boolean
  flying?: boolean
  playing?: boolean
  exiting?: boolean
  pointerMoving?: boolean
}

export function frameBudgetMs(a: FrameActivity): number {
  return a.walking || a.dragging || a.flying || a.playing || a.exiting || a.pointerMoving ? 1000 / 60 : 1000 / 30
}

/** Draw when at least the budget has passed (with a little slack for display-timer jitter). */
export function shouldDrawFrame(now: number, lastDrawn: number, budgetMs: number): boolean {
  return now - lastDrawn >= budgetMs - 2.5
}
