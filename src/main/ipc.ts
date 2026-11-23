import { app, BrowserWindow, clipboard, ipcMain, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron'
import { IPC, type AppListing, type HitRect, type LaunchResult, type PanelLayout } from '../shared/api'
import { parseActionId } from '../shared/commands'
import { logDiag } from './diagnostics'
import { appDiscoveryStatus, launchApplication, listApplications } from './apps'
import { insertIntoChatGpt, openChatGpt, openChatUrl } from './chatgpt'
import {
  cancelTypeDest,
  captureFocusedDestination,
  captureHereDestination,
  chatgptNewChat,
  insertIntoDestination,
  openAndFocusChatGpt,
  openNotes,
  setOmniboxText
} from './type-dest'
import {
  cancelGptDelivery,
  enableGptMode,
  exitGptMode,
  focusChatGptWindow,
  getGptModeState,
  gptLiveViewSnapshot,
  gptModeNewChat,
  listGptCaptureSources,
  loadGptModeFromSettings,
  onGptModeState,
  pauseGptMode,
  resumeGptMode,
  sendGptModeMessage,
  setGptCaptureSource,
  setGptLiveView
} from './gpt-mode'
import {
  applyGptLiveSizePreset,
  closeGptLiveWindow,
  isGptLiveSender,
  openGptLiveWindow,
  postToGptLive,
  setGptLiveCollapsed
} from './gpt-live-window'
import {
  cancelLensInput,
  lensOpenOriginal,
  lensAttachToChatGpt,
  lensCopyFile,
  lensFinderSelection,
  lensPickFiles,
  lensPointer,
  lensProvenFiles,
  lensRevealFile,
  lensStartDrag,
  lensType,
  lensWindowBounds,
  registerLensFileFromProven
} from './lens-control'
import { spotifyMedia } from './spotify'
import {
  chatgptWebBack,
  chatgptWebForward,
  cancelChatGptWebSubmit,
  chatgptWebInsertTranscript,
  chatgptWebPasteClipboard,
  chatgptWebReload,
  dismissChatGptWebBlockedLink,
  openChatGptWebBlockedLink,
  openChatGptWebInBrowser,
  retryChatGptWebLoad,
  chatgptWebStatus,
  chatgptWebSubmitCurrentDraft,
  chatgptWebSubmitGeneration,
  closeChatGptWebWindow,
  collapseChatGptWebWindow,
  expandChatGptWebWindow,
  getChatGptWebDownload,
  isChatGptWebSender,
  onChatGptWebDownload,
  openChatGptWebWindow,
  expandChatGptWebFromDrag,
  setChatGptWebChromeDragActive,
  setChatGptWebChromeHeight,
  setChatGptWebDictateArmed,
  setChatGptWebPinned
} from './chatgpt-web-window'
import { addChat, removeChat, renameChat, type ChatEdit } from '../shared/chatgpt'
import { comeToFront, enableFollow } from './follow'
import { requestClose, watchClose } from './quit'
import {
  cancelListening,
  cancelMicTest,
  listInputDevices,
  openVoicePrivacySettings,
  runMicTest,
  startListening,
  stopListening,
  voicePermissionStatus
} from './speech'
import { registerSwitcherIpc, toggleSwitcherFromPet } from './switcher-window'
import { registerMailIpc } from './mail/ipc'
import { bridgeStatus, cancelBridge, newConversation, sendBridge, stopAllBridges } from './bridge'
import {
  deleteFeedbackItem,
  ensureFeedbackStore,
  exportFeedback,
  exportFeedbackDraft,
  getFeedbackConfig,
  listFeedbackQueue,
  previewFeedback,
  retryFeedback,
  setFeedbackConfig,
  submitFeedback
} from './feedback'
import { APP_CHANNEL, APP_NAME, APP_VERSION, buildId } from '../shared/build-info'
import type { FeedbackDraft } from '../shared/feedback'
import {
  checkForUpdates,
  getUpdateStatus,
  openManualDownload,
  restartToUpdate,
  setManualReleaseConfig,
  setUpdateFeedOverride,
  silenceCurrentUpdate
} from './updater'
import { takeRecoveredDraft, takeUpdateNotice } from './session-flush'
import { armPaste, clipboardSelection, disarmPaste, replaceSelection } from './selection'
import {
  addCorrectionExample,
  correctionExamples,
  mikoPreferences,
  removeCorrectionExample,
  savedChats,
  setMikoPreferences,
  setAssistantEnabled,
  setSetupState,
  setSavedChats,
  setStructuredPreferences,
  structuredPreferences,
  setupState,
  voiceAutoExecute
} from './settings'
import { applySetupUpdate, defaultSetupState, parseSetupUpdate } from '../shared/setup'
import type { SummonShortcut } from './summon-shortcut'
import {
  cancelWhatsApp,
  insertWhatsAppDraft,
  listWhatsAppAliases,
  markWhatsAppContextNoticeSeen,
  openWhatsAppContact,
  peekWhatsApp,
  removeWhatsAppAlias,
  saveWhatsAppAlias
} from './whatsapp'
import {
  cancelAttachmentWork,
  copyFileToClipboard,
  listWhatsAppAttachments,
  openLocalFile,
  pasteFileIntoWhatsApp,
  revealInFinder,
  saveWhatsAppAttachment
} from './whatsapp-attachments'
import { openUrl } from './open-url'
import { refreshTrayMenu } from './tray'
import { availablePets, currentPetChoice, flightInfo, isTreeSender, petModel, savePetChoice, setActivePet } from './pets'
import { PETS, parsePetId } from '../shared/pets'
import { closeWebsiteTabs } from './browser-tabs'
import { openProjector, registerProjectorIpc } from './projector'
import { registerKnowledgeIpc } from './knowledge'
import { openLogsFolder, setSystemOptions, systemOptions } from './system-options'
import { hideToy, parseThrowRequest, playSettings, setPlayMode, setPlaySound, throwToy } from './play'
import { lastExternalApp } from './foreground'
import { launchChromeFallback, launchChromeProfile, listChromeProfiles } from './chrome-profiles'
import { isValidChromeDirectoryId } from '../shared/chrome-profiles'
import {
  currentLayout,
  isTrustedSender,
  movePetBy,
  postToPet,
  raisePetWindow,
  setDragActive,
  setHitRects,
  setPanelOpen,
  resizePanel,
  setPanelPreset,
  setPointerHeld,
  setReducedMotion,
  shiftBy,
  travelBy,
  unpinHome
} from './pet-window'

const MAX_DELTA = 5000
const MAX_TRAVEL = 20000
const MAX_COPY = 4000
const MAX_PASTE = 8000

export function registerIpc(presence: {
  setReducedMotion: (reduced: boolean) => void
  exitFinished: (generation: number) => void
}, summonShortcut: SummonShortcut): void {
  ipcMain.on(IPC.moveBy, (event, payload: unknown) => {
    if (!trusted(event)) return
    const delta = parseDelta(payload)
    if (!delta) return
    movePetBy(delta.dx, delta.dy)
  })

  ipcMain.handle(IPC.setPanelOpen, (event, open: unknown, mode: unknown): PanelLayout => {
    if (!trusted(event) || typeof open !== 'boolean') return currentLayout()
    if (mode === 'mail' || mode === 'chat') return setPanelOpen(open, mode)
    return setPanelOpen(open)
  })

  ipcMain.handle(IPC.panelResize, (event, width: unknown, height: unknown, done: unknown): PanelLayout => {
    if (!trusted(event) || typeof width !== 'number' || typeof height !== 'number') return currentLayout()
    return resizePanel(width, height, done === true)
  })

  ipcMain.handle(IPC.petList, (event) => {
    if (!trusted(event)) return { available: [], selected: 'doberman' }
    return {
      available: availablePets().map((id) => ({ id, name: PETS[id].name, blurb: PETS[id].blurb })),
      selected: currentPetChoice()
    }
  })

  ipcMain.handle(IPC.petModel, (event, id: unknown) => {
    // The bird's tree window reads the bird asset for its tree.
    const pet = parsePetId(id)
    if (!pet || (!trusted(event) && !(isTreeSender(event.sender.id) && pet === 'bird'))) return null
    return petModel(pet)
  })

  ipcMain.handle(IPC.petSave, (event, id: unknown) => {
    const pet = parsePetId(id)
    const saved = trusted(event) && pet ? savePetChoice(pet) : false
    if (saved) refreshTrayMenu()
    return saved
  })

  ipcMain.on(IPC.petActive, (event, id: unknown, unitPx: unknown) => {
    const pet = parsePetId(id)
    if (!trusted(event) || !pet || typeof unitPx !== 'number') return
    setActivePet(pet, unitPx)
  })

  ipcMain.handle(IPC.petFlight, (event) => (trusted(event) ? flightInfo() : null))
  ipcMain.handle(IPC.playThrow, (event, raw: unknown) => {
    if (!trusted(event)) return { ok: false, reason: 'Not allowed.', targetX: 0, seconds: 0 }
    const request = parseThrowRequest(raw)
    return request ? throwToy(request) : { ok: false, reason: 'That throw isn\u2019t valid.', targetX: 0, seconds: 0 }
  })
  ipcMain.on(IPC.playToyHide, (event) => {
    if (trusted(event)) hideToy()
  })
  ipcMain.handle(IPC.playSettingsGet, (event) => (trusted(event) ? playSettings() : { mode: 'work', sound: false }))
  ipcMain.handle(IPC.playSettingsSet, (event, raw: unknown) => {
    if (!trusted(event)) return { mode: 'work', sound: false }
    const next = raw as { mode?: unknown; sound?: unknown } | null
    if (next?.mode === 'work' || next?.mode === 'casual') setPlayMode(next.mode)
    if (typeof next?.sound === 'boolean') setPlaySound(next.sound)
    return playSettings()
  })

  ipcMain.handle(IPC.panelPreset, (event, preset: unknown): PanelLayout => {
    if (!trusted(event)) return currentLayout()
    if (preset === 'small' || preset === 'medium' || preset === 'large' || preset === 'reset') return setPanelPreset(preset)
    return currentLayout()
  })

  ipcMain.on(IPC.setHitRects, (event, payload: unknown) => {
    if (!trusted(event)) return
    const rects = parseHitRects(payload)
    if (!rects) return
    setHitRects(rects)
  })

  ipcMain.on(IPC.setDragActive, (event, active: unknown) => {
    if (!trusted(event) || typeof active !== 'boolean') return
    setDragActive(active)
  })

  ipcMain.on(IPC.setPointerHeld, (event, active: unknown) => {
    if (!trusted(event) || typeof active !== 'boolean') return
    setPointerHeld(active)
  })

  ipcMain.on(IPC.travelBy, (event, payload: unknown) => {
    if (!trusted(event)) return
    const travel = parseTravel(payload)
    if (!travel) return
    travelBy(travel.dx, travel.reduced)
  })

  ipcMain.on(IPC.shiftBy, (event, payload: unknown) => {
    if (!trusted(event)) return
    const shift = parseShift(payload)
    if (!shift) return
    shiftBy(shift.dx, shift.dy, shift.reduced)
  })

  ipcMain.on(IPC.unpinHome, (event) => {
    if (!trusted(event)) return
    unpinHome()
  })

  ipcMain.handle(IPC.listApps, (event): Promise<AppListing[]> => {
    if (!trusted(event)) return Promise.resolve([])
    return listApplications()
  })
  ipcMain.handle(IPC.appsStatus, (event) => {
    if (!trusted(event)) return { ok: false, source: 'none', count: 0, detail: 'Not allowed.' }
    return appDiscoveryStatus()
  })

  ipcMain.handle(IPC.launchApp, (event, payload: unknown): Promise<LaunchResult> => {
    if (!trusted(event)) return Promise.resolve({ ok: false, reason: 'That action is not available.' })
    const request = parseLaunch(payload)
    if (!request) return Promise.resolve({ ok: false, reason: 'That action is not available.' })
    return launchApplication(request.id, request.confirm)
  })

  ipcMain.handle(IPC.openChatGpt, (event) => {
    if (!trusted(event)) return { ok: false, target: 'none', appName: '' }
    if (process.platform !== 'darwin') {
      // Windows: "open ChatGPT" uses MIKO's embedded workspace — never a silent switch to Chrome.
      logDiag('gpt', 'open ChatGPT routed to the Interactive GPT workspace')
      setPanelOpen(false)
      postToPet(IPC.uiHint, { tuckPanel: true })
      closeGptLiveWindow()
      openChatGptWebWindow({ focus: true })
      raisePetWindow()
      return { ok: true, target: 'workspace', appName: 'Interactive GPT' }
    }
    return openChatGpt()
  })

  ipcMain.handle(IPC.openUrl, (event, url: unknown, name: unknown, browser: unknown) => {
    if (!trusted(event) || typeof url !== 'string' || url.length > 2000) {
      return { ok: false, url: '', name: '', browser: '', reason: 'That isn’t a web address I can open.' }
    }
    return openUrl(
      url,
      typeof name === 'string' ? name.slice(0, 80) : '',
      typeof browser === 'string' ? browser.slice(0, 40) : null
    )
  })

  ipcMain.handle(IPC.chromeProfilesList, (event) => {
    if (!trusted(event)) return { status: 'missing', profiles: [], reason: 'Not allowed.', platform: process.platform }
    const prefs = structuredPreferences()
    return listChromeProfiles(prefs.defaultChromeProfileDirectory)
  })

  ipcMain.handle(IPC.chromeProfilesLaunch, (event, payload: unknown) => {
    if (!trusted(event)) {
      return {
        ok: false,
        directoryId: '',
        displayName: '',
        url: '',
        reason: 'Not allowed.',
        verified: false as const,
        verificationNote: ''
      }
    }
    const p = (payload ?? {}) as { directoryId?: unknown; url?: unknown; displayName?: unknown }
    const directoryId = typeof p.directoryId === 'string' ? p.directoryId.trim().slice(0, 40) : ''
    if (!isValidChromeDirectoryId(directoryId)) {
      return {
        ok: false,
        directoryId: '',
        displayName: '',
        url: '',
        reason: 'That isn’t a valid Chrome profile id.',
        verified: false as const,
        verificationNote: ''
      }
    }
    return launchChromeProfile({
      directoryId,
      url: typeof p.url === 'string' ? p.url.slice(0, 2000) : null,
      displayName: typeof p.displayName === 'string' ? p.displayName.slice(0, 80) : null
    })
  })

  ipcMain.handle(IPC.chromeProfilesFallback, (event, kind: unknown, url: unknown) => {
    if (!trusted(event)) {
      return { ok: false, reason: 'Not allowed.', verified: false as const, verificationNote: '' }
    }
    const mode = kind === 'profile-picker' || kind === 'normal' ? kind : null
    if (!mode) return { ok: false, reason: 'Unknown fallback.', verified: false as const, verificationNote: '' }
    return launchChromeFallback(mode, typeof url === 'string' ? url.slice(0, 2000) : null)
  })

  ipcMain.handle(IPC.closeWebsite, (event, payload: unknown) => {
    if (!trusted(event)) return { status: 'failed', reason: 'Not allowed.' }
    const p = (payload ?? {}) as {
      host?: unknown
      url?: unknown
      all?: unknown
      thisTab?: unknown
      pick?: { browser?: unknown; window?: unknown; tab?: unknown }
    }
    const pick =
      p.pick &&
      (p.pick.browser === 'chrome' || p.pick.browser === 'safari') &&
      Number.isInteger(p.pick.window) &&
      Number.isInteger(p.pick.tab)
        ? { browser: p.pick.browser as 'chrome' | 'safari', window: Number(p.pick.window), tab: Number(p.pick.tab) }
        : undefined
    return closeWebsiteTabs({
      host: typeof p.host === 'string' ? p.host.slice(0, 200) : undefined,
      url: typeof p.url === 'string' ? p.url.slice(0, 2000) : undefined,
      all: p.all === true,
      thisTab: p.thisTab === true,
      pick
    })
  })

  ipcMain.handle(IPC.lastExternalApp, (event) => {
    if (!trusted(event)) return null
    const w = lastExternalApp()
    return w ? { name: w.name, bundleId: w.bundleId, pid: w.pid } : null
  })

  ipcMain.handle(IPC.prefsStructuredGet, (event) => (trusted(event) ? structuredPreferences() : null))
  ipcMain.handle(IPC.prefsStructuredSet, (event, payload: unknown) => {
    if (!trusted(event) || !payload || typeof payload !== 'object') return false
    return setStructuredPreferences(payload as Parameters<typeof setStructuredPreferences>[0])
  })
  ipcMain.handle(IPC.examplesList, (event) => (trusted(event) ? correctionExamples() : []))
  ipcMain.handle(IPC.examplesAdd, (event, payload: unknown) => {
    if (!trusted(event) || !payload || typeof payload !== 'object') return correctionExamples()
    const p = payload as { wording?: unknown; actionKind?: unknown; targetAlias?: unknown; note?: unknown }
    if (typeof p.wording !== 'string' || typeof p.actionKind !== 'string') return correctionExamples()
    return addCorrectionExample({
      wording: p.wording,
      actionKind: p.actionKind,
      targetAlias: typeof p.targetAlias === 'string' ? p.targetAlias : undefined,
      note: typeof p.note === 'string' ? p.note : undefined
    })
  })
  ipcMain.handle(IPC.examplesRemove, (event, id: unknown) => {
    if (!trusted(event) || typeof id !== 'string') return correctionExamples()
    return removeCorrectionExample(id)
  })

  ipcMain.handle(IPC.chatgptInsert, (event, prompt: unknown, mode: unknown) => {
    if (!trusted(event) || typeof prompt !== 'string' || !prompt.trim() || prompt.length > 8000) return { state: 'failed', reason: 'Not allowed.' }
    if (process.platform !== 'darwin') {
      return {
        state: 'failed',
        reason: 'Native ChatGPT typing is available on macOS only. Use Interactive GPT on this PC.'
      }
    }
    return insertIntoChatGpt(prompt, mode === 'append' || mode === 'replace' ? mode : undefined)
  })
  ipcMain.handle(IPC.typeDestCapture, (event) => {
    if (!trusted(event)) return null
    if (process.platform !== 'darwin') return null
    return captureFocusedDestination(process.pid)
  })
  ipcMain.handle(IPC.typeDestCaptureHere, (event) => {
    if (!trusted(event)) return null
    if (process.platform !== 'darwin') return null
    return captureHereDestination(process.pid)
  })
  ipcMain.handle(IPC.typeDestOpenChatGpt, (event) => {
    if (!trusted(event)) return { ok: false, reason: 'Not allowed.', dest: null }
    if (process.platform !== 'darwin') {
      return { ok: false, reason: 'Native ChatGPT typing is available on macOS only. Use Interactive GPT on this PC.', dest: null }
    }
    return openAndFocusChatGpt()
  })
  ipcMain.handle(IPC.typeDestNewChat, (event) => {
    if (!trusted(event)) return { ok: false, verified: false, reason: 'Not allowed.', dest: null }
    if (process.platform !== 'darwin') {
      return {
        ok: false,
        verified: false,
        reason: 'Native ChatGPT New Chat automation is available on macOS only. Use Interactive GPT on this PC.',
        dest: null
      }
    }
    return chatgptNewChat()
  })
  ipcMain.handle(IPC.typeDestInsert, (event, request: unknown) => {
    if (!trusted(event)) {
      return { status: 'failed', destination: null, composerText: '', verified: false, reason: 'Not allowed.' }
    }
    if (process.platform !== 'darwin') {
      return {
        status: 'unsupported',
        destination: null,
        composerText: '',
        verified: false,
        reason: 'Typing into other apps is available on macOS only. Use Copy or Interactive GPT on this PC.'
      }
    }
    const r = (request ?? {}) as {
      text?: unknown
      dest?: unknown
      mode?: unknown
      allowUnexposedChatGpt?: unknown
    }
    if (typeof r.text !== 'string' || !r.text.trim() || r.text.length > 8000 || !r.dest || typeof r.dest !== 'object') {
      return { status: 'failed', destination: null, composerText: '', verified: false, reason: 'Not allowed.' }
    }
    return insertIntoDestination({
      text: r.text,
      dest: r.dest as import('../shared/destination').TypeDestination,
      mode: r.mode === 'append' || r.mode === 'replace' || r.mode === 'ask' ? r.mode : 'ask',
      excludePid: process.pid,
      allowUnexposedChatGpt: r.allowUnexposedChatGpt === true
    })
  })
  ipcMain.handle(IPC.typeDestOmnibox, (event, text: unknown) => {
    if (!trusted(event) || typeof text !== 'string' || !text.trim() || text.length > 2000) {
      return { status: 'failed', destination: null, composerText: '', verified: false, reason: 'Not allowed.' }
    }
    if (process.platform !== 'darwin') {
      return {
        status: 'unsupported',
        destination: null,
        composerText: '',
        verified: false,
        reason: 'Browser address-bar typing is available on macOS only.'
      }
    }
    return setOmniboxText(text, process.pid)
  })
  ipcMain.handle(IPC.typeDestOpenNotes, (event) => {
    if (!trusted(event)) return { ok: false, reason: 'Not allowed.', dest: null }
    if (process.platform !== 'darwin') {
      return { ok: false, reason: 'Notes typing is available on macOS only.', dest: null }
    }
    return openNotes()
  })
  ipcMain.on(IPC.typeDestCancel, (event) => {
    if (!trusted(event)) return
    cancelTypeDest()
  })

  loadGptModeFromSettings()
  onGptModeState((next) => {
    postToPet(IPC.gptModeState, next)
    postToGptLive(IPC.gptModeState, next)
    refreshTrayMenu()
  })
  // Live viewer is a separate BrowserWindow: allow only the narrow live-view IPC set
  // via trustedGptLive(). Do not widen trusted() globally (send/enable/exit stay pet-only).
  ipcMain.handle(IPC.gptModeGet, (event) => (trustedGptLive(event) ? getGptModeState() : null))
  ipcMain.handle(IPC.gptModeEnable, (event) => (trusted(event) ? enableGptMode(process.pid) : null))
  ipcMain.handle(IPC.gptModePause, (event) => (trusted(event) ? pauseGptMode() : null))
  ipcMain.handle(IPC.gptModeResume, (event) => (trusted(event) ? resumeGptMode() : null))
  ipcMain.handle(IPC.gptModeExit, (event) => {
    if (!trusted(event)) return null
    closeGptLiveWindow()
    return exitGptMode()
  })
  ipcMain.handle(IPC.gptModeNewChat, (event) =>
    trusted(event) ? gptModeNewChat(process.pid) : { ok: false, verified: false, reason: 'Not allowed.' }
  )
  ipcMain.handle(IPC.gptModeSend, (event, request: unknown) => {
    if (!trusted(event) || !request || typeof request !== 'object') {
      return { requestId: '', status: 'failed', detail: 'Not allowed.', submittedVerified: false, inserted: false }
    }
    const r = request as { requestId?: unknown; text?: unknown; mode?: unknown }
    if (typeof r.requestId !== 'string' || typeof r.text !== 'string' || !r.text.trim() || r.text.length > 8000) {
      return { requestId: '', status: 'failed', detail: 'Not allowed.', submittedVerified: false, inserted: false }
    }
    const mode = r.mode === 'replace' || r.mode === 'append' || r.mode === 'ask' ? r.mode : 'ask'
    return sendGptModeMessage({ requestId: r.requestId.slice(0, 80), text: r.text, mode }, process.pid)
  })
  ipcMain.on(IPC.gptModeCancel, (event) => {
    if (trusted(event)) cancelGptDelivery()
  })
  ipcMain.handle(IPC.gptModeFocus, (event) =>
    trustedGptLive(event)
      ? focusChatGptWindow()
      : {
          ok: false,
          reason: 'Open ChatGPT from the MIKO panel or the live viewer window only.'
        }
  )

  // —— ChatGPT Web workspace (isolated guest; chrome IPC only) ——
  ipcMain.handle(IPC.chatgptWebOpen, (event) => {
    if (!trusted(event) && !trustedChatGptWeb(event)) return { ok: false, reason: 'Not allowed.' }
    // Workspace beside the pet: tuck chat panel, pause Lens unless both are requested later.
    setPanelOpen(false)
    postToPet(IPC.uiHint, { tuckPanel: true })
    closeGptLiveWindow()
    setGptLiveView(false, 'Lens tucked while Interactive GPT is open.')
    openChatGptWebWindow({ focus: true })
    raisePetWindow()
    return {
      ok: true,
      reason: 'Opened Interactive GPT beside MIKO (ChatGPT Web — not GPT Mode, not Lens).'
    }
  })
  ipcMain.handle(IPC.chatgptWebStatus, (event) =>
    trusted(event) || trustedChatGptWeb(event)
      ? chatgptWebStatus()
      : {
          open: false,
          collapsed: false,
          pinned: true,
          visible: false,
          url: '',
          title: '',
          canGoBack: false,
          canGoForward: false,
          downloadNote: '',
          dropNote: '',
          dictateArmed: false,
          partition: '',
          label: 'MIKO · ChatGPT'
        }
  )
  ipcMain.handle(IPC.chatgptWebClose, (event) => {
    if (!trusted(event) && !trustedChatGptWeb(event)) return false
    closeChatGptWebWindow()
    return true
  })
  ipcMain.handle(IPC.chatgptWebCollapse, (event) =>
    trusted(event) || trustedChatGptWeb(event) ? collapseChatGptWebWindow() : false
  )
  ipcMain.handle(IPC.chatgptWebExpand, (event) =>
    trusted(event) || trustedChatGptWeb(event) ? expandChatGptWebWindow(true) : false
  )
  ipcMain.handle(IPC.chatgptWebPin, (event, pinned: unknown) => {
    if (!trustedChatGptWeb(event) && !trusted(event)) return false
    if (typeof pinned !== 'boolean') return false
    return setChatGptWebPinned(pinned)
  })
  ipcMain.handle(IPC.chatgptWebDragActive, (event, active: unknown) => {
    if (!trustedChatGptWeb(event)) return false
    setChatGptWebChromeDragActive(active === true)
    return true
  })
  ipcMain.handle(IPC.chatgptWebExpandFromDrag, (event) =>
    trustedChatGptWeb(event) ? expandChatGptWebFromDrag() : false
  )
  ipcMain.handle(IPC.chatgptWebDictateArm, (event, armed: unknown) => {
    if (!trusted(event) && !trustedChatGptWeb(event)) return false
    return setChatGptWebDictateArmed(armed === true)
  })
  ipcMain.handle(IPC.chatgptWebBack, (event) =>
    trustedChatGptWeb(event) ? chatgptWebBack() : false
  )
  ipcMain.handle(IPC.chatgptWebForward, (event) =>
    trustedChatGptWeb(event) ? chatgptWebForward() : false
  )
  ipcMain.handle(IPC.chatgptWebReload, (event) =>
    trustedChatGptWeb(event) ? chatgptWebReload() : false
  )
  ipcMain.handle(IPC.chatgptWebRetry, (event) => (trustedChatGptWeb(event) ? retryChatGptWebLoad() : false))
  ipcMain.handle(IPC.chatgptWebOpenBrowser, (event) =>
    trustedChatGptWeb(event) ? openChatGptWebInBrowser() : false
  )
  ipcMain.handle(IPC.chatgptWebOpenBlocked, (event) =>
    trustedChatGptWeb(event) ? openChatGptWebBlockedLink() : false
  )
  ipcMain.handle(IPC.chatgptWebDismissBlocked, (event) =>
    trustedChatGptWeb(event) ? dismissChatGptWebBlockedLink() : false
  )
  ipcMain.handle(IPC.chatgptWebChromeHeight, (event, height: unknown) => {
    if (!trustedChatGptWeb(event) || typeof height !== 'number') return false
    setChatGptWebChromeHeight(height)
    return true
  })
  ipcMain.handle(IPC.chatgptWebInsertTranscript, (event, text: unknown) => {
    if (!trusted(event) && !trustedChatGptWeb(event)) return { ok: false, reason: 'Not allowed.' }
    if (typeof text !== 'string') return { ok: false, reason: 'Invalid transcript.' }
    return chatgptWebInsertTranscript(text)
  })
  ipcMain.handle(IPC.chatgptWebSubmitDraft, async (event, opts: unknown) => {
    if (!trusted(event) && !trustedChatGptWeb(event)) {
      return {
        ok: false,
        status: 'failed' as const,
        reason: 'Not allowed.',
        composerText: ''
      }
    }
    const raw = opts && typeof opts === 'object' ? (opts as { expectedText?: unknown; generation?: unknown }) : {}
    return chatgptWebSubmitCurrentDraft({
      expectedText: typeof raw.expectedText === 'string' ? raw.expectedText : undefined,
      generation: typeof raw.generation === 'number' ? raw.generation : chatgptWebSubmitGeneration()
    })
  })
  ipcMain.handle(IPC.chatgptWebCancelSubmit, (event) => {
    if (!trusted(event) && !trustedChatGptWeb(event)) return 0
    cancelChatGptWebSubmit()
    return chatgptWebSubmitGeneration()
  })
  ipcMain.handle(IPC.chatgptWebPasteClipboard, (event) => {
    if (!trusted(event) && !trustedChatGptWeb(event)) return { ok: false, reason: 'Not allowed.' }
    return chatgptWebPasteClipboard()
  })
  ipcMain.handle(IPC.chatgptWebDownload, (event) =>
    trusted(event) || trustedChatGptWeb(event) ? getChatGptWebDownload() : null
  )
  onChatGptWebDownload((info) => {
    for (const w of BrowserWindow.getAllWindows()) {
      if (isChatGptWebSender(w.webContents.id) && !w.webContents.isDestroyed()) {
        w.webContents.send(IPC.chatgptWebDownloadEvent, info)
      }
    }
  })
  ipcMain.handle(IPC.gptModeLiveView, (event, enabled: unknown) => {
    if (!trustedGptLive(event)) return null
    if (enabled === true) {
      const next = setGptLiveView(true)
      // Panel opens the window; the viewer already is the window.
      if (trusted(event)) openGptLiveWindow()
      return next
    }
    closeGptLiveWindow()
    return setGptLiveView(false)
  })
  ipcMain.handle(IPC.gptModeLiveSnapshot, (event) =>
    trustedGptLive(event)
      ? gptLiveViewSnapshot()
      : {
          ok: false,
          reason:
            'Live frames are only available from MIKO’s live viewer or main panel — this window isn’t authorized.',
          dataUrl: '',
          sourceName: '',
          sourceId: '',
          owner: '',
          permission: 'unknown',
          kind: 'capture-failed',
          captureWidth: 0,
          captureHeight: 0
        }
  )
  ipcMain.handle(IPC.gptModeListSources, (event) =>
    trustedGptLive(event)
      ? listGptCaptureSources()
      : {
          ok: false,
          reason:
            'Choose window is blocked for this window. Use MIKO’s live viewer (or the main panel’s Choose window).',
          permission: 'unknown',
          sources: []
        }
  )
  ipcMain.handle(IPC.gptModeSetSource, (event, sourceId: unknown, name: unknown, owner: unknown) => {
    if (!trustedGptLive(event) || typeof sourceId !== 'string' || !sourceId.trim()) return getGptModeState()
    cancelLensInput('source-changed')
    const next = setGptCaptureSource(
      sourceId,
      typeof name === 'string' ? name : '',
      typeof owner === 'string' ? owner : ''
    )
    if (trusted(event)) openGptLiveWindow()
    return next
  })
  ipcMain.handle(IPC.gptModeLiveSizePreset, (event, preset: unknown) => {
    if (!trustedGptLive(event)) return false
    if (preset !== 'compact' && preset !== 'reading' && preset !== 'expand') return false
    applyGptLiveSizePreset(preset)
    return true
  })
  ipcMain.handle(IPC.gptModeLiveCollapse, (event, next: unknown) => {
    if (!trustedGptLive(event)) return false
    return setGptLiveCollapsed(next === true)
  })
  ipcMain.on(IPC.gptModeOpenPicker, (event) => {
    // Panel opens the viewer + picker; the viewer opens the picker locally (listSources).
    if (!trusted(event)) return
    setGptLiveView(true)
    openGptLiveWindow()
    postToGptLive(IPC.gptModeOpenPicker)
  })

  // —— MIKO Lens control + files (viewer or pet; narrow trustedGptLive) ——
  ipcMain.handle(IPC.lensWindowBounds, (event, sourceId: unknown) =>
    trustedGptLive(event)
      ? lensWindowBounds(typeof sourceId === 'string' ? sourceId.slice(0, 120) : undefined)
      : null
  )
  ipcMain.handle(IPC.lensPointer, (event, request: unknown) => {
    if (!trustedGptLive(event) || !request || typeof request !== 'object') {
      return { ok: false, reason: 'Not allowed.', activated: false, pid: 0, windowId: 0 }
    }
    const r = request as {
      action?: unknown
      x?: unknown
      y?: unknown
      dx?: unknown
      dy?: unknown
      expectSourceId?: unknown
      activate?: unknown
      intent?: unknown
    }
    if (typeof r.expectSourceId !== 'string' || typeof r.x !== 'number' || typeof r.y !== 'number') {
      return { ok: false, reason: 'Invalid pointer request.', activated: false, pid: 0, windowId: 0 }
    }
    const action = r.action === 'dblclick' || r.action === 'scroll' ? r.action : 'click'
    const intent = r.intent === 'control-original' || r.intent === 'background' ? r.intent : undefined
    return lensPointer({
      action,
      x: r.x,
      y: r.y,
      dx: typeof r.dx === 'number' ? r.dx : 0,
      dy: typeof r.dy === 'number' ? r.dy : 0,
      expectSourceId: r.expectSourceId.slice(0, 120),
      activate: r.activate === true,
      intent
    })
  })
  ipcMain.handle(IPC.lensType, (event, request: unknown) => {
    if (!trustedGptLive(event) || !request || typeof request !== 'object') {
      return { ok: false, reason: 'Not allowed.', activated: false, pid: 0 }
    }
    const r = request as { text?: unknown; expectSourceId?: unknown; activate?: unknown; intent?: unknown }
    if (typeof r.expectSourceId !== 'string' || typeof r.text !== 'string') {
      return { ok: false, reason: 'Invalid type request.', activated: false, pid: 0 }
    }
    const intent = r.intent === 'control-original' || r.intent === 'background' ? r.intent : undefined
    return lensType({
      text: r.text.slice(0, 4000),
      expectSourceId: r.expectSourceId.slice(0, 120),
      activate: r.activate === true,
      intent
    })
  })
  ipcMain.handle(IPC.lensFinderSelection, (event, sourceId: unknown) =>
    trustedGptLive(event)
      ? lensFinderSelection(typeof sourceId === 'string' ? sourceId.slice(0, 120) : undefined)
      : { ok: false, reason: 'Not allowed.', files: [] }
  )
  ipcMain.handle(IPC.lensPickFiles, (event) => {
    if (!trustedGptLive(event)) return { ok: false, reason: 'Not allowed.', files: [] }
    const parent = BrowserWindow.fromWebContents(event.sender)
    return lensPickFiles(parent)
  })
  ipcMain.handle(IPC.lensProvenFiles, (event) => (trustedGptLive(event) ? lensProvenFiles() : []))
  ipcMain.handle(IPC.lensCopyFile, (event, path: unknown) =>
    trustedGptLive(event) && typeof path === 'string'
      ? lensCopyFile(path.slice(0, 1024))
      : { ok: false, reason: 'Not allowed.' }
  )
  ipcMain.handle(IPC.lensRevealFile, (event, path: unknown) =>
    trustedGptLive(event) && typeof path === 'string' ? lensRevealFile(path.slice(0, 1024)) : false
  )
  ipcMain.on(IPC.lensStartDrag, (event, path: unknown) => {
    if (!trustedGptLive(event) || typeof path !== 'string') return
    lensStartDrag(event, path.slice(0, 1024))
  })
  ipcMain.handle(IPC.lensAttachChatGpt, (event, path: unknown, sourceId: unknown) =>
    trustedGptLive(event) && typeof path === 'string'
      ? lensAttachToChatGpt(path.slice(0, 1024), typeof sourceId === 'string' ? sourceId.slice(0, 120) : undefined)
      : {
          ok: false,
          status: 'failed',
          reason: 'Not allowed.',
          path: '',
          filename: '',
          verified: false,
          composerText: ''
        }
  )
  ipcMain.handle(IPC.lensRegisterFile, (event, path: unknown) =>
    trustedGptLive(event) && typeof path === 'string' ? registerLensFileFromProven(path.slice(0, 1024)) : null
  )
  ipcMain.on(IPC.lensCancelInput, (event) => {
    if (trustedGptLive(event)) cancelLensInput('viewer')
  })
  ipcMain.handle(IPC.lensOpenOriginal, (event, sourceId: unknown) =>
    trustedGptLive(event)
      ? lensOpenOriginal(typeof sourceId === 'string' ? sourceId.slice(0, 120) : undefined)
      : { ok: false, reason: 'Not allowed.', pid: 0 }
  )
  ipcMain.handle(IPC.spotifyMedia, (event, action: unknown) => {
    if (!trustedGptLive(event) || typeof action !== 'string') {
      return {
        ok: false,
        reason: 'Not allowed.',
        running: false,
        state: 'unknown',
        track: '',
        artist: '',
        volume: null,
        method: 'none'
      }
    }
    const allowed = ['play-pause', 'next', 'previous', 'volume-up', 'volume-down', 'status']
    if (!allowed.includes(action)) {
      return {
        ok: false,
        reason: 'Unknown Spotify action.',
        running: false,
        state: 'unknown',
        track: '',
        artist: '',
        volume: null,
        method: 'none'
      }
    }
    return spotifyMedia(action as import('./spotify').SpotifyAction)
  })

  ipcMain.handle(IPC.chatsList, (event) => (trusted(event) ? savedChats() : []))
  ipcMain.handle(IPC.chatsAdd, (event, payload: unknown) => {
    if (!trusted(event)) return refused()
    const { name, url } = (payload ?? {}) as { name?: unknown; url?: unknown }
    if (typeof name !== 'string' || typeof url !== 'string' || name.length > 200 || url.length > 2000) return refused()
    return commit(addChat(savedChats(), name, url))
  })
  ipcMain.handle(IPC.chatsRename, (event, payload: unknown) => {
    if (!trusted(event)) return refused()
    const { from, to } = (payload ?? {}) as { from?: unknown; to?: unknown }
    if (typeof from !== 'string' || typeof to !== 'string' || from.length > 200 || to.length > 200) return refused()
    return commit(renameChat(savedChats(), from, to))
  })
  ipcMain.handle(IPC.chatsRemove, (event, name: unknown) => {
    if (!trusted(event) || typeof name !== 'string' || name.length > 200) return refused()
    return commit(removeChat(savedChats(), name))
  })
  ipcMain.handle(IPC.chatsOpen, (event, name: unknown) => {
    if (!trusted(event) || typeof name !== 'string') return { ok: false, target: 'none', appName: '' }
    const chat = savedChats().find((item) => item.name.toLowerCase() === name.toLowerCase())
    if (!chat) return { ok: false, target: 'none', appName: '' }
    return openChatUrl(chat.url)
  })

  ipcMain.handle(IPC.whatsappOpen, (event, query: unknown, pickId: unknown, taskId: unknown) => {
    if (!trusted(event) || typeof query !== 'string' || query.length > 80) {
      return { status: 'failed', query: '', names: [], matches: [], header: '', reason: 'That name isn’t one I can search for.', composerReady: false }
    }
    return openWhatsAppContact({
      query,
      pickId: typeof pickId === 'string' && pickId.length > 0 && pickId.length <= 400 ? pickId : undefined,
      taskId: typeof taskId === 'string' && taskId.length > 0 && taskId.length <= 80 ? taskId : undefined
    })
  })
  ipcMain.on(IPC.whatsappCancel, (event) => {
    if (!trusted(event)) return
    cancelAttachmentWork()
    cancelWhatsApp()
  })
  ipcMain.handle(IPC.whatsappAliases, (event) => (trusted(event) ? listWhatsAppAliases() : []))
  ipcMain.handle(IPC.whatsappRemember, (event, alias: unknown, name: unknown) => {
    if (!trusted(event) || typeof alias !== 'string' || typeof name !== 'string') return { ok: false, reason: 'That name can’t be saved.', list: [] }
    return saveWhatsAppAlias(alias, name)
  })
  ipcMain.handle(IPC.whatsappForget, (event, alias: unknown) => {
    if (!trusted(event) || typeof alias !== 'string') return { ok: false, reason: 'Which WhatsApp name should I forget?', list: [] }
    return removeWhatsAppAlias(alias)
  })
  ipcMain.handle(IPC.whatsappPeek, (event, messages: unknown, latest: unknown) => {
    if (!trusted(event)) {
      return { status: 'failed', header: '', messages: [], composerText: '', composerReady: false, reason: 'Untrusted.', contextNotice: false }
    }
    return peekWhatsApp({ messages: messages === true, latest: latest === true })
  })
  ipcMain.handle(IPC.whatsappInsert, (event, request: unknown) => {
    if (!trusted(event) || !request || typeof request !== 'object') {
      return { status: 'failed', header: '', composerText: '', verified: false, reason: 'That draft isn’t one I can insert.' }
    }
    const row = request as { expectHeader?: unknown; text?: unknown; mode?: unknown }
    const mode = row.mode === 'append' || row.mode === 'ask' || row.mode === 'replace' ? row.mode : 'replace'
    if (typeof row.expectHeader !== 'string' || typeof row.text !== 'string') {
      return { status: 'failed', header: '', composerText: '', verified: false, reason: 'That draft isn’t one I can insert.' }
    }
    return insertWhatsAppDraft({ expectHeader: row.expectHeader.slice(0, 80), text: row.text.slice(0, 4000), mode })
  })
  ipcMain.handle(IPC.whatsappContextNotice, (event) => (trusted(event) ? markWhatsAppContextNoticeSeen() : false))

  ipcMain.handle(IPC.whatsappAttachmentsList, (event) => {
    if (!trusted(event)) {
      return { status: 'failed', header: '', reason: 'Untrusted.', attachments: [] }
    }
    return listWhatsAppAttachments()
  })
  ipcMain.handle(IPC.whatsappAttachmentSave, (event, request: unknown) => {
    if (!trusted(event) || !request || typeof request !== 'object') {
      return {
        status: 'failed',
        header: '',
        reason: 'That attachment isn’t one I can save.',
        path: '',
        filename: '',
        bytes: 0,
        verified: false
      }
    }
    const row = request as {
      expectHeader?: unknown
      filename?: unknown
      id?: unknown
      acceptCandidatePath?: unknown
    }
    if (typeof row.expectHeader !== 'string' || typeof row.filename !== 'string') {
      return {
        status: 'failed',
        header: '',
        reason: 'That attachment isn’t one I can save.',
        path: '',
        filename: '',
        bytes: 0,
        verified: false,
        provenance: 'none'
      }
    }
    return saveWhatsAppAttachment({
      expectHeader: row.expectHeader.slice(0, 80),
      filename: row.filename.slice(0, 180),
      id: typeof row.id === 'string' ? row.id.slice(0, 64) : undefined,
      acceptCandidatePath:
        typeof row.acceptCandidatePath === 'string' ? row.acceptCandidatePath.slice(0, 1024) : undefined
    })
  })
  ipcMain.handle(IPC.clipboardFile, (event, path: unknown) => {
    if (!trusted(event) || typeof path !== 'string' || path.length === 0 || path.length > 1024) {
      return { status: 'failed', reason: 'That file isn’t one I can copy.', path: '', filename: '', bytes: 0, verified: false }
    }
    return copyFileToClipboard(path)
  })
  ipcMain.handle(IPC.pasteFileWhatsApp, (event, request: unknown) => {
    if (!trusted(event) || !request || typeof request !== 'object') {
      return {
        status: 'failed',
        header: '',
        reason: 'That file isn’t one I can attach.',
        path: '',
        filename: '',
        verified: false,
        composerText: ''
      }
    }
    const row = request as { expectHeader?: unknown; path?: unknown }
    if (typeof row.expectHeader !== 'string' || typeof row.path !== 'string') {
      return {
        status: 'failed',
        header: '',
        reason: 'That file isn’t one I can attach.',
        path: '',
        filename: '',
        verified: false,
        composerText: ''
      }
    }
    return pasteFileIntoWhatsApp({ expectHeader: row.expectHeader.slice(0, 80), path: row.path.slice(0, 1024) })
  })
  ipcMain.handle(IPC.revealFile, (event, path: unknown) => {
    if (!trusted(event) || typeof path !== 'string') return false
    return revealInFinder(path.slice(0, 1024))
  })
  ipcMain.handle(IPC.openLocalFile, (event, path: unknown) => {
    if (!trusted(event) || typeof path !== 'string') return 'That file isn’t one I can open.'
    return openLocalFile(path.slice(0, 1024))
  })

  ipcMain.handle(IPC.copyText, async (event, payload: unknown): Promise<boolean> => {
    if (!trusted(event) || typeof payload !== 'string') return false
    if (payload.length === 0 || payload.length > MAX_COPY) return false
    try {
      await clipboard.writeText(payload)
      return true
    } catch {
      return false
    }
  })

  ipcMain.handle(IPC.readClipboard, async (event): Promise<string> => {
    if (!trusted(event)) return ''
    try {
      return (await clipboard.readText()).slice(0, MAX_PASTE)
    } catch {
      return ''
    }
  })

  ipcMain.handle(IPC.closeApp, async (event, payload: unknown) => {
    if (!trusted(event)) return { status: 'failed', name: 'That app' }
    const request = parseClose(payload)
    if (!request) return { status: 'failed', name: 'That app' }
    const result = await requestClose(request.id, request.force, request.confirm)
    if (result.status === 'requested') {
      watchClose(request.id, (status) => {
        postToPet(IPC.closeUpdate, { id: request.id, name: result.name, status })
      })
    }
    return result
  })

  ipcMain.on(IPC.openSwitcher, (event) => {
    if (!trusted(event)) return
    // Pet single click: open, or close when it's already open (never reopen on the closing click).
    toggleSwitcherFromPet()
  })

  registerSwitcherIpc()
  registerProjectorIpc()
  registerKnowledgeIpc()
  ipcMain.on(IPC.projectorOpen, (event) => {
    if (trusted(event)) openProjector()
  })
  registerMailIpc()

  ipcMain.handle(IPC.bridgeStatus, (event) => (trusted(event) ? bridgeStatus() : null))
  ipcMain.handle(IPC.selectionClipboard, (event) => (trusted(event) ? clipboardSelection() : null))
  ipcMain.handle(IPC.selectionReplace, (event, captureId: unknown, text: unknown) => {
    if (!trusted(event) || typeof captureId !== 'string' || typeof text !== 'string' || !text || text.length > 20000) {
      return { ok: false, reason: 'Not allowed.', verified: false }
    }
    return replaceSelection(captureId, text)
  })
  ipcMain.handle(IPC.pasteArm, (event, text: unknown, target: unknown) => {
    if (!trusted(event) || typeof text !== 'string' || text.length > 20000) return { ok: false, reason: 'Not allowed.' }
    return armPaste(text, target === 'chatgpt' ? 'com.openai.codex,com.openai.chat' : '')
  })
  ipcMain.on(IPC.pasteCancel, (event) => {
    if (trusted(event)) disarmPaste('cancelled', 'Paste cancelled.')
  })
  ipcMain.handle(IPC.bridgeSend, (event, requestId: unknown, prompt: unknown, opts: unknown) => {
    if (!trusted(event) || typeof requestId !== 'string' || !/^[a-z0-9-]{4,40}$/i.test(requestId)) {
      return { ok: false, reason: 'Not allowed.' }
    }
    if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 16000) return { ok: false, reason: 'That request is empty or too long.' }
    const o = (opts ?? {}) as { fresh?: unknown; keep?: unknown }
    return sendBridge(requestId, prompt.trim(), { fresh: o.fresh === true, keep: o.keep === true })
  })
  ipcMain.handle(IPC.bridgeNew, (event) => {
    if (trusted(event)) newConversation()
  })
  ipcMain.handle(IPC.bridgeSetEnabled, (event, enabled: unknown) => {
    if (!trusted(event) || typeof enabled !== 'boolean') return null
    setAssistantEnabled(enabled)
    if (!enabled) stopAllBridges()
    refreshTrayMenu()
    return bridgeStatus()
  })
  ipcMain.handle(IPC.setupGet, (event) => (trusted(event) ? setupState() : defaultSetupState()))
  ipcMain.handle(IPC.setupUpdate, (event, value: unknown) => {
    const current = setupState()
    if (!trusted(event)) return current
    const update = parseSetupUpdate(value)
    if (!update) return current
    const next = applySetupUpdate(current, update)
    return setSetupState(next) ? next : current
  })
  ipcMain.handle(IPC.voicePermissionGet, (event) => {
    if (!trusted(event)) {
      return {
        supported: false,
        microphone: 'unknown',
        speechRecognition: 'unknown',
        canRequest: false,
        detail: 'Not allowed.'
      }
    }
    return voicePermissionStatus(false)
  })
  ipcMain.handle(IPC.voicePermissionRequest, (event) => {
    if (!trusted(event)) {
      return {
        supported: false,
        microphone: 'unknown',
        speechRecognition: 'unknown',
        canRequest: false,
        detail: 'Not allowed.'
      }
    }
    return voicePermissionStatus(true)
  })
  ipcMain.handle(IPC.voiceSettingsOpen, (event, help: unknown) =>
    trusted(event)
      ? openVoicePrivacySettings(
          help === 'microphone-privacy' || help === 'sound-input' || help === 'speech-language' ? help : undefined
        )
      : false
  )
  ipcMain.handle(IPC.voiceInputDevices, (event) =>
    trusted(event) ? listInputDevices() : { devices: [], defaultDevice: '', recognizers: [], detail: 'Not allowed.' }
  )
  ipcMain.handle(IPC.systemOptionsGet, (event) =>
    trusted(event)
      ? systemOptions()
      : { launchAtLogin: false, desktopShortcut: false, canLaunchAtLogin: false, canDesktopShortcut: false, detail: 'Not allowed.' }
  )
  ipcMain.handle(IPC.systemOptionsSet, (event, raw: unknown) => {
    if (!trusted(event)) {
      return { launchAtLogin: false, desktopShortcut: false, canLaunchAtLogin: false, canDesktopShortcut: false, detail: '', reason: 'Not allowed.' }
    }
    const next = raw as { launchAtLogin?: unknown; desktopShortcut?: unknown } | null
    return setSystemOptions({
      ...(typeof next?.launchAtLogin === 'boolean' ? { launchAtLogin: next.launchAtLogin } : {}),
      ...(typeof next?.desktopShortcut === 'boolean' ? { desktopShortcut: next.desktopShortcut } : {})
    })
  })
  ipcMain.handle(IPC.openLogsFolder, (event) => (trusted(event) ? openLogsFolder() : false))
  ipcMain.on(IPC.voiceMicTestCancel, (event) => {
    if (trusted(event)) cancelMicTest()
  })
  ipcMain.handle(IPC.voiceMicTest, (event) =>
    trusted(event)
      ? runMicTest()
      : { outcome: 'unavailable' as const, transcript: '', detail: 'Not allowed.' }
  )
  ipcMain.handle(IPC.summonShortcutGet, (event) =>
    trusted(event)
      ? summonShortcut.status()
      : { configured: '', active: null, ok: false, detail: 'Not allowed.' }
  )
  ipcMain.handle(IPC.summonShortcutSet, (event, value: unknown) => {
    if (!trusted(event) || typeof value !== 'string') {
      return { configured: '', active: null, ok: false, detail: 'Not allowed.' }
    }
    const status = summonShortcut.setAccelerator(value)
    refreshTrayMenu()
    return status
  })
  ipcMain.handle(IPC.prefsGet, (event) => (trusted(event) ? mikoPreferences() : ''))
  ipcMain.handle(IPC.prefsSet, (event, text: unknown) => (trusted(event) && typeof text === 'string' ? setMikoPreferences(text) : false))

  ensureFeedbackStore()
  ipcMain.handle(IPC.appInfo, (event) => {
    if (!trusted(event)) {
      return {
        name: APP_NAME,
        version: APP_VERSION,
        buildId: 'unknown',
        channel: APP_CHANNEL,
        packaged: false,
        platform: process.platform,
        arch: process.arch
      }
    }
    return {
      name: APP_NAME,
      version: app.getVersion?.() || APP_VERSION,
      buildId: buildId(process.env['MIKO_BUILD_ID']),
      channel: APP_CHANNEL,
      packaged: app.isPackaged,
      platform: process.platform,
      arch: process.arch
    }
  })
  ipcMain.handle(IPC.feedbackConfigGet, (event) => {
    if (!trusted(event)) return { endpoint: '', inviteCode: '', hasEndpoint: false }
    const c = getFeedbackConfig()
    return { endpoint: c.endpoint, inviteCode: c.inviteCode, hasEndpoint: Boolean(c.endpoint) }
  })
  ipcMain.handle(IPC.feedbackConfigSet, (event, partial: unknown) => {
    if (!trusted(event) || !partial || typeof partial !== 'object') {
      return { endpoint: '', inviteCode: '', hasEndpoint: false }
    }
    const p = partial as { endpoint?: unknown; inviteCode?: unknown }
    const c = setFeedbackConfig({
      endpoint: typeof p.endpoint === 'string' ? p.endpoint : undefined,
      inviteCode: typeof p.inviteCode === 'string' ? p.inviteCode : undefined
    })
    return { endpoint: c.endpoint, inviteCode: c.inviteCode, hasEndpoint: Boolean(c.endpoint) }
  })
  ipcMain.handle(IPC.feedbackPreview, (event, draft: unknown, opts: unknown) => {
    if (!trusted(event) || !draft || typeof draft !== 'object') return { ok: false as const, reason: 'Not allowed.' }
    const o = (opts ?? {}) as { actionType?: unknown; errorCode?: unknown }
    return previewFeedback(draft as FeedbackDraft, {
      actionType: typeof o.actionType === 'string' ? o.actionType : null,
      errorCode: typeof o.errorCode === 'string' ? o.errorCode : null
    })
  })
  ipcMain.handle(IPC.feedbackSubmit, async (event, draft: unknown, opts: unknown) => {
    if (!trusted(event) || !draft || typeof draft !== 'object') {
      return { ok: false, reason: 'Not allowed.', delivered: false, item: null }
    }
    const o = (opts ?? {}) as { actionType?: unknown; errorCode?: unknown; clientKey?: unknown }
    return submitFeedback(draft as FeedbackDraft, {
      actionType: typeof o.actionType === 'string' ? o.actionType : null,
      errorCode: typeof o.errorCode === 'string' ? o.errorCode : null,
      clientKey: typeof o.clientKey === 'string' ? o.clientKey : undefined
    })
  })
  ipcMain.handle(IPC.feedbackList, (event) => (trusted(event) ? listFeedbackQueue() : []))
  ipcMain.handle(IPC.feedbackRetry, async (event, id: unknown) => {
    if (!trusted(event) || typeof id !== 'string') return { ok: false, reason: 'Not allowed.', item: null }
    return retryFeedback(id)
  })
  ipcMain.handle(IPC.feedbackDelete, (event, id: unknown) => {
    if (!trusted(event) || typeof id !== 'string') return []
    return deleteFeedbackItem(id)
  })
  ipcMain.handle(IPC.feedbackExport, async (event, id: unknown) => {
    if (!trusted(event) || typeof id !== 'string') return { ok: false, reason: 'Not allowed.', path: '' }
    return exportFeedback(id)
  })
  ipcMain.handle(IPC.feedbackExportDraft, async (event, draft: unknown, opts: unknown) => {
    if (!trusted(event) || !draft || typeof draft !== 'object') {
      return { ok: false, reason: 'Not allowed.', path: '', item: null }
    }
    const o = (opts ?? {}) as { actionType?: unknown; errorCode?: unknown }
    return exportFeedbackDraft(draft as FeedbackDraft, {
      actionType: typeof o.actionType === 'string' ? o.actionType : null,
      errorCode: typeof o.errorCode === 'string' ? o.errorCode : null
    })
  })
  ipcMain.handle(IPC.updateGet, (event) => (trusted(event) ? getUpdateStatus() : getUpdateStatus()))
  ipcMain.handle(IPC.updateCheck, async (event) => {
    if (!trusted(event)) return getUpdateStatus()
    return checkForUpdates(true)
  })
  ipcMain.handle(IPC.updateRestart, async (event, draftText: unknown) => {
    if (!trusted(event)) return { ok: false, reason: 'Not allowed.' }
    return restartToUpdate(typeof draftText === 'string' ? draftText.slice(0, 8000) : '')
  })
  ipcMain.handle(IPC.updateLater, (event) => {
    if (!trusted(event)) return getUpdateStatus()
    return silenceCurrentUpdate()
  })
  ipcMain.handle(IPC.updateOpenDownload, async (event, draftText: unknown) => {
    if (!trusted(event)) return { ok: false, reason: 'Not allowed.' }
    return openManualDownload(typeof draftText === 'string' ? draftText.slice(0, 8000) : '')
  })
  ipcMain.handle(IPC.updateFeedSet, (event, url: unknown) => {
    if (!trusted(event) || typeof url !== 'string') return { ok: false, reason: 'Not allowed.' }
    return setUpdateFeedOverride(url)
  })
  ipcMain.handle(IPC.updateManualReleaseSet, (event, partial: unknown) => {
    if (!trusted(event) || !partial || typeof partial !== 'object') {
      return { ok: false, reason: 'Not allowed.', config: { downloadUrl: '', latestJsonUrl: '' } }
    }
    const p = partial as { downloadUrl?: unknown; latestJsonUrl?: unknown }
    return setManualReleaseConfig({
      downloadUrl: typeof p.downloadUrl === 'string' ? p.downloadUrl : undefined,
      latestJsonUrl: typeof p.latestJsonUrl === 'string' ? p.latestJsonUrl : undefined
    })
  })
  ipcMain.handle(IPC.updateStartup, (event) => {
    if (!trusted(event)) return { notice: '', draft: '' }
    return { notice: takeUpdateNotice(), draft: takeRecoveredDraft() }
  })
  ipcMain.on(IPC.bridgeCancel, (event, requestId: unknown) => {
    if (trusted(event) && typeof requestId === 'string') cancelBridge(requestId)
  })

  ipcMain.handle(IPC.getVoiceAuto, (event) => (trusted(event) ? voiceAutoExecute() : true))

  ipcMain.on(IPC.quitApp, (event) => {
    if (!trusted(event)) return
    app.quit()
  })

  ipcMain.handle(IPC.listenStart, (event) => {
    if (!trusted(event)) return Promise.resolve({ ok: false, reason: 'Speech recognition is not available.' })
    return startListening(false, 'panel')
  })

  ipcMain.on(IPC.listenStop, (event) => {
    if (!trusted(event)) return
    stopListening()
  })

  ipcMain.on(IPC.listenCancel, (event) => {
    if (!trusted(event)) return
    cancelListening()
  })

  ipcMain.handle(IPC.setFollow, (event, enabled: unknown) => {
    if (!trusted(event) || typeof enabled !== 'boolean') {
      return Promise.resolve({ ok: false, reason: 'That action is not available.' })
    }
    return enableFollow(enabled)
  })

  ipcMain.handle(IPC.comeHere, (event) => {
    if (!trusted(event)) return { ok: false, reason: 'That action is not available.', paused: false }
    return comeToFront()
  })

  ipcMain.on(IPC.setReducedMotion, (event, reduced: unknown) => {
    if (!trusted(event) || typeof reduced !== 'boolean') return
    presence.setReducedMotion(reduced)
    setReducedMotion(reduced)
  })

  ipcMain.on(IPC.exitFinished, (event, generation: unknown) => {
    if (!trusted(event) || typeof generation !== 'number' || !Number.isInteger(generation)) return
    presence.exitFinished(generation)
  })
}

