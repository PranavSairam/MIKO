/**
 * “Project video”: a live mirror of one window the owner picked, shown above MIKO.
 * Pure helpers (placement, crop, frame checks, phrases) shared by main, the projector page and tests.
 *
 * It is a mirror, not a player: playback happens in the original window. No audio is captured,
 * so sound plays once (from the original). Protected (DRM) video usually captures as black;
 * MIKO says so and offers Open original. It never bypasses protection.
 */

import { clamp, type Rect } from './layout.ts'

export interface ProjectorSource {
  id: string
  name: string
  previewUrl: string
  /** Looks like a browser window (Chrome, Safari, Edge, Firefox, Arc, Brave…). */
  browser: boolean
}

export type ProjectorStatus =
  | 'choosing'
  | 'starting'
  | 'live'
  | 'frozen'
  | 'black'
  | 'ended'
  | 'denied'
  | 'error'

/** Controls bar above the video (outside it) and the frame padding around the video. */
export const PROJECTOR_BAR = 44
export const PROJECTOR_PAD = 8
export const PROJECTOR_SIZES = {
  small: 360,
  medium: 520,
  large: 760
} as const
export type ProjectorSize = keyof typeof PROJECTOR_SIZES
export const PROJECTOR_PILL = { width: 260, height: 48 }

const BROWSER_HINT = /chrome|safari|edge|firefox|arc|brave|opera|vivaldi|youtube|vimeo|twitch|netflix|prime video|disney|hulu/i

export function isBrowserLike(name: string): boolean {
  return BROWSER_HINT.test(name)
}

/** Sites that normally use DRM: MIKO warns up front that they may capture as black. */
export function likelyProtected(name: string): boolean {
  return /netflix|prime video|disney\+?|hulu|max\b|hbo|apple tv|paramount|peacock|hotstar|jiocinema|sonyliv|zee5|spotify/i.test(name)
}

/** Window size for a video width and aspect ratio (bar + padding outside the video). */
export function projectorBounds(videoWidth: number, aspect: number, chrome = PROJECTOR_BAR): { width: number; height: number } {
  const ar = Number.isFinite(aspect) && aspect > 0.2 && aspect < 5 ? aspect : 16 / 9
  const extra = Number.isFinite(chrome) ? Math.max(PROJECTOR_BAR, Math.min(200, chrome)) : PROJECTOR_BAR
  const width = Math.round(videoWidth + PROJECTOR_PAD * 2)
  const height = Math.round(videoWidth / ar + extra + PROJECTOR_PAD * 2)
  return { width, height }
}

/**
 * Place the projector above MIKO, inside the work area, never covering MIKO's window.
 * Falls back to the side with more room when there isn't space above.
 */
export function placeProjector(size: { width: number; height: number }, pet: Rect, work: Rect, gap = 10): Rect {
  const width = Math.min(size.width, work.width)
  const height = Math.min(size.height, work.height)
  const centerX = pet.x + pet.width / 2
  let x = clamp(Math.round(centerX - width / 2), work.x, work.x + work.width - width)
  let y = Math.round(pet.y - height - gap)
  if (y >= work.y) return { x, y, width, height }
  // Not enough room above: beside the pet, on the wider side.
  const roomLeft = pet.x - work.x
  const roomRight = work.x + work.width - (pet.x + pet.width)
  y = clamp(Math.round(pet.y + pet.height - height), work.y, work.y + work.height - height)
  x = roomLeft >= roomRight ? Math.max(work.x, Math.round(pet.x - width - gap)) : Math.min(work.x + work.width - width, Math.round(pet.x + pet.width + gap))
  return { x, y, width, height }
}

export function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
}

/** Normalised crop (0..1 of the source frame). */
export interface Crop {
  x: number
  y: number
  width: number
  height: number
}

export const FULL_FRAME: Crop = { x: 0, y: 0, width: 1, height: 1 }

export function normaliseCrop(a: { x: number; y: number }, b: { x: number; y: number }): Crop | null {
  const x = clamp(Math.min(a.x, b.x), 0, 1)
  const y = clamp(Math.min(a.y, b.y), 0, 1)
  const width = clamp(Math.abs(a.x - b.x), 0, 1 - x)
  const height = clamp(Math.abs(a.y - b.y), 0, 1 - y)
  // Too small to be a deliberate region.
  if (width < 0.05 || height < 0.05) return null
  return { x, y, width, height }
}

/** Aspect ratio of the cropped region of a frame. */
export function cropAspect(frameW: number, frameH: number, crop: Crop): number {
  if (frameW <= 0 || frameH <= 0) return 16 / 9
  return (frameW * crop.width) / (frameH * crop.height)
}

/**
 * CSS for showing only the crop of a frame inside a box (the video element is scaled and
 * shifted inside an overflow-hidden box). Keeps the region's aspect ratio (letterboxed).
 */
export function cropStyle(box: { width: number; height: number }, frameW: number, frameH: number, crop: Crop): {
  width: number
  height: number
  left: number
  top: number
} {
  const regionAspect = cropAspect(frameW, frameH, crop)
  // Fit the region inside the box.
  let rw = box.width
  let rh = box.width / regionAspect
  if (rh > box.height) {
    rh = box.height
    rw = box.height * regionAspect
  }
  const scale = rw / (frameW * crop.width)
  const width = frameW * scale
  const height = frameH * scale
  const offsetX = (box.width - rw) / 2
  const offsetY = (box.height - rh) / 2
  return {
    width,
    height,
    left: offsetX - crop.x * width,
    top: offsetY - crop.y * height
  }
}

/**
 * Frame health from periodic samples. Black for a few seconds while frames keep arriving
 * usually means protected video (DRM) or a GPU surface the OS won't share.
 * No new frames for a while means the source is paused, minimised, or hidden.
 */
export interface FrameSample {
  at: number
  /** Average luminance 0..255 of a tiny downscale. */
  luma: number
  /** Time of the last decoded frame (requestVideoFrameCallback). */
  lastFrameAt: number
}

export const BLACK_LUMA = 6
export const BLACK_MS = 3000
export const FROZEN_MS = 2500

export function frameHealth(samples: FrameSample[], now: number): 'live' | 'black' | 'frozen' {
  const last = samples[samples.length - 1]
  if (!last) return 'live'
  if (now - last.lastFrameAt > FROZEN_MS) return 'frozen'
  const recent = samples.filter((s) => now - s.at <= BLACK_MS + 500)
  const spanned = recent.length >= 3 && now - recent[0]!.at >= BLACK_MS
  if (spanned && recent.every((s) => s.luma <= BLACK_LUMA)) return 'black'
  return 'live'
}

/** “Project video” phrases (typed or spoken). */
export function matchProjectVideo(spoken: string): boolean {
  const text = spoken.toLowerCase().replace(/[.!?]+$/g, '').replace(/^(?:hey\s+)?miko[,\s]+/, '').trim()
  return /^(?:open\s+|start\s+|show\s+)?(?:the\s+)?(?:video\s+projector|projector)$|^project\s+(?:a\s+|the\s+|my\s+)?(?:video|window|screen)(?:\s+above\s+(?:miko|you))?$|^show\s+(?:a\s+|the\s+)?video\s+above\s+(?:miko|you)$/.test(text)
}
