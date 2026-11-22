export const IPC = {
  moveBy: 'miko:move-by',
  setPanelOpen: 'miko:set-panel-open',
  panelResize: 'miko:panel-resize',
  panelPreset: 'miko:panel-preset',
  petList: 'miko:pet-list',
  petModel: 'miko:pet-model',
  petSave: 'miko:pet-save',
  petActive: 'miko:pet-active',
  petFlight: 'miko:pet-flight',
  petCommand: 'miko:pet-command',
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
  appsStatus: 'miko:apps-status',
  launchApp: 'miko:launch-app',
  openChatGpt: 'miko:open-chatgpt',
  chatsList: 'miko:chats-list',
  selection: 'miko:selection',
  selectionClipboard: 'miko:selection-clipboard',
  selectionReplace: 'miko:selection-replace',
  pasteArm: 'miko:paste-arm',
  pasteCancel: 'miko:paste-cancel',
  pasteState: 'miko:paste-state',
  selectionShortcutGet: 'miko:selection-shortcut-get',
  selectionShortcutSet: 'miko:selection-shortcut-set',
  chatgptInsert: 'miko:chatgpt-insert',
  typeDestCapture: 'miko:type-dest-capture',
  typeDestCaptureHere: 'miko:type-dest-capture-here',
  typeDestOpenChatGpt: 'miko:type-dest-open-chatgpt',
  typeDestNewChat: 'miko:type-dest-new-chat',
  typeDestInsert: 'miko:type-dest-insert',
  typeDestOmnibox: 'miko:type-dest-omnibox',
  typeDestOpenNotes: 'miko:type-dest-open-notes',
  typeDestCancel: 'miko:type-dest-cancel',
  gptModeGet: 'miko:gpt-mode-get',
  gptModeEnable: 'miko:gpt-mode-enable',
  gptModePause: 'miko:gpt-mode-pause',
  gptModeResume: 'miko:gpt-mode-resume',
  gptModeExit: 'miko:gpt-mode-exit',
  gptModeNewChat: 'miko:gpt-mode-new-chat',
  gptModeSend: 'miko:gpt-mode-send',
  gptModeCancel: 'miko:gpt-mode-cancel',
  gptModeFocus: 'miko:gpt-mode-focus',
  gptModeLiveView: 'miko:gpt-mode-live-view',
  gptModeLiveSnapshot: 'miko:gpt-mode-live-snapshot',
  gptModeListSources: 'miko:gpt-mode-list-sources',
  gptModeSetSource: 'miko:gpt-mode-set-source',
  gptModeLiveSizePreset: 'miko:gpt-mode-live-size-preset',
  gptModeLiveCollapse: 'miko:gpt-mode-live-collapse',
  gptModeOpenPicker: 'miko:gpt-mode-open-picker',
  gptModeState: 'miko:gpt-mode-state',
  lensWindowBounds: 'miko:lens-window-bounds',
  lensPointer: 'miko:lens-pointer',
  lensType: 'miko:lens-type',
  lensFinderSelection: 'miko:lens-finder-selection',
  lensPickFiles: 'miko:lens-pick-files',
  lensProvenFiles: 'miko:lens-proven-files',
  lensCopyFile: 'miko:lens-copy-file',
  lensRevealFile: 'miko:lens-reveal-file',
  lensStartDrag: 'miko:lens-start-drag',
  lensAttachChatGpt: 'miko:lens-attach-chatgpt',
  lensRegisterFile: 'miko:lens-register-file',
  lensCancelInput: 'miko:lens-cancel-input',
  lensOpenOriginal: 'miko:lens-open-original',
  spotifyMedia: 'miko:spotify-media',
  /** Optional ChatGPT Web workspace (real chatgpt.com in an isolated WebContentsView). */
  chatgptWebOpen: 'miko:chatgpt-web-open',
  chatgptWebClose: 'miko:chatgpt-web-close',
  chatgptWebCollapse: 'miko:chatgpt-web-collapse',
  chatgptWebExpand: 'miko:chatgpt-web-expand',
  chatgptWebStatus: 'miko:chatgpt-web-status',
  chatgptWebBack: 'miko:chatgpt-web-back',
  chatgptWebForward: 'miko:chatgpt-web-forward',
  chatgptWebReload: 'miko:chatgpt-web-reload',
  chatgptWebRetry: 'miko:chatgpt-web-retry',
  chatgptWebOpenBrowser: 'miko:chatgpt-web-open-browser',
  chatgptWebOpenBlocked: 'miko:chatgpt-web-open-blocked',
  chatgptWebDismissBlocked: 'miko:chatgpt-web-dismiss-blocked',
  chatgptWebChromeHeight: 'miko:chatgpt-web-chrome-height',
  chatgptWebInsertTranscript: 'miko:chatgpt-web-insert-transcript',
  chatgptWebPasteClipboard: 'miko:chatgpt-web-paste-clipboard',
  chatgptWebSubmitDraft: 'miko:chatgpt-web-submit-draft',
  chatgptWebCancelSubmit: 'miko:chatgpt-web-cancel-submit',
  chatgptWebDownload: 'miko:chatgpt-web-download',
  chatgptWebDownloadEvent: 'miko:chatgpt-web-download-event',
  chatgptWebPin: 'miko:chatgpt-web-pin',
  chatgptWebStateEvent: 'miko:chatgpt-web-state',
  chatgptWebDragActive: 'miko:chatgpt-web-drag-active',
  chatgptWebExpandFromDrag: 'miko:chatgpt-web-expand-from-drag',
  chatgptWebDictateArm: 'miko:chatgpt-web-dictate-arm',
  /** Main → pet UI hints (tuck panel when Interactive GPT opens, etc.). */
  uiHint: 'miko:ui-hint',
  bridgeSend: 'miko:bridge-send',
  bridgeCancel: 'miko:bridge-cancel',
  bridgeUpdate: 'miko:bridge-update',
  bridgeStatus: 'miko:bridge-status',
  bridgeSetEnabled: 'miko:bridge-set-enabled',
  bridgeNew: 'miko:bridge-new',
  setupGet: 'miko:setup-get',
  setupUpdate: 'miko:setup-update',
  voicePermissionGet: 'miko:voice-permission-get',
  voicePermissionRequest: 'miko:voice-permission-request',
  voiceSettingsOpen: 'miko:voice-settings-open',
  voiceInputDevices: 'miko:voice-input-devices',
  voiceMicTest: 'miko:voice-mic-test',
  summonShortcutGet: 'miko:summon-shortcut-get',
  summonShortcutSet: 'miko:summon-shortcut-set',
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
  mailCorrections: 'miko:mail-corrections',
  mailCorrect: 'miko:mail-correct',
  mailSetupLink: 'miko:mail-setup-link',
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
  switcherCloseTab: 'miko:switcher-close-tab',
  switcherFeedApp: 'miko:switcher-feed-app',
  switcherFeedTab: 'miko:switcher-feed-tab',
  switcherDropTarget: 'miko:switcher-drop-target',
  switcherClose: 'miko:switcher-close',
  switcherOpened: 'miko:switcher-opened',
  /** Switcher renderer: ignore empty glass so clicks reach MIKO underneath (macOS). */
  switcherIgnoreMouse: 'miko:switcher-ignore-mouse',
  whatsappOpen: 'miko:whatsapp-open',
  whatsappCancel: 'miko:whatsapp-cancel',
  whatsappAliases: 'miko:whatsapp-aliases',
  whatsappRemember: 'miko:whatsapp-remember',
  whatsappForget: 'miko:whatsapp-forget',
  whatsappPeek: 'miko:whatsapp-peek',
  whatsappInsert: 'miko:whatsapp-insert',
  whatsappContextNotice: 'miko:whatsapp-context-notice',
  whatsappAttachmentsList: 'miko:whatsapp-attachments-list',
  whatsappAttachmentSave: 'miko:whatsapp-attachment-save',
  clipboardFile: 'miko:clipboard-file',
  pasteFileWhatsApp: 'miko:paste-file-whatsapp',
  revealFile: 'miko:reveal-file',
  openLocalFile: 'miko:open-local-file',
  openUrl: 'miko:open-url',
  closeWebsite: 'miko:close-website',
  chromeProfilesList: 'miko:chrome-profiles-list',
  chromeProfilesLaunch: 'miko:chrome-profiles-launch',
  chromeProfilesFallback: 'miko:chrome-profiles-fallback',
  prefsStructuredGet: 'miko:prefs-structured-get',
  prefsStructuredSet: 'miko:prefs-structured-set',
  examplesList: 'miko:examples-list',
  examplesAdd: 'miko:examples-add',
  examplesRemove: 'miko:examples-remove',
  lastExternalApp: 'miko:last-external-app',
  appInfo: 'miko:app-info',
  feedbackConfigGet: 'miko:feedback-config-get',
  feedbackConfigSet: 'miko:feedback-config-set',
  feedbackPreview: 'miko:feedback-preview',
  feedbackSubmit: 'miko:feedback-submit',
  feedbackList: 'miko:feedback-list',
  feedbackRetry: 'miko:feedback-retry',
  feedbackDelete: 'miko:feedback-delete',
  feedbackExport: 'miko:feedback-export',
  feedbackExportDraft: 'miko:feedback-export-draft',
  updateStatus: 'miko:update-status',
  updateGet: 'miko:update-get',
  updateCheck: 'miko:update-check',
  updateRestart: 'miko:update-restart',
  updateLater: 'miko:update-later',
  updateOpenDownload: 'miko:update-open-download',
  updateFeedSet: 'miko:update-feed-set',
  updateManualReleaseSet: 'miko:update-manual-release-set',
  updateStartup: 'miko:update-startup'
} as const