function refused(): { ok: false; reason: string; list: never[] } {
  return { ok: false, reason: 'That change isn\u2019t allowed.', list: [] }
}

function commit(edit: ChatEdit): { ok: boolean; reason: string; list: { name: string; url: string }[] } {
  if (!edit.ok) return { ok: false, reason: edit.reason, list: savedChats() }
  if (!setSavedChats(edit.list)) return { ok: false, reason: 'I couldn\u2019t save that.', list: savedChats() }
  return { ok: true, reason: '', list: edit.list }
}

function trusted(event: IpcMainEvent | IpcMainInvokeEvent): boolean {
  return isTrustedSender(event.sender.id)
}

/** Pet panel or the GPT live viewer — for live-view IPC only. */
function trustedGptLive(event: IpcMainEvent | IpcMainInvokeEvent): boolean {
  return trusted(event) || isGptLiveSender(event.sender.id)
}

function trustedChatGptWeb(event: IpcMainEvent | IpcMainInvokeEvent): boolean {
  return isChatGptWebSender(event.sender.id)
}

function parseDelta(value: unknown): { dx: number; dy: number } | null {
  if (!value || typeof value !== 'object') return null
  const { dx, dy } = value as { dx?: unknown; dy?: unknown }
  if (typeof dx !== 'number' || typeof dy !== 'number') return null
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return null
  if (Math.abs(dx) > MAX_DELTA || Math.abs(dy) > MAX_DELTA) return null
  return { dx, dy }
}

