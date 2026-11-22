/**
 * MIKO Lens control + file helpers (pure).
 * Viewer coordinates → source-window screen points; never guess file paths from pixels.
 */

import type { GptLiveCrop } from './gpt-mode.ts'
import { normalizeGptLiveCrop } from './gpt-mode.ts'

/** view = mirror; control-original = single handoff to real window; control = legacy alias for control-original */
export type LensMode = 'view' | 'control' | 'control-original' | 'media'

export type LensPointerAction = 'click' | 'dblclick' | 'scroll'

export interface LensWindowBounds {
  /** Global screen points (AppKit / AX space). */
  x: number
  y: number
  width: number
  height: number
  /** CGWindowID when known. */
  windowId: number
  pid: number
  name: string
  owner: string
  bundle: string
}

export interface LensPointerRequest {
  action: LensPointerAction
  /** Absolute screen points after mapping. */
  x: number
  y: number
  /** Scroll deltas (pixels); only for scroll. */
  dx?: number
  dy?: number
  expectSourceId: string
  /**
   * When true, the helper may bring the source app forward once.
   * Scroll and background posts must leave this false — otherwise Lens (always-on-top)
   * and the source ping-pong focus.
   */
  activate?: boolean
  /**
   * control-original: UI interaction after an intentional handoff (Spotify allowed).
   * background: experimental in-mirror posts without activate (Spotify refused).
   */
  intent?: 'background' | 'control-original'
}

export interface LensPointerResult {
  ok: boolean
  reason: string
  /** True when the helper brought the source app forward. */
  activated: boolean
  pid: number
  windowId: number
}

export interface LensTypeRequest {
  text: string
  expectSourceId: string
  /** See LensPointerRequest.activate — default false. */
  activate?: boolean
  intent?: 'background' | 'control-original'
}

export type SpotifyMediaAction = 'play-pause' | 'next' | 'previous' | 'volume-up' | 'volume-down' | 'status'

export interface SpotifyMediaStatus {
  ok: boolean
  reason: string
  running: boolean
  /** playing | paused | stopped | unknown */
  state: string
  track: string
  artist: string
  /** 0–100 when known. */
  volume: number | null
  /** How the action was sent. */
  method: 'spotify-applescript' | 'system-media-key' | 'none'
}

export function isSpotifyOwner(owner: string, name: string, bundle = ''): boolean {
  if (/spotify/i.test(bundle)) return true
  if (/^spotify$/i.test(owner.trim())) return true
  if (/^spotify$/i.test(name.trim())) return true
  return /spotify/i.test(owner) && !/chrome|safari|finder/i.test(owner)
}

export interface LensTypeResult {
  ok: boolean
  reason: string
  activated: boolean
  pid: number
}

export interface LensResolvedFile {
  path: string
  filename: string
  bytes: number
  /** How the path was obtained — never “ocr” or “screenshot”. */
  provenance: 'finder-selection' | 'native-picker' | 'proven-attachment' | 'drop'
}

export interface LensFinderSelectionResult {
  ok: boolean
  reason: string
  files: LensResolvedFile[]
}

export interface LensAttachResult {
  ok: boolean
  status: 'attached' | 'failed' | 'permission' | 'lost-focus' | 'switched' | 'cancelled' | 'unsupported'
  reason: string
  path: string
  filename: string
  verified: boolean
  /** Composer text after attach (when readable). */
  composerText: string
}

export interface LensMapInput {
  /** Pointer position relative to the stage element (client). */
  clientX: number
  clientY: number
  stageLeft: number
  stageTop: number
  scrollLeft: number
  scrollTop: number
  zoom: number
  captureWidth: number
  captureHeight: number
  crop: GptLiveCrop | null
  window: Pick<LensWindowBounds, 'x' | 'y' | 'width' | 'height'>
}

/** Map a stage click through zoom/pan/crop into source-window screen points. */
export function mapLensPointToScreen(input: LensMapInput): { x: number; y: number; captureX: number; captureY: number } | null {
  const zoom = input.zoom > 0 ? input.zoom : 0
  if (!zoom || input.captureWidth <= 0 || input.captureHeight <= 0) return null
  if (input.window.width <= 0 || input.window.height <= 0) return null

  const localX = (input.clientX - input.stageLeft + input.scrollLeft) / zoom
  const localY = (input.clientY - input.stageTop + input.scrollTop) / zoom

  const crop = normalizeGptLiveCrop(input.crop)
  const croppedW = crop ? input.captureWidth * crop.width : input.captureWidth
  const croppedH = crop ? input.captureHeight * crop.height : input.captureHeight
  if (localX < -0.5 || localY < -0.5 || localX > croppedW + 0.5 || localY > croppedH + 0.5) return null

  const captureX = (crop ? crop.x * input.captureWidth : 0) + localX
  const captureY = (crop ? crop.y * input.captureHeight : 0) + localY
  if (captureX < 0 || captureY < 0 || captureX > input.captureWidth || captureY > input.captureHeight) return null

  const fx = captureX / input.captureWidth
  const fy = captureY / input.captureHeight
  return {
    x: input.window.x + fx * input.window.width,
    y: input.window.y + fy * input.window.height,
    captureX,
    captureY
  }
}

/** Parse Electron desktopCapturer id `window:<cgWindowId>:<…>`. */
export function parseCaptureWindowId(sourceId: string): number | null {
  const m = /^window:(\d+)/.exec(sourceId.trim())
  if (!m) return null
  const id = Number(m[1])
  return Number.isFinite(id) && id > 0 ? id : null
}

export function isFinderOwner(owner: string, name: string, bundle = ''): boolean {
  if (/finder/i.test(bundle)) return true
  if (/^finder$/i.test(owner.trim())) return true
  if (/^finder$/i.test(name.trim())) return true
  return false
}

export function isChatGptOwner(owner: string, name: string, bundle = ''): boolean {
  if (/openai\.chat|openai\.codex|chatgpt/i.test(bundle)) return true
  if (/^chatgpt$/i.test(owner.trim())) return true
  if (/chatgpt/i.test(owner) && !/whatsapp|finder|notes/i.test(owner)) return true
  if (/chatgpt/i.test(name) && !/whatsapp|finder|notes/i.test(name)) return true
  return false
}

export function sanitizeLensFilePath(path: string): string | null {
  const p = path.trim()
  if (!p || p.length > 1024 || p.includes('\0') || p.includes('..')) return null
  return p
}
