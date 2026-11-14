export const IPC = {
  moveBy: 'miko:move-by',
  setPanelOpen: 'miko:set-panel-open',
  setHitRects: 'miko:set-hit-rects',
  setDragActive: 'miko:set-drag-active',
  setReducedMotion: 'miko:set-reduced-motion',
  exitFinished: 'miko:exit-finished',
  presence: 'miko:presence',
  placement: 'miko:placement',
  pointer: 'miko:pointer',
  travelBy: 'miko:travel-by',
  setPointerHeld: 'miko:set-pointer-held',
  unpinHome: 'miko:unpin-home',
  listApps: 'miko:list-apps',
  launchApp: 'miko:launch-app',
  openChatGpt: 'miko:open-chatgpt',
  copyText: 'miko:copy-text',
  readClipboard: 'miko:read-clipboard',
  closeApp: 'miko:close-app',
  quitApp: 'miko:quit-app',
  closeUpdate: 'miko:close-update',
  listenStart: 'miko:listen-start',
  listenStop: 'miko:listen-stop',
  listenCancel: 'miko:listen-cancel',
  speech: 'miko:speech',
  setFollow: 'miko:set-follow',
  comeHere: 'miko:come-here',
  follow: 'miko:follow',
  shiftBy: 'miko:shift-by',
  keys: 'miko:keys',
  voiceAuto: 'miko:voice-auto',
  getVoiceAuto: 'miko:get-voice-auto',
  openSwitcher: 'miko:open-switcher',
  switcherList: 'miko:switcher-list',
  switcherFocus: 'miko:switcher-focus',
  switcherQuit: 'miko:switcher-quit',
  switcherTabs: 'miko:switcher-tabs',
  switcherFocusTab: 'miko:switcher-focus-tab',
  switcherClose: 'miko:switcher-close',
  switcherOpened: 'miko:switcher-opened'
} as const

export interface PresenceEvent {
  phase: 'shown' | 'exit' | 'hidden'
  generation: number
}

/** DIP position of the pet inside the current display's roam range. */
export interface PlacementEvent {
  x: number
  span: number
}

/** Global pointer and the window origin, both in desktop DIP. */
export interface PointerSample {
  x: number
  y: number
  windowX: number
  windowY: number
  scaleFactor: number
}

export interface HitRect {
  x: number
  y: number
  width: number
  height: number
}

export interface MoveDelta {
  dx: number
  dy: number
}

export interface PanelLayout {
  panelOpen: boolean
  panelSide: 'left' | 'right'
}

export interface TravelDelta {
  dx: number
  reduced: boolean
}

export interface AppListing {
  id: string
  name: string
  installed: boolean
  familiar: boolean
  aliases: string[]
}

export interface LaunchRequest {
  id: string
  confirm: boolean
}

export interface LaunchResult {
  ok: boolean
  reason: string
}

export interface CloseRequest {
  id: string
  force: boolean
  confirm: boolean
}

export interface CloseResult {
  status: 'requested' | 'already-closed' | 'unsupported' | 'failed' | 'needs-confirm'
  name: string
}

export interface CloseUpdate {
  id: string
  name: string
  status: 'closed' | 'still-open'
}

export interface SpeechEvent {
  phase: 'transcript' | 'denied' | 'silence' | 'unavailable' | 'cancelled' | 'failed'
  text?: string
  /** Listening session number; one result per session. */
  session?: number
}

export interface FollowEvent {
  kind: 'approach' | 'placed'
  x?: number
  y?: number
}

export interface ShiftDelta {
  dx: number
  dy: number
  reduced: boolean
}

export type { KeyEvent } from './keys'
import type { KeyEvent } from './keys'

/** Preload surface. The renderer has no Node integration. */
export interface MikoApi {
  /** Move the window by a DIP delta. The main process clamps the pet to the work area. */
  moveBy: (delta: MoveDelta) => void
  /** Resize around the pet so the note panel stays inside the work area. */
  setPanelOpen: (open: boolean) => Promise<PanelLayout>
  /** Window-local DIP rectangles that should receive clicks. */
  setHitRects: (rects: HitRect[]) => void
  /** Keep the window clickable for the whole Alt/Option drag, including outside the graphic. */
  setDragActive: (active: boolean) => void
  /** Keep the window clickable while a guide drag is held, without moving the window directly. */
  setPointerHeld: (active: boolean) => void
  /** Walk the pet horizontally. Reduced snaps are explicit. The panel does not block this. */
  travelBy: (delta: TravelDelta) => void
  /** The guided or dragged spot is home until the next summon. */
  unpinHome: () => void
  /** Installed applications the command router can name. Paths stay in the main process. */
  listApps: () => Promise<AppListing[]>
  /** Launch a validated action id. Unfamiliar apps launch only after confirm. */
  launchApp: (request: LaunchRequest) => Promise<LaunchResult>
  /** Open https://chatgpt.com in the user's normal browser. */
  openChatGpt: () => Promise<boolean>
  /** Copy reviewed prompt text. This does not run it. */
  copyText: (text: string) => Promise<boolean>
  /** Clipboard text for Paste reply, length capped. */
  readClipboard: () => Promise<string>
  /** Ask a running app to quit. Force is separate and only runs after confirm. */
  closeApp: (request: CloseRequest) => Promise<CloseResult>
  /** Quit MIKO after the panel has confirmed it. */
  quitApp: () => void
  onCloseUpdate: (listener: (event: CloseUpdate) => void) => () => void
  /** Start a bounded on-device listening session. */
  listenStart: () => Promise<LaunchResult>
  listenStop: () => void
  listenCancel: () => void
  onSpeech: (listener: (event: SpeechEvent) => void) => () => void
  /** Opt in to following the foreground window. */
  setFollow: (enabled: boolean) => Promise<LaunchResult>
  /** Walk to the foreground window once. */
  comeHere: () => Promise<LaunchResult & { paused: boolean }>
  onFollow: (listener: (event: FollowEvent) => void) => () => void
  /** Move horizontally and vertically for following. */
  shiftBy: (delta: ShiftDelta) => void
  /** Caps Lock + A hold-to-talk and helper permission events. */
  onKeys: (listener: (event: KeyEvent) => void) => () => void
  /** "Execute voice commands automatically" (tray setting). */
  getVoiceAuto: () => Promise<boolean>
  onVoiceAuto: (listener: (enabled: boolean) => void) => () => void
  /** Show the running-apps switcher above MIKO. */
  openSwitcher: () => void
  /** Reduced motion skips the exit and holds MIKO in place. */
  setReducedMotion: (reduced: boolean) => void
  /** The exit pose finished for this summon generation. */
  exitFinished: (generation: number) => void
  /** Main-to-renderer presence. Returns an unsubscribe. */
  onPresence: (listener: (event: PresenceEvent) => void) => () => void
  /** Where the pet sits in the current display's roam range. Returns an unsubscribe. */
  onPlacement: (listener: (event: PlacementEvent) => void) => () => void
  /** Global pointer while MIKO is visible. Returns an unsubscribe. */
  onPointer: (listener: (sample: PointerSample) => void) => () => void
}