export type OpenUrlResult = {
  ok: boolean
  url: string
  name: string
  browser: string
  reason: string
}

export type CloseWebsiteResult =
  | { status: 'closed'; closed: number; tabs: { browser: string; window: number; tab: number; title: string; url: string }[] }
  | { status: 'choices'; tabs: { browser: string; window: number; tab: number; title: string; url: string }[]; reason: string }
  | { status: 'none'; reason: string }
  | { status: 'unsupported'; reason: string }
  | { status: 'failed'; reason: string }

export type InsertResult =
  | { state: 'inserted'; mode: string }
  | { state: 'pasted'; reason: string }
  | { state: 'has-text'; length: number }
  | { state: 'unavailable'; reason: string }
  | { state: 'failed'; reason: string }

export interface SelectionEvent {
  captureId: string
  ok: boolean
  text: string
  app: string
  method: string
  canReplace: boolean
  reason: string
}

export interface PasteStateEvent {
  state: 'armed' | 'done' | 'cancelled' | 'expired' | 'failed'
  reason: string
  verified: boolean
}

export interface OpenResult {
  ok: boolean
  /** 'workspace' = MIKO's own Interactive GPT window (Windows has no native ChatGPT app automation). */
  target: 'app' | 'browser' | 'workspace' | 'none'
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

export interface AppDiscoveryInfo {
  ok: boolean
  source: 'start-apps' | 'shortcuts' | 'mac-folders' | 'none'
  count: number
  detail: string
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

/** Listening starts only when the recognizer really started; otherwise a reason and a settings page. */
export interface ListenStartResult {
  ok: boolean
  reason: string
  help?: 'microphone-privacy' | 'sound-input' | 'speech-language'
}

export interface SpeechEvent {
  phase: 'transcript' | 'denied' | 'silence' | 'unavailable' | 'cancelled' | 'failed'
  text?: string
  /** Plain, actionable reason when recognition failed (Windows helper). */
  detail?: string
  /** Settings page that fixes the failure; the panel offers it next to Retry. */
  help?: 'microphone-privacy' | 'sound-input' | 'speech-language'
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
import type { Categorized, ImportanceRules, MailAccount, MailCategory, MailCorrections, MailFilter, MailMessage, MailSummary, Importance, ThreadEntry } from './mail'
export type { Categorized, ImportanceRules, MailAccount, MailCategory, MailCorrections, MailFilter, MailMessage, MailSummary, Importance, ThreadEntry }

export interface BridgeStatusInfo {
  enabled: boolean
  available: boolean
  signedIn: boolean
  thread: string
  busy: boolean
  provider?: 'chatgpt-bundled' | 'path' | 'none'
  reason?: string
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

export type ListedMail = MailSummary & { category: Categorized }

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

export type MailReadResult = { ok: true; message: MailMessage; thread: ThreadEntry[] } | { ok: false; reason: string; reconnect?: string }

/** Google Cloud pages for the one-time Gmail setup (fixed list; main opens them). */
export type MailSetupLink = 'project' | 'gmail-api' | 'branding' | 'audience' | 'data-access' | 'clients'

export interface MailCorrectRequest {
  key: string
  fromEmail: string
  /** null = remove the correction. */
  category: MailCategory | null
  scope: 'message' | 'sender'
}
import type { SavedChat } from './chatgpt'
import type { WhatsAppAlias, WhatsAppMatch, WhatsAppOpenResult } from './whatsapp'
import type { WhatsAppInsertResult, WhatsAppPeekResult } from './whatsapp-reply'
import type { ParsedAttachmentBubble } from './whatsapp-attachments'
export type { WhatsAppAlias, WhatsAppMatch, WhatsAppOpenResult, WhatsAppPeekResult, WhatsAppInsertResult }

export type WhatsAppAttachmentsListResult =
  | {
      status: 'listed'
      header: string
      attachments: ParsedAttachmentBubble[]
      atLatest: boolean
      visibleOnly: true
      reason: string
      composerText: string
    }
  | { status: 'failed' | 'permission' | 'lost-focus' | 'cancelled' | 'unsupported'; header: string; reason: string; attachments: [] }

export type WhatsAppAttachmentSaveResult = {
  status:
    | 'saved'
    | 'candidate'
    | 'failed'
    | 'switched'
    | 'missing'
    | 'cancelled'
    | 'permission'
    | 'lost-focus'
    | 'unsupported'
  header: string
  reason: string
  path: string
  filename: string
  bytes: number
  verified: boolean
  provenance: 'ax-new-file' | 'user-accepted-candidate' | 'unverified-candidate' | 'none'
}

export type ClipboardFileResult = {
  status: 'copied' | 'failed'
  reason: string
  path: string
  filename: string
  bytes: number
  verified: boolean
}

export type PasteFileWhatsAppResult = {
  status: 'attached' | 'failed' | 'switched' | 'cancelled' | 'permission' | 'lost-focus'
  header: string
  reason: string
  path: string
  filename: string
  verified: boolean
  composerText: string
}
import type { KeyEvent } from './keys'

/** Preload surface. The renderer has no Node integration. */
export interface MikoApi {
  /** Move the window by a DIP delta. The main process clamps the pet to the work area. */
  moveBy: (delta: MoveDelta) => void
  /** Resize around the pet so the note panel stays inside the work area. */
  setPanelOpen: (open: boolean, mode?: PanelMode) => Promise<PanelLayout>
  /** Drag-resize the open panel; done saves the size for this tab. */
  panelResize: (width: number, height: number, done: boolean) => Promise<PanelLayout>
  /** Small / Medium / Large for the open tab, or reset to its default. */
  panelPreset: (preset: 'small' | 'medium' | 'large' | 'reset') => Promise<PanelLayout>
  /** Pets whose assets exist (Doberman first) and the saved choice. */
  petList: () => Promise<PetListing>
  /** A pet's .glb bytes (null for the bundled Doberman, or when the file is missing). */
  petModel: (id: PetId) => Promise<ArrayBuffer | null>
  /** Remember a pet after it loaded on screen. */
  petSave: (id: PetId) => Promise<boolean>
  /** Tell main which pet is on screen and its scale (shows the bird's tree). */
  petActive: (id: PetId, unitPx: number) => void
  /** Flight geometry for the bird: where it is, the ground, and its perch. */
  petFlight: () => Promise<PetFlightInfo>
  /** Paw-menu pet choices. */
  onPetCommand: (listener: (command: PetCommand) => void) => () => void
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
  /** Whether this computer's app list could be read (Windows: Get-StartApps). */
  appsStatus: () => Promise<AppDiscoveryInfo>
  /** Launch a validated action id. Unfamiliar apps launch only after confirm. */
  launchApp: (request: LaunchRequest) => Promise<LaunchResult>
  /** Launch or focus the ChatGPT app; falls back to chatgpt.com in the default browser. */
  openChatGpt: () => Promise<OpenResult>
  /** Put a prompt into ChatGPT's message box only when Accessibility can identify it (see PROJECT_LOG). */
  chatgptInsert: (prompt: string, mode?: 'append' | 'replace') => Promise<InsertResult>
  /** Capture focused editable field (excludes MIKO) for typing destinations. */
  typeDestCapture: () => Promise<import('./destination').TypeDestination | null>
  /** Capture “type here” from last external app / focused field. */
  typeDestCaptureHere: () => Promise<import('./destination').TypeDestination | null>
  typeDestOpenChatGpt: () => Promise<{ ok: boolean; reason: string; dest: import('./destination').TypeDestination | null }>
  typeDestNewChat: () => Promise<{ ok: boolean; verified: boolean; reason: string; dest: import('./destination').TypeDestination | null }>
  typeDestInsert: (request: {
    text: string
    dest: import('./destination').TypeDestination
    mode?: 'replace' | 'append' | 'ask'
    allowUnexposedChatGpt?: boolean
  }) => Promise<import('./destination').TypeInsertResult>
  typeDestOmnibox: (text: string) => Promise<import('./destination').TypeInsertResult>
  typeDestOpenNotes: () => Promise<{ ok: boolean; reason: string; dest: import('./destination').TypeDestination | null }>
  typeDestCancel: () => void
  /** Opt-in GPT Mode (messages → ChatGPT app). Separate from MIKO assistant. */
  gptModeGet: () => Promise<import('./gpt-mode').GptModeState>
  gptModeEnable: () => Promise<import('./gpt-mode').GptModeState>
  gptModePause: () => Promise<import('./gpt-mode').GptModeState>
  gptModeResume: () => Promise<import('./gpt-mode').GptModeState>
  gptModeExit: () => Promise<import('./gpt-mode').GptModeState>
  gptModeNewChat: () => Promise<{ ok: boolean; verified: boolean; reason: string }>
  gptModeSend: (request: {
    requestId: string
    text: string
    mode?: 'replace' | 'append' | 'ask'
  }) => Promise<import('./gpt-mode').GptSendResult>
  gptModeCancel: () => void
  gptModeFocus: () => Promise<{ ok: boolean; reason: string }>
  /** Open optional ChatGPT Web workspace (real chatgpt.com; separate session). */
  chatgptWebOpen: () => Promise<{ ok: boolean; reason: string }>
  chatgptWebStatus: () => Promise<{
    open: boolean
    collapsed: boolean
    pinned: boolean
    visible: boolean
    url: string
    title: string
    canGoBack: boolean
    canGoForward: boolean
    downloadNote: string
    dropNote: string
    dictateArmed: boolean
    partition: string
    label: string
  }>
  onUiHint: (listener: (hint: {
    tuckPanel?: boolean
    dictateToGpt?: boolean
    openSetup?: boolean
    runTutorial?: boolean
    listen?: boolean
  }) => void) => () => void
  chatgptWebCollapse: () => Promise<boolean>
  chatgptWebExpand: () => Promise<boolean>
  chatgptWebClose: () => Promise<boolean>
  chatgptWebInsertTranscript: (text: string) => Promise<{ ok: boolean; reason: string }>
  /** Explicit one-shot: clipboard text → Interactive GPT composer (unsent; draft preserved). */
  chatgptWebPasteClipboard: () => Promise<{ ok: boolean; reason: string; text?: string }>
  /** Submit current Interactive GPT composer once (bound draft only; never retries). */
  chatgptWebSubmitDraft: (opts?: {
    expectedText?: string
    generation?: number
  }) => Promise<{
    ok: boolean
    status:
      | 'submitted-observed'
      | 'delivery-unverified'
      | 'empty'
      | 'changed'
      | 'unavailable'
      | 'cancelled'
      | 'failed'
    reason: string
    composerText: string
  }>
  chatgptWebCancelSubmit: () => Promise<number>
  /** Arm/disarm one-shot Dictate-to-GPT (next mic final → composer). */
  chatgptWebDictateArm: (armed: boolean) => Promise<boolean>
  gptModeSetLiveView: (enabled: boolean) => Promise<import('./gpt-mode').GptModeState>
  gptModeLiveSnapshot: () => Promise<import('./gpt-mode').GptLiveSnapshot>
  gptModeListSources: () => Promise<{
    ok: boolean
    reason: string
    permission: string
    sources: import('./gpt-mode').GptCaptureSource[]
  }>
  gptModeSetSource: (sourceId: string, name?: string, owner?: string) => Promise<import('./gpt-mode').GptModeState>
  gptModeLiveSizePreset: (preset: import('./gpt-mode').GptLiveSizePreset) => Promise<boolean>
  gptModeLiveCollapse: (collapsed: boolean) => Promise<boolean>
  onGptModeLiveCollapse: (listener: (collapsed: boolean) => void) => () => void
  gptModeOpenPicker: () => void
  onGptModeOpenPicker: (listener: () => void) => () => void
  onGptModeState: (listener: (state: import('./gpt-mode').GptModeState) => void) => () => void
  /** Lens: verify bound window bounds (CGWindow). */
  lensWindowBounds: (sourceId?: string) => Promise<import('./lens-control').LensWindowBounds | null>
  /** Lens Control: click / double-click / scroll at mapped screen points. */
  lensPointer: (request: import('./lens-control').LensPointerRequest) => Promise<import('./lens-control').LensPointerResult>
  /** Lens Control: type into the bound source (brings it forward). */
  lensType: (request: import('./lens-control').LensTypeRequest) => Promise<import('./lens-control').LensTypeResult>
  /** Resolve Finder selection to real file URLs (never OCR). */
  lensFinderSelection: (sourceId?: string) => Promise<import('./lens-control').LensFinderSelectionResult>
  /** Native file picker for Lens shelf. */
  lensPickFiles: () => Promise<import('./lens-control').LensFinderSelectionResult>
  /** Session-proven attachment files for the Lens shelf. */
  lensProvenFiles: () => Promise<import('./lens-control').LensResolvedFile[]>
  lensCopyFile: (path: string) => Promise<{ ok: boolean; reason: string }>
  lensRevealFile: (path: string) => Promise<boolean>
  /** Begin a native OS file drag from the Lens shelf (dragstart only). */
  lensStartDrag: (path: string) => void
  /** Attach a real file to ChatGPT (unsent); verifies preview before Attached. */
  lensAttachChatGpt: (path: string, sourceId?: string) => Promise<import('./lens-control').LensAttachResult>
  /** Register a verified path onto the Lens shelf. */
  lensRegisterFile: (path: string) => Promise<import('./lens-control').LensResolvedFile | null>
  /** Drop in-flight Lens pointer/type work (Control cancel / source change). */
  lensCancelInput: () => void
  /** One intentional activate of the bound Lens source (Open original). */
  lensOpenOriginal: (sourceId?: string) => Promise<{ ok: boolean; reason: string; pid: number }>
  /** Spotify media controls that must not steal focus. */
  spotifyMedia: (
    action: import('./lens-control').SpotifyMediaAction
  ) => Promise<import('./lens-control').SpotifyMediaStatus>
  /** Saved ChatGPT shortcuts, stored in MIKO's local settings. */
  listChats: () => Promise<SavedChat[]>
  addChat: (name: string, url: string) => Promise<ChatEditResult>
  renameChat: (from: string, to: string) => Promise<ChatEditResult>
  removeChat: (name: string) => Promise<ChatEditResult>
  /** Open a saved chat through the system URL handler. */
  openChat: (name: string) => Promise<OpenResult>
  /** Open a website in the default browser, or a named browser when given. */
  openUrl: (url: string, name?: string, browser?: string | null) => Promise<OpenUrlResult>
  /** Discover local Chrome profiles (names/avatars/directory ids only). */
  chromeProfilesList: () => Promise<import('./chrome-profiles').ChromeProfileView[] | { status: string; reason: string; fallbacks?: { id: string; label: string }[] }>
  /** Launch Chrome with a validated profile directory id (optional http(s) URL). */
  chromeProfilesLaunch: (request: {
    directoryId: string
    url?: string | null
    displayName?: string | null
  }) => Promise<{
    ok: boolean
    directoryId: string
    displayName: string
    url: string
    reason: string
    verified: false
    verificationNote: string
  }>
  /** When metadata is unreadable: Chrome’s picker or a normal launch. */
  chromeProfilesFallback: (kind: 'profile-picker' | 'normal', url?: string | null) => Promise<{
    ok: boolean
    reason: string
    verified: false
    verificationNote: string
  }>
  /** Close matching browser tabs without quitting the browser. */
  closeWebsite: (request: {
    host?: string
    url?: string
    all?: boolean
    thisTab?: boolean
    pick?: { browser: 'chrome' | 'safari'; window: number; tab: number }
  }) => Promise<CloseWebsiteResult>
  /** Last non-MIKO front app (for “this tab” / context). */
  lastExternalApp: () => Promise<{ name: string; bundleId: string; pid: number } | null>
  prefsStructuredGet: () => Promise<import('./preferences').MikoStructuredPreferences | null>
  prefsStructuredSet: (prefs: import('./preferences').MikoStructuredPreferences) => Promise<boolean>
  examplesList: () => Promise<import('./preferences').CorrectionExample[]>
  examplesAdd: (example: {
    wording: string
    actionKind: string
    targetAlias?: string
    note?: string
  }) => Promise<import('./preferences').CorrectionExample[]>
  examplesRemove: (id: string) => Promise<import('./preferences').CorrectionExample[]>
  /** Search WhatsApp for a contact. Pass pickId to reopen a chooser result after revalidation. */
  whatsappOpen: (query: string, pickId?: string, taskId?: string) => Promise<WhatsAppOpenResult>
  whatsappCancel: () => void
  whatsappAliases: () => Promise<WhatsAppAlias[]>
  whatsappRemember: (alias: string, name: string) => Promise<{ ok: boolean; reason: string; list: WhatsAppAlias[] }>
  whatsappForget: (alias: string) => Promise<{ ok: boolean; reason: string; list: WhatsAppAlias[] }>
  /** Read the open WhatsApp chat header (and optional visible messages). Pass latest to scroll to newest first. */
  whatsappPeek: (messages?: boolean, latest?: boolean) => Promise<WhatsAppPeekResult>
  /** Insert a reviewed draft into the verified chat composer. Never sends. */
  whatsappInsert: (request: { expectHeader: string; text: string; mode: 'replace' | 'append' | 'ask' }) => Promise<WhatsAppInsertResult>
  whatsappMarkContextNotice: () => Promise<boolean>
  /** List visible WhatsApp document attachments in the open chat. */
  whatsappAttachmentsList: () => Promise<WhatsAppAttachmentsListResult>
  /** Save a WhatsApp attachment via Save to Downloads (or reuse an existing Downloads copy). */
  whatsappAttachmentSave: (request: {
    expectHeader: string
    filename: string
    id?: string
    /** Explicit owner accept of an unverified Downloads candidate path. */
    acceptCandidatePath?: string
  }) => Promise<WhatsAppAttachmentSaveResult>
  /** Put a real file reference on the pasteboard (not path text). */
  clipboardFile: (path: string) => Promise<ClipboardFileResult>
  /** Paste a file into the verified WhatsApp composer. Never sends. */
  pasteFileWhatsApp: (request: { expectHeader: string; path: string }) => Promise<PasteFileWhatsAppResult>
  revealFile: (path: string) => Promise<boolean>
  openLocalFile: (path: string) => Promise<string>
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
  listenStart: () => Promise<ListenStartResult>
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
  bridgeSetEnabled: (enabled: boolean) => Promise<BridgeStatusInfo | null>
  bridgeSend: (requestId: string, prompt: string, opts?: { fresh?: boolean; keep?: boolean }) => Promise<{ ok: boolean; reason: string }>
  /** Selected-text assistant. */
  onSelection: (listener: (event: SelectionEvent) => void) => () => void
  selectionClipboard: () => Promise<SelectionEvent>
  selectionReplace: (captureId: string, text: string) => Promise<{ ok: boolean; reason: string; verified: boolean }>
  /** target 'chatgpt': paste only when ChatGPT is in front. */
  pasteArm: (text: string, target?: 'chatgpt') => Promise<{ ok: boolean; reason: string }>
  pasteCancel: () => void
  onPasteState: (listener: (event: PasteStateEvent) => void) => () => void
  selectionShortcutGet: () => Promise<string>
  selectionShortcutSet: (accelerator: string) => Promise<{ ok: boolean; reason: string; shortcut: string }>
  setupGet: () => Promise<import('./setup').SetupState>
  setupUpdate: (update: import('./setup').SetupUpdate) => Promise<import('./setup').SetupState>
  voicePermissionGet: () => Promise<import('./setup').VoicePermissionStatus>
  voicePermissionRequest: () => Promise<import('./setup').VoicePermissionStatus>
  /** Opens microphone privacy settings, or a specific page for a speech failure. */
  voiceSettingsOpen: (help?: 'microphone-privacy' | 'sound-input' | 'speech-language') => Promise<boolean>
  /** Windows: input devices Windows reports (System.Speech always uses the default input). */
  voiceInputDevices: () => Promise<{ devices: string[]; detail: string }>
  voiceMicTest: () => Promise<import('./setup').MicTestStatus>
  summonShortcutGet: () => Promise<import('./setup').SummonShortcutStatus>
  summonShortcutSet: (accelerator: string) => Promise<import('./setup').SummonShortcutStatus>
  bridgeCancel: (requestId: string) => void
  /** Start a new assistant conversation (the next question opens a fresh thread). */
  bridgeNew: () => Promise<void>
  /** MIKO preferences (stored on this Mac, added to new assistant conversations). */
  prefsGet: () => Promise<string>
  prefsSet: (text: string) => Promise<boolean>
  /** Version / build identity for Settings and feedback diagnostics. */
  appInfo: () => Promise<{
    name: string
    version: string
    buildId: string
    channel: string
    packaged: boolean
    platform: string
    arch: string
  }>
  feedbackConfigGet: () => Promise<{ endpoint: string; inviteCode: string; hasEndpoint: boolean }>
  feedbackConfigSet: (partial: { endpoint?: string; inviteCode?: string }) => Promise<{
    endpoint: string
    inviteCode: string
    hasEndpoint: boolean
  }>
  feedbackPreview: (draft: import('./feedback').FeedbackDraft, opts?: { actionType?: string | null; errorCode?: string | null }) => Promise<
    | { ok: true; preview: string; payload: import('./feedback').FeedbackPayload }
    | { ok: false; reason: string }
  >
  feedbackSubmit: (
    draft: import('./feedback').FeedbackDraft,
    opts?: { actionType?: string | null; errorCode?: string | null; clientKey?: string }
  ) => Promise<{
    ok: boolean
    reason: string
    delivered: boolean
    item: import('./feedback').FeedbackQueueItem | null
  }>
  feedbackList: () => Promise<import('./feedback').FeedbackQueueItem[]>
  feedbackRetry: (id: string) => Promise<{ ok: boolean; reason: string; item: import('./feedback').FeedbackQueueItem | null }>
  feedbackDelete: (id: string) => Promise<import('./feedback').FeedbackQueueItem[]>
  feedbackExport: (id: string) => Promise<{ ok: boolean; reason: string; path: string }>
  feedbackExportDraft: (
    draft: import('./feedback').FeedbackDraft,
    opts?: { actionType?: string | null; errorCode?: string | null }
  ) => Promise<{
    ok: boolean
    reason: string
    path: string
    item: import('./feedback').FeedbackQueueItem | null
  }>
  updateGet: () => Promise<import('./updater').UpdateStatus>
  updateCheck: () => Promise<import('./updater').UpdateStatus>
  updateRestart: (draftText?: string) => Promise<{ ok: boolean; reason: string }>
  updateLater: () => Promise<import('./updater').UpdateStatus>
  updateOpenDownload: (draftText?: string) => Promise<{ ok: boolean; reason: string }>
  updateFeedSet: (url: string) => Promise<{ ok: boolean; reason: string }>
  updateManualReleaseSet: (partial: {
    downloadUrl?: string
    latestJsonUrl?: string
  }) => Promise<{ ok: boolean; reason: string; config: { downloadUrl: string; latestJsonUrl: string } }>
  /** After an update relaunch: notice + recovered chat draft (not a queued send). */
  updateStartup: () => Promise<{ notice: string; draft: string }>
  onUpdateStatus: (listener: (status: import('./updater').UpdateStatus) => void) => () => void
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
  /** Category corrections (stored in MIKO's settings on this Mac). */
  mailCorrections: () => Promise<MailCorrections | null>
  mailCorrect: (request: MailCorrectRequest) => Promise<MailCorrections | null>
  /** Open one of the fixed Google Cloud setup pages in the browser. */
  mailSetupLink: (which: MailSetupLink) => Promise<boolean>
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

import type { PetId } from './pets'
export type { PetId }

export interface PetListing {
  available: { id: PetId; name: string; blurb: string }[]
  selected: PetId
}

export interface PetFlightInfo {
  origin: { x: number; y: number }
  groundY: number
  perch: { x: number; y: number } | null
}

export type PetCommand = { kind: 'switch'; pet: PetId } | { kind: 'choose' } | { kind: 'feed' }
