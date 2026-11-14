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
  chatsList: 'miko:chats-list',
  chatgptInsert: 'miko:chatgpt-insert',
  bridgeSend: 'miko:bridge-send',
  bridgeCancel: 'miko:bridge-cancel',
  bridgeUpdate: 'miko:bridge-update',
  bridgeStatus: 'miko:bridge-status',
  bridgeNew: 'miko:bridge-new',
  prefsGet: 'miko:prefs-get',
  prefsSet: 'miko:prefs-set',
  mailStatus: 'miko:mail-status',
  mailConnect: 'miko:mail-connect',
  mailDisconnect: 'miko:mail-disconnect',
  mailList: 'miko:mail-list',
  mailRead: 'miko:mail-read',
  mailOpenOriginal: 'miko:mail-open-original',
  mailRules: 'miko:mail-rules',
  mailSetup: 'miko:mail-setup',
  mailSetRules: 'miko:mail-set-rules',
  chatsAdd: 'miko:chats-add',
  chatsRename: 'miko:chats-rename',
  chatsRemove: 'miko:chats-remove',
  chatsOpen: 'miko:chats-open',
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

export type InsertResult =
  | { state: 'inserted'; mode: string }
  | { state: 'has-text'; length: number }
  | { state: 'unavailable'; reason: string }
  | { state: 'failed'; reason: string }

export interface OpenResult {
  ok: boolean
  target: 'app' | 'browser' | 'none'
  appName: string
}

export interface ChatEditResult {
  ok: boolean
  reason: string
  list: SavedChat[]
}

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

export type PanelMode = 'chat' | 'mail'

export interface PanelLayout {
  panelOpen: boolean
  panelSide: 'left' | 'right'
  mode: PanelMode
  /** Current panel size in DIP (Mail is fitted to the work area). */
  panelWidth: number
  panelHeight: number
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
export type { SavedChat } from './chatgpt'
import type { ImportanceRules, MailAccount, MailFilter, MailMessage, MailSummary, Importance } from './mail'
export type { ImportanceRules, MailAccount, MailFilter, MailMessage, MailSummary, Importance }

export interface BridgeStatusInfo {
  enabled: boolean
  available: boolean
  signedIn: boolean
  thread: string
  busy: boolean
}

export interface BridgeUpdate {
  requestId: string
  phase: 'running' | 'done' | 'failed' | 'cancelled' | 'timeout'
  reply?: string
  thread?: string
  reason?: string
  seconds?: number
}

export interface MailStatusInfo {
  accounts: MailAccount[]
  configured: boolean
  preview: boolean
  secureStorage: boolean
  setupPath: string
}

export type ListedMail = MailSummary & { importance: Importance }

export interface MailListResult {
  listId: string
  items: ListedMail[]
  done: boolean
  errors: { account: string; kind: 'reconnect' | 'error'; message: string }[]
}

export interface MailListRequest {
  listId: string
  more: boolean
  filter: MailFilter
  query: string
  account: string
  unreadOnly: boolean
}

export type MailReadResult = { ok: true; message: MailMessage } | { ok: false; reason: string; reconnect?: string }
import type { SavedChat } from './chatgpt'
import type { KeyEvent } from './keys'

/** Preload surface. The renderer has no Node integration. */
export interface MikoApi {
  /** Move the window by a DIP delta. The main process clamps the pet to the work area. */
  moveBy: (delta: MoveDelta) => void
  /** Resize around the pet so the note panel stays inside the work area. */
  setPanelOpen: (open: boolean, mode?: PanelMode) => Promise<PanelLayout>
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
  /** Launch or focus the ChatGPT app; falls back to chatgpt.com in the default browser. */
  openChatGpt: () => Promise<OpenResult>
  /** Put a prompt into ChatGPT's message box only when Accessibility can identify it (see PROJECT_LOG). */
  chatgptInsert: (prompt: string, mode?: 'append' | 'replace') => Promise<InsertResult>
  /** Saved ChatGPT shortcuts, stored in MIKO's local settings. */
  listChats: () => Promise<SavedChat[]>
  addChat: (name: string, url: string) => Promise<ChatEditResult>
  renameChat: (from: string, to: string) => Promise<ChatEditResult>
  removeChat: (name: string) => Promise<ChatEditResult>
  /** Open a saved chat through the system URL handler. */
  openChat: (name: string) => Promise<OpenResult>
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
  /** ChatGPT bridge proof of concept (opt-in; Codex CLI, headless). */
  bridgeStatus: () => Promise<BridgeStatusInfo | null>
  bridgeSend: (requestId: string, prompt: string) => Promise<{ ok: boolean; reason: string }>
  bridgeCancel: (requestId: string) => void
  /** Start a new assistant conversation (the next question opens a fresh thread). */
  bridgeNew: () => Promise<void>
  /** MIKO preferences (stored on this Mac, added to new assistant conversations). */
  prefsGet: () => Promise<string>
  prefsSet: (text: string) => Promise<boolean>
  onBridge: (listener: (update: BridgeUpdate) => void) => () => void
  /** Gmail (read-only). Tokens never reach the renderer. */
  mailStatus: () => Promise<MailStatusInfo | null>
  mailConnect: (loginHint?: string) => Promise<{ ok: boolean; reason: string; email?: string }>
  mailDisconnect: (email: string) => Promise<boolean>
  mailList: (request: MailListRequest) => Promise<MailListResult | null>
  mailRead: (key: string) => Promise<MailReadResult>
  mailOpenOriginal: (key: string) => Promise<boolean>
  /** Save the owner's Google OAuth Desktop client (encrypted in the main process). */
  mailSetup: (clientId: string, clientSecret: string) => Promise<{ ok: boolean; reason: string }>
  mailRules: () => Promise<ImportanceRules | null>
  mailSetRules: (rules: ImportanceRules) => Promise<ImportanceRules | null>
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