function parseHitRects(value: unknown): HitRect[] | null {
  if (!Array.isArray(value) || value.length > 8) return null
  const rects: HitRect[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object') return null
    const { x, y, width, height } = item as Partial<HitRect>
    if (
      typeof x !== 'number' ||
      typeof y !== 'number' ||
      typeof width !== 'number' ||
      typeof height !== 'number'
    ) {
      return null
    }
    if (![x, y, width, height].every((part) => Number.isFinite(part))) return null
    if (width <= 0 || height <= 0 || width > 2000 || height > 2000) return null
    if (x < -200 || y < -200 || x > 4000 || y > 4000) return null
    rects.push({ x, y, width, height })
  }
  return rects
}

function parseTravel(value: unknown): { dx: number; reduced: boolean } | null {
  if (!value || typeof value !== 'object') return null
  const { dx, reduced } = value as { dx?: unknown; reduced?: unknown }
  if (typeof dx !== 'number' || typeof reduced !== 'boolean') return null
  if (!Number.isFinite(dx) || Math.abs(dx) > MAX_TRAVEL) return null
  return { dx, reduced }
}

function parseShift(value: unknown): { dx: number; dy: number; reduced: boolean } | null {
  if (!value || typeof value !== 'object') return null
  const { dx, dy, reduced } = value as { dx?: unknown; dy?: unknown; reduced?: unknown }
  if (typeof dx !== 'number' || typeof dy !== 'number' || typeof reduced !== 'boolean') return null
  if (!Number.isFinite(dx) || !Number.isFinite(dy) || Math.abs(dx) > MAX_TRAVEL || Math.abs(dy) > MAX_TRAVEL) return null
  return { dx, dy, reduced }
}

function parseClose(value: unknown): { id: string; force: boolean; confirm: boolean } | null {
  if (!value || typeof value !== 'object') return null
  const { id, force, confirm } = value as { id?: unknown; force?: unknown; confirm?: unknown }
  const action = parseActionId(id)
  if (!action || typeof force !== 'boolean' || typeof confirm !== 'boolean') return null
  return { id: action, force, confirm }
}

function parseLaunch(value: unknown): { id: string; confirm: boolean } | null {
  if (!value || typeof value !== 'object') return null
  const { id, confirm } = value as { id?: unknown; confirm?: unknown }
  const action = parseActionId(id)
  if (!action || typeof confirm !== 'boolean') return null
  return { id: action, confirm }
}
