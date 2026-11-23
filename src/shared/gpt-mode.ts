/**
 * Opt-in GPT Mode: ordinary messages forward to the ChatGPT app.
 * Separate from the MIKO assistant (Codex bridge). Pure helpers + types.
 */

export type GptModePhase = 'off' | 'paused' | 'active'

/** Delivery lifecycle for one forwarded message. Never claim Submitted from a keystroke alone. */
export type GptDeliveryStatus =
  | 'preparing'
  | 'text-inserted'
  | 'submitted'
  | 'delivery-unverified'
  | 'choose-insert'
  | 'failed'
  | 'cancelled'

/** Compact banner — technical text lives in Details / per-request cards. */
export type GptBannerKind = 'connected' | 'paused' | 'needs-attention' | 'off'

export type GptLiveKind =
  | 'ok'
  | 'need-permission'
  | 'source-closed'
  | 'source-unavailable'
  | 'capture-failed'
  | 'off'
  /** @deprecated use source-unavailable */
  | 'need-window'

/** Viewer size presets (logical pixels), clamped to the work area by the host. */
export type GptLiveSizePreset = 'compact' | 'reading' | 'expand'

export const GPT_LIVE_SIZE = {
  compact: { width: 560, height: 420 },
  /** Default MIKO Lens reading size. */
  reading: { width: 960, height: 680 },
  expand: { width: 1200, height: 850 }
} as const

/** Collapsed pill near the pet. */
export const GPT_LIVE_PILL = { width: 220, height: 48 } as const

/** Keep the full Lens window inside the work area by this margin. */
export const GPT_LIVE_WORK_INSET = 24

export const GPT_LIVE_ZOOM_MIN = 0.5
export const GPT_LIVE_ZOOM_MAX = 3
export const GPT_LIVE_ZOOM_STEP = 0.1

export interface GptLiveCrop {
  /** Normalized 0–1 relative to the captured frame. */
  x: number
  y: number
  width: number
  height: number
}

export interface GptLiveSnapshot {
  ok: boolean
  reason: string
  dataUrl: string
  sourceName: string
  sourceId: string
  owner: string
  permission: string
  kind: GptLiveKind
  /** Capture pixel size when known. */
  captureWidth: number
  captureHeight: number
}

export interface GptCaptureSource {
  id: string
  /** Window title from capture (may be a chat name, not “ChatGPT”). */
  name: string
  /** Process / app owner when known (e.g. ChatGPT). */
  owner: string
  pid: number
  /** Small preview data URL when available. */
  previewUrl: string
  /** True when owner is the ChatGPT.app process. */
  recommended: boolean
}

export interface GptModeState {
  optedIn: boolean
  phase: GptModePhase
  /** Shared request status — banner and cards must agree. */
  lastStatus: GptDeliveryStatus | null
  lastDetail: string
  lastRequestId: string | null
  liveView: boolean
  liveViewDetail: string
  liveKind: GptLiveKind
  /** Bound desktopCapturer source id for the hologram. */
  captureSourceId: string | null
  captureSourceName: string
  captureOwner: string
}

export interface GptSendResult {
  requestId: string
  status: GptDeliveryStatus
  detail: string
  /** Always false for ChatGPT desktop — Return alone / composer clear is not proof. */
  submittedVerified: boolean
  inserted: boolean
}

export function emptyGptModeState(): GptModeState {
  return {
    optedIn: false,
    phase: 'off',
    lastStatus: null,
    lastDetail: '',
    lastRequestId: null,
    liveView: false,
    liveViewDetail: '',
    liveKind: 'off',
    captureSourceId: null,
    captureSourceName: '',
    captureOwner: ''
  }
}

export function phaseAfterLoad(optedIn: boolean): GptModePhase {
  return optedIn ? 'paused' : 'off'
}

export function gptBannerKind(state: GptModeState): GptBannerKind {
  if (state.phase === 'off') return 'off'
  if (state.phase === 'paused') return 'paused'
  if (
    state.lastStatus === 'failed' ||
    state.lastStatus === 'delivery-unverified' ||
    state.lastStatus === 'choose-insert' ||
    state.liveKind === 'need-permission' ||
    state.liveKind === 'need-window' ||
    state.liveKind === 'source-closed' ||
    state.liveKind === 'source-unavailable' ||
    state.liveKind === 'capture-failed'
  ) {
    return 'needs-attention'
  }
  return 'connected'
}

export function gptModeBanner(state: GptModeState): string {
  const kind = gptBannerKind(state)
  if (kind === 'connected') return 'GPT Mode · Connected'
  if (kind === 'paused') return 'GPT Mode · Paused'
  if (kind === 'needs-attention') return 'GPT Mode · Needs attention'
  return ''
}

export function deliveryStatusLabel(status: GptDeliveryStatus): string {
  switch (status) {
    case 'preparing':
      return 'Preparing…'
    case 'text-inserted':
      return 'Text inserted'
    case 'submitted':
      return 'Submitted'
    case 'delivery-unverified':
      return 'Delivery unverified'
    case 'choose-insert':
      return 'Composer already has text'
    case 'failed':
      return 'Failed'
    case 'cancelled':
      return 'Cancelled'
  }
}

/** Terminal statuses — card must leave Preparing. */
export function isTerminalGptStatus(status: GptDeliveryStatus): boolean {
  return (
    status === 'submitted' ||
    status === 'delivery-unverified' ||
    status === 'choose-insert' ||
    status === 'failed' ||
    status === 'cancelled'
  )
}

export function isGptModeLocalControl(raw: string): boolean {
  return parseGptModeLocalAction(raw) !== null
}

export type GptLocalAction =
  | 'exit'
  | 'pause'
  | 'resume'
  | 'enable'
  | 'new-chat'
  | 'cancel'
  | null

export function parseGptModeLocalAction(raw: string): GptLocalAction {
  const t = raw
    .trim()
    .replace(/[.!,]+$/g, '')
    .replace(/^(?:ok(?:ay)?|please)\s+/i, '')
    .trim()
  if (!t) return null
  if (
    /^(?:exit|leave|quit|turn\s+off|switch\s+off|disable|deactivate|close|stop)\s+(?:gpt\s+mode|chatgpt\s+mode|gpt)$/i.test(t) ||
    /^gpt\s+mode\s+off$/i.test(t)
  ) {
    return 'exit'
  }
  if (
    /^(?:enable|start|enter|turn\s+on|switch\s+on|open|activate|go\s+(?:in)?to)\s+(?:gpt\s+mode|chatgpt\s+mode)$/i.test(t) ||
    /^gpt\s+mode\s+on$/i.test(t)
  ) {
    return 'enable'
  }
  if (/^(?:pause|hold)\s+(?:gpt\s+mode|chatgpt\s+mode|gpt)?$/i.test(t) || /^pause$/i.test(t)) return 'pause'
  if (/^(?:resume|continue|unpause)\s+(?:gpt\s+mode|chatgpt\s+mode|gpt)?$/i.test(t)) return 'resume'
  if (/^(?:new\s+(?:chat|conversation|thread)|start\s+(?:a\s+)?new\s+(?:chat|conversation))$/i.test(t)) {
    return 'new-chat'
  }
  if (
    /^(?:cancel(?:\s+that)?|never\s*mind|stop(?:\s+that)?|stop\s+listening|abort|forget\s+it|leave\s+it|scratch\s+that)$/i.test(
      t
    )
  ) {
    return 'cancel'
  }
  return null
}

export function newGptRequestId(): string {
  return `gpt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

/** Owners / titles that must never be auto-bound for the hologram. */
export function isExcludedCaptureOwner(owner: string, name: string): boolean {
  const o = owner.trim()
  const n = name.trim()
  // Exact app identity only — chat titles may mention “MIKO” / “Cursor”.
  if (/^miko$/i.test(o) || /^miko$/i.test(n)) return true
  if (/^cursor$/i.test(o) || /^cursor$/i.test(n)) return true
  if (/electron/i.test(o) && !/chatgpt/i.test(o)) return true
  // Helper / CLI Codex windows — not the ChatGPT.app chat UI.
  if (/codex \(aperitif|codex-cli|codex-code-mode|sparkle/i.test(o + ' ' + n)) return true
  if (/^entire (screen|display)/i.test(n) || /^screen \d+/i.test(n)) return true
  return false
}

/** Apps that must never be shown as “ChatGPT” in the live viewer. */
export function isForeignLiveSource(owner: string, name: string): boolean {
  if (isExcludedCaptureOwner(owner, name)) return true
  const blob = `${owner} ${name}`.toLowerCase()
  return /whatsapp|notes|finder|spotify|music|system settings|screen & system|safari|chrome|brave|slack|discord|messages|mail|calendar/.test(
    blob
  )
}

export function isChatGptAppOwner(owner: string): boolean {
  return /^chatgpt$/i.test(owner.trim())
}

export function clampGptLiveZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return 1
  return Math.min(GPT_LIVE_ZOOM_MAX, Math.max(GPT_LIVE_ZOOM_MIN, Math.round(zoom * 100) / 100))
}

/** Scale that fits content into a viewport while preserving aspect ratio. */
export function fitGptLiveScale(
  contentW: number,
  contentH: number,
  viewW: number,
  viewH: number
): number {
  if (contentW <= 0 || contentH <= 0 || viewW <= 0 || viewH <= 0) return 1
  return clampGptLiveZoom(Math.min(viewW / contentW, viewH / contentH))
}

export function normalizeGptLiveCrop(crop: GptLiveCrop | null | undefined): GptLiveCrop | null {
  if (!crop) return null
  const x = Math.min(0.98, Math.max(0, crop.x))
  const y = Math.min(0.98, Math.max(0, crop.y))
  const width = Math.min(1 - x, Math.max(0.05, crop.width))
  const height = Math.min(1 - y, Math.max(0.05, crop.height))
  if (width < 0.05 || height < 0.05) return null
  return { x, y, width, height }
}

export function gptLiveKindLabel(kind: GptLiveKind): string {
  switch (kind) {
    case 'ok':
      return 'Live'
    case 'need-permission':
      return 'Permission needed'
    case 'source-closed':
      return 'Source closed'
    case 'source-unavailable':
    case 'need-window':
      return 'Source unavailable'
    case 'capture-failed':
      return 'Capture failed'
    case 'off':
      return 'Off'
  }
}
