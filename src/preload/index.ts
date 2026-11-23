import { contextBridge, ipcRenderer, webUtils } from 'electron'
import {
  IPC,
  type AppDiscoveryInfo,
  type AppListing,
  type ListenStartResult,
  type HitRect,
  type SelectionEvent,
  type PasteStateEvent,
  type InsertResult,
  type BridgeStatusInfo,
  type BridgeUpdate,
  type ImportanceRules,
  type MailCorrectRequest,
  type PetCommand,
  type PetFlightInfo,
  type PetId,
  type PetListing,
  type MailCorrections,
  type MailSetupLink,
  type MailListRequest,
  type MailListResult,
  type MailReadResult,
  type MailStatusInfo,
  type OpenResult,
  type OpenUrlResult,
  type CloseWebsiteResult,
  type SavedChat,
  type ChatEditResult,
  type KeyEvent,
  type LaunchRequest,
  type LaunchResult,
  type MikoApi,
  type MoveDelta,
  type PanelLayout,
  type PlacementEvent,
  type PointerSample,
  type CloseRequest,
  type CloseResult,
  type CloseUpdate,
  type FollowEvent,
  type PresenceEvent,
  type ShiftDelta,
  type SpeechEvent,
  type TravelDelta,
  type WhatsAppAlias,
  type WhatsAppInsertResult,
  type WhatsAppOpenResult,
  type WhatsAppPeekResult,
  type WhatsAppAttachmentsListResult,
  type WhatsAppAttachmentSaveResult,
  type ClipboardFileResult,
  type PasteFileWhatsAppResult
} from '../shared/api'
import { parseActionId } from '../shared/commands'
import { parseListings } from '../shared/app-listing'

function parseSystemOptions(raw: unknown): {
  launchAtLogin: boolean
  desktopShortcut: boolean
  canLaunchAtLogin: boolean
  canDesktopShortcut: boolean
  detail: string
} {
  const p = raw as Record<string, unknown> | null
  return {
    launchAtLogin: p?.launchAtLogin === true,
    desktopShortcut: p?.desktopShortcut === true,
    canLaunchAtLogin: p?.canLaunchAtLogin === true,
    canDesktopShortcut: p?.canDesktopShortcut === true,
    detail: typeof p?.detail === 'string' ? p.detail.slice(0, 200) : ''
  }
}

function parsePlaySettings(raw: unknown): { mode: 'work' | 'casual'; sound: boolean } {
  const p = raw as { mode?: unknown; sound?: unknown } | null
  return { mode: p?.mode === 'casual' ? 'casual' : 'work', sound: p?.sound === true }
}

const api: MikoApi = {
  moveBy: (delta: MoveDelta): void => {
    ipcRenderer.send(IPC.moveBy, delta)
  },
  panelResize: (width: number, height: number, done: boolean): Promise<PanelLayout> =>
    ipcRenderer.invoke(IPC.panelResize, Number(width), Number(height), done === true) as Promise<PanelLayout>,
  petList: async (): Promise<PetListing> => (await ipcRenderer.invoke(IPC.petList)) as PetListing,
  petModel: async (id: PetId): Promise<ArrayBuffer | null> => {
    const bytes: unknown = await ipcRenderer.invoke(IPC.petModel, String(id))
    if (!(bytes instanceof Uint8Array)) return null
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
  },
  petSave: async (id: PetId): Promise<boolean> => (await ipcRenderer.invoke(IPC.petSave, String(id))) === true,
  petActive: (id: PetId, unitPx: number): void => {
    ipcRenderer.send(IPC.petActive, String(id), Number(unitPx))
  },
  petFlight: async (): Promise<PetFlightInfo> => (await ipcRenderer.invoke(IPC.petFlight)) as PetFlightInfo,
  onPetCommand: (listener: (command: PetCommand) => void): (() => void) => {
    const wrapped = (_event: unknown, payload: unknown): void => {
      const p = payload as { kind?: unknown; pet?: unknown } | null
      if (p?.kind === 'choose') listener({ kind: 'choose' })
      else if (p?.kind === 'feed') listener({ kind: 'feed' })
      else if (p?.kind === 'play') listener({ kind: 'play' })
      else if (p?.kind === 'switch' && typeof p.pet === 'string') listener({ kind: 'switch', pet: p.pet as PetId })
    }
    ipcRenderer.on(IPC.petCommand, wrapped)
    return () => ipcRenderer.removeListener(IPC.petCommand, wrapped)
  },
  playThrow: async (request) => {
    const raw = (await ipcRenderer.invoke(IPC.playThrow, {
      toy: request.toy === 'stick' ? 'stick' : 'ball',
      localX: Number(request.localX),
      localY: Number(request.localY),
      vx: Number(request.vx),
      vy: Number(request.vy),
      mouthDx: Number(request.mouthDx),
      maxDistance: Number(request.maxDistance),
      reduced: request.reduced === true
    })) as { ok?: unknown; reason?: unknown; targetX?: unknown; seconds?: unknown } | null
    return {
      ok: raw?.ok === true,
      reason: typeof raw?.reason === 'string' ? raw.reason.slice(0, 200) : '',
      targetX: typeof raw?.targetX === 'number' && Number.isFinite(raw.targetX) ? raw.targetX : 0,
      seconds: typeof raw?.seconds === 'number' && Number.isFinite(raw.seconds) ? raw.seconds : 0
    }
  },
  projectorOpen: (): void => {
    ipcRenderer.send(IPC.projectorOpen)
  },
  knowledgeState: () => ipcRenderer.invoke(IPC.knowledgeState),
  knowledgeAdd: (how, paths) => ipcRenderer.invoke(IPC.knowledgeAdd, how, Array.isArray(paths) ? paths.filter((p) => typeof p === 'string') : undefined),
  knowledgeSample: () => ipcRenderer.invoke(IPC.knowledgeSample),
  knowledgeAction: (action, id) => ipcRenderer.invoke(IPC.knowledgeAction, action, typeof id === 'string' ? id : undefined),
  knowledgeSearch: (query, opts) => ipcRenderer.invoke(IPC.knowledgeSearch, String(query), opts ?? {}),
  knowledgePassage: (chunkId, version) => ipcRenderer.invoke(IPC.knowledgePassage, String(chunkId), String(version)),
  knowledgeOpen: (sourceId) => ipcRenderer.invoke(IPC.knowledgeOpen, String(sourceId)),
  knowledgePathsFor: (files) => {
    const out: string[] = []
    for (const file of Array.from(files ?? []).slice(0, 500)) {
      try {
        const path = webUtils.getPathForFile(file)
        if (path) out.push(path)
      } catch {
        /* not a real file (e.g. dragged text) */
      }
    }
    return out
  },
  onKnowledge: (listener) => {
    const wrapped = (_event: Electron.IpcRendererEvent, payload: unknown): void => {
      const p = payload as { type?: unknown } | null
      if (p && (p.type === 'state' || p.type === 'removed')) listener(payload as Parameters<typeof listener>[0])
    }
    ipcRenderer.on(IPC.knowledgeEvent, wrapped)
    return () => ipcRenderer.removeListener(IPC.knowledgeEvent, wrapped)
  },
  playToyHide: (): void => {
    ipcRenderer.send(IPC.playToyHide)
  },
  onPlayToy: (listener) => {
    const wrapped = (_event: Electron.IpcRendererEvent, payload: unknown): void => {
      const p = payload as { phase?: unknown; reason?: unknown } | null
      if (p?.phase === 'landed') listener({ phase: 'landed' })
      else if (p?.phase === 'cancelled') listener({ phase: 'cancelled', reason: typeof p.reason === 'string' ? p.reason.slice(0, 40) : '' })
    }
    ipcRenderer.on(IPC.playToy, wrapped)
    return () => ipcRenderer.removeListener(IPC.playToy, wrapped)
  },
  playSettingsGet: async () => parsePlaySettings(await ipcRenderer.invoke(IPC.playSettingsGet)),
  playSettingsSet: async (next) =>
    parsePlaySettings(
      await ipcRenderer.invoke(IPC.playSettingsSet, {
        ...(next.mode === 'work' || next.mode === 'casual' ? { mode: next.mode } : {}),
        ...(typeof next.sound === 'boolean' ? { sound: next.sound } : {})
      })
    ),
  onPlaySettings: (listener) => {
    const wrapped = (_event: Electron.IpcRendererEvent, payload: unknown): void => listener(parsePlaySettings(payload))
    ipcRenderer.on(IPC.playSettings, wrapped)
    return () => ipcRenderer.removeListener(IPC.playSettings, wrapped)
  },
  panelPreset: (preset: 'small' | 'medium' | 'large' | 'reset'): Promise<PanelLayout> =>
    ipcRenderer.invoke(IPC.panelPreset, String(preset)) as Promise<PanelLayout>,
  setPanelOpen: (open: boolean, mode?: 'chat' | 'mail'): Promise<PanelLayout> => {
    return ipcRenderer.invoke(IPC.setPanelOpen, open, mode === 'mail' ? 'mail' : 'chat') as Promise<PanelLayout>
  },
  setHitRects: (rects: HitRect[]): void => {
    ipcRenderer.send(IPC.setHitRects, rects)
  },
  setDragActive: (active: boolean): void => {
    ipcRenderer.send(IPC.setDragActive, active)
  },
  setPointerHeld: (active: boolean): void => {
    ipcRenderer.send(IPC.setPointerHeld, active)
  },
  travelBy: (delta: TravelDelta): void => {
    ipcRenderer.send(IPC.travelBy, delta)
  },
  unpinHome: (): void => {
    ipcRenderer.send(IPC.unpinHome)
  },
  appsStatus: async (): Promise<AppDiscoveryInfo> => {
    const raw = (await ipcRenderer.invoke(IPC.appsStatus)) as Partial<AppDiscoveryInfo> | null
    const sources = ['start-apps', 'shortcuts', 'mac-folders', 'none'] as const
    return {
      ok: raw?.ok === true,
      source: sources.find((item) => item === raw?.source) ?? 'none',
      count: typeof raw?.count === 'number' ? raw.count : 0,
      detail: typeof raw?.detail === 'string' ? raw.detail.slice(0, 200) : ''
    }
  },
  listApps: async (): Promise<AppListing[]> => {
    const payload: unknown = await ipcRenderer.invoke(IPC.listApps)
    return parseListings(payload)
  },
  launchApp: async (request: LaunchRequest): Promise<LaunchResult> => {
    const id = parseActionId(request?.id)
    if (!id || typeof request?.confirm !== 'boolean') {
      return { ok: false, reason: 'That action is not available.' }
    }
    const payload: unknown = await ipcRenderer.invoke(IPC.launchApp, { id, confirm: request.confirm })
    return parseLaunchResult(payload)
  },
  openChatGpt: async (): Promise<OpenResult> => parseOpen(await ipcRenderer.invoke(IPC.openChatGpt)),
  chatgptInsert: async (prompt: string, mode?: 'append' | 'replace'): Promise<InsertResult> => {
    const r = (await ipcRenderer.invoke(IPC.chatgptInsert, String(prompt).slice(0, 8000), mode === 'append' || mode === 'replace' ? mode : undefined)) as InsertResult | null
    if (r && (r.state === 'inserted' || r.state === 'pasted' || r.state === 'has-text' || r.state === 'unavailable' || r.state === 'failed')) return r
    return { state: 'failed', reason: 'No response.' }
  },
  typeDestCapture: async () => (await ipcRenderer.invoke(IPC.typeDestCapture)) as import('../shared/destination').TypeDestination | null,
  typeDestCaptureHere: async () =>
    (await ipcRenderer.invoke(IPC.typeDestCaptureHere)) as import('../shared/destination').TypeDestination | null,
  typeDestOpenChatGpt: async () =>
    (await ipcRenderer.invoke(IPC.typeDestOpenChatGpt)) as {
      ok: boolean
      reason: string
      dest: import('../shared/destination').TypeDestination | null
    },
  typeDestNewChat: async () =>
    (await ipcRenderer.invoke(IPC.typeDestNewChat)) as {
      ok: boolean
      verified: boolean
      reason: string
      dest: import('../shared/destination').TypeDestination | null
    },
  typeDestInsert: async (request) =>
    (await ipcRenderer.invoke(IPC.typeDestInsert, {
      text: String(request?.text ?? '').slice(0, 8000),
      dest: request?.dest,
      mode: request?.mode,
      allowUnexposedChatGpt: request?.allowUnexposedChatGpt === true
    })) as import('../shared/destination').TypeInsertResult,
  typeDestOmnibox: async (text: string) =>
    (await ipcRenderer.invoke(IPC.typeDestOmnibox, String(text).slice(0, 2000))) as import('../shared/destination').TypeInsertResult,
  typeDestOpenNotes: async () =>
    (await ipcRenderer.invoke(IPC.typeDestOpenNotes)) as {
      ok: boolean
      reason: string
      dest: import('../shared/destination').TypeDestination | null
    },
  typeDestCancel: () => {
    ipcRenderer.send(IPC.typeDestCancel)
  },
  gptModeGet: async () =>
    (await ipcRenderer.invoke(IPC.gptModeGet)) as import('../shared/gpt-mode').GptModeState,
  gptModeEnable: async () =>
    (await ipcRenderer.invoke(IPC.gptModeEnable)) as import('../shared/gpt-mode').GptModeState,
  gptModePause: async () =>
    (await ipcRenderer.invoke(IPC.gptModePause)) as import('../shared/gpt-mode').GptModeState,
  gptModeResume: async () =>
    (await ipcRenderer.invoke(IPC.gptModeResume)) as import('../shared/gpt-mode').GptModeState,
  gptModeExit: async () =>
    (await ipcRenderer.invoke(IPC.gptModeExit)) as import('../shared/gpt-mode').GptModeState,
  gptModeNewChat: async () =>
    (await ipcRenderer.invoke(IPC.gptModeNewChat)) as { ok: boolean; verified: boolean; reason: string },
  gptModeSend: async (request) =>
    (await ipcRenderer.invoke(IPC.gptModeSend, {
      requestId: String(request?.requestId ?? '').slice(0, 80),
      text: String(request?.text ?? '').slice(0, 8000),
      mode: request?.mode === 'replace' || request?.mode === 'append' || request?.mode === 'ask' ? request.mode : 'ask'
    })) as import('../shared/gpt-mode').GptSendResult,
  gptModeCancel: () => {
    ipcRenderer.send(IPC.gptModeCancel)
  },
  gptModeFocus: async () =>
    (await ipcRenderer.invoke(IPC.gptModeFocus)) as { ok: boolean; reason: string },
  chatgptWebOpen: async () =>
    (await ipcRenderer.invoke(IPC.chatgptWebOpen)) as { ok: boolean; reason: string },
  chatgptWebStatus: async () =>
    (await ipcRenderer.invoke(IPC.chatgptWebStatus)) as {
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
    },
  chatgptWebCollapse: async () => (await ipcRenderer.invoke(IPC.chatgptWebCollapse)) as boolean,
  chatgptWebExpand: async () => (await ipcRenderer.invoke(IPC.chatgptWebExpand)) as boolean,
  chatgptWebClose: async () => (await ipcRenderer.invoke(IPC.chatgptWebClose)) as boolean,
  chatgptWebInsertTranscript: async (text: string) =>
    (await ipcRenderer.invoke(IPC.chatgptWebInsertTranscript, String(text).slice(0, 8000))) as {
      ok: boolean
      reason: string
    },
  chatgptWebPasteClipboard: async () =>
    (await ipcRenderer.invoke(IPC.chatgptWebPasteClipboard)) as {
      ok: boolean
      reason: string
      text?: string
    },
  chatgptWebSubmitDraft: async (opts?: { expectedText?: string; generation?: number }) =>
    (await ipcRenderer.invoke(IPC.chatgptWebSubmitDraft, opts ?? {})) as {
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
    },
  chatgptWebCancelSubmit: async () => (await ipcRenderer.invoke(IPC.chatgptWebCancelSubmit)) as number,
  chatgptWebDictateArm: async (armed: boolean) =>
    (await ipcRenderer.invoke(IPC.chatgptWebDictateArm, armed === true)) as boolean,
  chatgptWebTalkArm: async (armed: boolean) => (await ipcRenderer.invoke(IPC.chatgptWebTalkArm, armed === true)) as boolean,
  onUiHint: (listener: (hint: {
    tuckPanel?: boolean
    dictateToGpt?: boolean
    talkToGpt?: boolean
    openSetup?: boolean
    openHelp?: boolean
    runTutorial?: boolean
    listen?: boolean
  }) => void): (() => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, payload: unknown): void => {
      if (!payload || typeof payload !== 'object') return
      const p = payload as {
        tuckPanel?: boolean
        dictateToGpt?: boolean
        talkToGpt?: boolean
        openSetup?: boolean
        openHelp?: boolean
        runTutorial?: boolean
        listen?: boolean
      }
      listener({
        tuckPanel: p.tuckPanel === true,
        dictateToGpt: typeof p.dictateToGpt === 'boolean' ? p.dictateToGpt : undefined,
        talkToGpt: typeof p.talkToGpt === 'boolean' ? p.talkToGpt : undefined,
        openSetup: p.openSetup === true,
        openHelp: p.openHelp === true,
        runTutorial: p.runTutorial === true,
        listen: p.listen === true
      })
    }
    ipcRenderer.on(IPC.uiHint, wrapped)
    return () => ipcRenderer.removeListener(IPC.uiHint, wrapped)
  },
  gptModeSetLiveView: async (enabled: boolean) =>
    (await ipcRenderer.invoke(IPC.gptModeLiveView, enabled === true)) as import('../shared/gpt-mode').GptModeState,
  gptModeLiveSnapshot: async () =>
    (await ipcRenderer.invoke(IPC.gptModeLiveSnapshot)) as import('../shared/gpt-mode').GptLiveSnapshot,
  gptModeListSources: async () =>
    (await ipcRenderer.invoke(IPC.gptModeListSources)) as {
      ok: boolean
      reason: string
      permission: string
      sources: import('../shared/gpt-mode').GptCaptureSource[]
    },
  gptModeSetSource: async (sourceId: string, name?: string, owner?: string) =>
    (await ipcRenderer.invoke(
      IPC.gptModeSetSource,
      String(sourceId).slice(0, 120),
      String(name ?? '').slice(0, 120),
      String(owner ?? '').slice(0, 80)
    )) as import('../shared/gpt-mode').GptModeState,
  gptModeLiveSizePreset: async (preset) =>
    (await ipcRenderer.invoke(IPC.gptModeLiveSizePreset, preset)) as boolean,
  gptModeLiveCollapse: async (collapsed: boolean) =>
    (await ipcRenderer.invoke(IPC.gptModeLiveCollapse, collapsed === true)) as boolean,
  onGptModeLiveCollapse: (listener) => {
    const wrapped = (_: Electron.IpcRendererEvent, collapsed: boolean): void => {
      listener(collapsed === true)
    }
    ipcRenderer.on(IPC.gptModeLiveCollapse, wrapped)
    return () => ipcRenderer.removeListener(IPC.gptModeLiveCollapse, wrapped)
  },
  gptModeOpenPicker: () => {
    ipcRenderer.send(IPC.gptModeOpenPicker)
  },
  onGptModeOpenPicker: (listener) => {
    const wrapped = (): void => {
      listener()
    }
    ipcRenderer.on(IPC.gptModeOpenPicker, wrapped)
    return () => ipcRenderer.removeListener(IPC.gptModeOpenPicker, wrapped)
  },
  onGptModeState: (listener) => {
    const wrapped = (_: Electron.IpcRendererEvent, state: import('../shared/gpt-mode').GptModeState): void => {
      listener(state)
    }
    ipcRenderer.on(IPC.gptModeState, wrapped)
    return () => ipcRenderer.removeListener(IPC.gptModeState, wrapped)
  },
  lensWindowBounds: async (sourceId) =>
    (await ipcRenderer.invoke(
      IPC.lensWindowBounds,
      typeof sourceId === 'string' ? sourceId.slice(0, 120) : undefined
    )) as import('../shared/lens-control').LensWindowBounds | null,
  lensPointer: async (request) =>
    (await ipcRenderer.invoke(IPC.lensPointer, request)) as import('../shared/lens-control').LensPointerResult,
  lensType: async (request) =>
    (await ipcRenderer.invoke(IPC.lensType, request)) as import('../shared/lens-control').LensTypeResult,
  lensFinderSelection: async (sourceId) =>
    (await ipcRenderer.invoke(
      IPC.lensFinderSelection,
      typeof sourceId === 'string' ? sourceId.slice(0, 120) : undefined
    )) as import('../shared/lens-control').LensFinderSelectionResult,
  lensPickFiles: async () =>
    (await ipcRenderer.invoke(IPC.lensPickFiles)) as import('../shared/lens-control').LensFinderSelectionResult,
  lensProvenFiles: async () =>
    (await ipcRenderer.invoke(IPC.lensProvenFiles)) as import('../shared/lens-control').LensResolvedFile[],
  lensCopyFile: async (path: string) =>
    (await ipcRenderer.invoke(IPC.lensCopyFile, String(path).slice(0, 1024))) as { ok: boolean; reason: string },
  lensRevealFile: async (path: string) =>
    (await ipcRenderer.invoke(IPC.lensRevealFile, String(path).slice(0, 1024))) as boolean,
  lensStartDrag: (path: string) => {
    ipcRenderer.send(IPC.lensStartDrag, String(path).slice(0, 1024))
  },
  lensAttachChatGpt: async (path: string, sourceId?: string) =>
    (await ipcRenderer.invoke(
      IPC.lensAttachChatGpt,
      String(path).slice(0, 1024),
      typeof sourceId === 'string' ? sourceId.slice(0, 120) : undefined
    )) as import('../shared/lens-control').LensAttachResult,
  lensRegisterFile: async (path: string) =>
    (await ipcRenderer.invoke(
      IPC.lensRegisterFile,
      String(path).slice(0, 1024)
    )) as import('../shared/lens-control').LensResolvedFile | null,
  lensCancelInput: () => {
    ipcRenderer.send(IPC.lensCancelInput)
  },
  lensOpenOriginal: async (sourceId?: string) =>
    (await ipcRenderer.invoke(
      IPC.lensOpenOriginal,
      typeof sourceId === 'string' ? sourceId.slice(0, 120) : undefined
    )) as { ok: boolean; reason: string; pid: number },
  spotifyMedia: async (action) =>
    (await ipcRenderer.invoke(IPC.spotifyMedia, String(action))) as import('../shared/lens-control').SpotifyMediaStatus,
  listChats: async (): Promise<SavedChat[]> => parseChats(await ipcRenderer.invoke(IPC.chatsList)),
  addChat: async (name: string, url: string): Promise<ChatEditResult> =>
    parseEdit(await ipcRenderer.invoke(IPC.chatsAdd, { name: String(name), url: String(url) })),
  renameChat: async (from: string, to: string): Promise<ChatEditResult> =>
    parseEdit(await ipcRenderer.invoke(IPC.chatsRename, { from: String(from), to: String(to) })),
  removeChat: async (name: string): Promise<ChatEditResult> => parseEdit(await ipcRenderer.invoke(IPC.chatsRemove, String(name))),
  openChat: async (name: string): Promise<OpenResult> => parseOpen(await ipcRenderer.invoke(IPC.chatsOpen, String(name))),
  openUrl: async (url: string, name?: string, browser?: string | null): Promise<OpenUrlResult> => {
    const payload = await ipcRenderer.invoke(
      IPC.openUrl,
      String(url).slice(0, 2000),
      typeof name === 'string' ? name.slice(0, 80) : '',
      typeof browser === 'string' ? browser.slice(0, 40) : null
    )
    return parseOpenUrl(payload)
  },
  chromeProfilesList: async () => {
    const payload = await ipcRenderer.invoke(IPC.chromeProfilesList)
    return parseChromeProfilesList(payload)
  },
  chromeProfilesLaunch: async (request) => {
    const directoryId = typeof request?.directoryId === 'string' ? request.directoryId.trim().slice(0, 40) : ''
    const payload = await ipcRenderer.invoke(IPC.chromeProfilesLaunch, {
      directoryId,
      url: typeof request?.url === 'string' ? request.url.slice(0, 2000) : null,
      displayName: typeof request?.displayName === 'string' ? request.displayName.slice(0, 80) : null
    })
    return parseChromeLaunch(payload)
  },
  chromeProfilesFallback: async (kind, url) => {
    const mode = kind === 'profile-picker' || kind === 'normal' ? kind : 'normal'
    const payload = await ipcRenderer.invoke(
      IPC.chromeProfilesFallback,
      mode,
      typeof url === 'string' ? url.slice(0, 2000) : null
    )
    return parseChromeFallback(payload)
  },
  closeWebsite: async (request): Promise<CloseWebsiteResult> => {
    const payload = await ipcRenderer.invoke(IPC.closeWebsite, {
      host: typeof request?.host === 'string' ? request.host.slice(0, 200) : undefined,
      url: typeof request?.url === 'string' ? request.url.slice(0, 2000) : undefined,
      all: request?.all === true,
      thisTab: request?.thisTab === true,
      pick: request?.pick
    })
    return parseCloseWebsite(payload)
  },
  lastExternalApp: async () => {
    const v = await ipcRenderer.invoke(IPC.lastExternalApp)
    if (!v || typeof v !== 'object') return null
    const o = v as { name?: unknown; bundleId?: unknown; pid?: unknown }
    if (typeof o.name !== 'string' || typeof o.pid !== 'number') return null
    return { name: o.name.slice(0, 80), bundleId: typeof o.bundleId === 'string' ? o.bundleId.slice(0, 200) : '', pid: o.pid }
  },
  prefsStructuredGet: async () => (await ipcRenderer.invoke(IPC.prefsStructuredGet)) as Awaited<ReturnType<MikoApi['prefsStructuredGet']>>,
  prefsStructuredSet: async (prefs) => (await ipcRenderer.invoke(IPC.prefsStructuredSet, prefs)) === true,
  examplesList: async () => ((await ipcRenderer.invoke(IPC.examplesList)) as Awaited<ReturnType<MikoApi['examplesList']>>) ?? [],
  examplesAdd: async (example) => ((await ipcRenderer.invoke(IPC.examplesAdd, example)) as Awaited<ReturnType<MikoApi['examplesList']>>) ?? [],
  examplesRemove: async (id) => ((await ipcRenderer.invoke(IPC.examplesRemove, String(id))) as Awaited<ReturnType<MikoApi['examplesList']>>) ?? [],
  whatsappOpen: async (query: string, pickId?: string, taskId?: string): Promise<WhatsAppOpenResult> =>
    parseWhatsApp(
      await ipcRenderer.invoke(
        IPC.whatsappOpen,
        String(query).slice(0, 80),
        typeof pickId === 'string' ? pickId.slice(0, 400) : '',
        typeof taskId === 'string' ? taskId.slice(0, 80) : ''
      )
    ),
  whatsappCancel: (): void => {
    ipcRenderer.send(IPC.whatsappCancel)
  },
  whatsappAliases: async (): Promise<WhatsAppAlias[]> => parseAliases(await ipcRenderer.invoke(IPC.whatsappAliases)),
  whatsappRemember: async (alias: string, name: string) =>
    parseAliasEdit(await ipcRenderer.invoke(IPC.whatsappRemember, String(alias).slice(0, 80), String(name).slice(0, 80))),
  whatsappForget: async (alias: string) => parseAliasEdit(await ipcRenderer.invoke(IPC.whatsappForget, String(alias).slice(0, 80))),
  whatsappPeek: async (messages?: boolean, latest?: boolean): Promise<WhatsAppPeekResult> =>
    parseWhatsAppPeek(await ipcRenderer.invoke(IPC.whatsappPeek, messages === true, latest === true)),
  whatsappInsert: async (request: { expectHeader: string; text: string; mode: 'replace' | 'append' | 'ask' }): Promise<WhatsAppInsertResult> =>
    parseWhatsAppInsert(
      await ipcRenderer.invoke(IPC.whatsappInsert, {
        expectHeader: String(request.expectHeader ?? '').slice(0, 80),
        text: String(request.text ?? '').slice(0, 4000),
        mode: request.mode === 'append' || request.mode === 'ask' ? request.mode : 'replace'
      })
    ),
  whatsappMarkContextNotice: async (): Promise<boolean> => (await ipcRenderer.invoke(IPC.whatsappContextNotice)) === true,
  whatsappAttachmentsList: async (): Promise<WhatsAppAttachmentsListResult> =>
    (await ipcRenderer.invoke(IPC.whatsappAttachmentsList)) as WhatsAppAttachmentsListResult,
  whatsappAttachmentSave: async (request: {
    expectHeader: string
    filename: string
    id?: string
    acceptCandidatePath?: string
  }): Promise<WhatsAppAttachmentSaveResult> =>
    (await ipcRenderer.invoke(IPC.whatsappAttachmentSave, {
      expectHeader: String(request.expectHeader ?? '').slice(0, 80),
      filename: String(request.filename ?? '').slice(0, 180),
      id: typeof request.id === 'string' ? request.id.slice(0, 64) : undefined,
      acceptCandidatePath:
        typeof request.acceptCandidatePath === 'string' ? request.acceptCandidatePath.slice(0, 1024) : undefined
    })) as WhatsAppAttachmentSaveResult,
  clipboardFile: async (path: string): Promise<ClipboardFileResult> =>
    (await ipcRenderer.invoke(IPC.clipboardFile, String(path).slice(0, 1024))) as ClipboardFileResult,
  pasteFileWhatsApp: async (request: { expectHeader: string; path: string }): Promise<PasteFileWhatsAppResult> =>
    (await ipcRenderer.invoke(IPC.pasteFileWhatsApp, {
      expectHeader: String(request.expectHeader ?? '').slice(0, 80),
      path: String(request.path ?? '').slice(0, 1024)
    })) as PasteFileWhatsAppResult,
  revealFile: async (path: string): Promise<boolean> =>
    (await ipcRenderer.invoke(IPC.revealFile, String(path).slice(0, 1024))) === true,
  openLocalFile: async (path: string): Promise<string> => {
    const reason = await ipcRenderer.invoke(IPC.openLocalFile, String(path).slice(0, 1024))
    return typeof reason === 'string' ? reason : ''
  },
  copyText: async (text: string): Promise<boolean> => {
    if (typeof text !== 'string' || text.length === 0 || text.length > 4000) return false
    const payload: unknown = await ipcRenderer.invoke(IPC.copyText, text)
    return payload === true
  },
  readClipboard: async (): Promise<string> => {
    const payload: unknown = await ipcRenderer.invoke(IPC.readClipboard)
    return typeof payload === 'string' ? payload.slice(0, 8000) : ''
  },
  closeApp: async (request: CloseRequest): Promise<CloseResult> => {
    const id = parseActionId(request?.id)
    if (!id || typeof request?.force !== 'boolean' || typeof request?.confirm !== 'boolean') {
      return { status: 'failed', name: 'That app' }
    }
    const payload: unknown = await ipcRenderer.invoke(IPC.closeApp, {
      id,
      force: request.force,
      confirm: request.confirm
    })
    return parseClose(payload)
  },
  quitApp: (): void => {
    ipcRenderer.send(IPC.quitApp)
  },
  onCloseUpdate: (listener: (event: CloseUpdate) => void): (() => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, payload: unknown): void => {
      const update = parseCloseUpdate(payload)
      if (update) listener(update)
    }
    ipcRenderer.on(IPC.closeUpdate, wrapped)
    return () => ipcRenderer.removeListener(IPC.closeUpdate, wrapped)
  },
  listenStart: async (): Promise<ListenStartResult> => {
    const payload: unknown = await ipcRenderer.invoke(IPC.listenStart)
    const base = parseLaunchResult(payload)
    const help = (payload as { help?: unknown } | null)?.help
    return help === 'microphone-privacy' || help === 'sound-input' || help === 'speech-language' ? { ...base, help } : base
  },
  listenStop: (): void => {
    ipcRenderer.send(IPC.listenStop)
  },
  listenCancel: (): void => {
    ipcRenderer.send(IPC.listenCancel)
  },
  onSpeech: (listener: (event: SpeechEvent) => void): (() => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, payload: unknown): void => {
      const speech = parseSpeech(payload)
      if (speech) listener(speech)
    }
    ipcRenderer.on(IPC.speech, wrapped)
    return () => ipcRenderer.removeListener(IPC.speech, wrapped)
  },
  setFollow: async (enabled: boolean): Promise<LaunchResult> => {
    if (typeof enabled !== 'boolean') return { ok: false, reason: 'That action is not available.' }
    const payload: unknown = await ipcRenderer.invoke(IPC.setFollow, enabled)
    return parseLaunchResult(payload)
  },
  comeHere: async (): Promise<LaunchResult & { paused: boolean }> => {
    const payload: unknown = await ipcRenderer.invoke(IPC.comeHere)
    const result = parseLaunchResult(payload)
    const paused = !!payload && typeof payload === 'object' && (payload as { paused?: unknown }).paused === true
    return { ...result, paused }
  },
  onFollow: (listener: (event: FollowEvent) => void): (() => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, payload: unknown): void => {
      const follow = parseFollow(payload)
      if (follow) listener(follow)
    }
    ipcRenderer.on(IPC.follow, wrapped)
    return () => ipcRenderer.removeListener(IPC.follow, wrapped)
  },
  shiftBy: (delta: ShiftDelta): void => {
    ipcRenderer.send(IPC.shiftBy, delta)
  },
  onKeys: (listener: (event: KeyEvent) => void): (() => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, payload: unknown): void => {
      const kind = payload && typeof payload === 'object' ? (payload as { kind?: unknown }).kind : null
      if (kind === 'talk-start' || kind === 'talk-stop' || kind === 'switcher' || kind === 'permission') {
        listener({ kind })
      }
    }
    ipcRenderer.on(IPC.keys, wrapped)
    return () => ipcRenderer.removeListener(IPC.keys, wrapped)
  },
  getVoiceAuto: async (): Promise<boolean> => (await ipcRenderer.invoke(IPC.getVoiceAuto)) !== false,
  onVoiceAuto: (listener: (enabled: boolean) => void): (() => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, payload: unknown): void => {
      if (typeof payload === 'boolean') listener(payload)
    }
    ipcRenderer.on(IPC.voiceAuto, wrapped)
    return () => ipcRenderer.removeListener(IPC.voiceAuto, wrapped)
  },
  bridgeStatus: async () => (await ipcRenderer.invoke(IPC.bridgeStatus)) as BridgeStatusInfo | null,
  bridgeSetEnabled: async (enabled: boolean) =>
    (await ipcRenderer.invoke(IPC.bridgeSetEnabled, enabled === true)) as BridgeStatusInfo | null,
  bridgeSend: async (requestId: string, prompt: string, opts?: { fresh?: boolean; keep?: boolean }) => {
    const r = (await ipcRenderer.invoke(IPC.bridgeSend, String(requestId), String(prompt), {
      fresh: opts?.fresh === true,
      keep: opts?.keep === true
    })) as { ok?: unknown; reason?: unknown } | null
    return { ok: r?.ok === true, reason: typeof r?.reason === 'string' ? r.reason : '' }
  },
  onSelection: (listener: (event: SelectionEvent) => void) => {
    const wrapped = (_e: Electron.IpcRendererEvent, payload: unknown): void => {
      const p = payload as Partial<SelectionEvent> | null
      if (!p || typeof p.captureId !== 'string') return
      listener(parseSelection(p))
    }
    ipcRenderer.on(IPC.selection, wrapped)
    return () => ipcRenderer.removeListener(IPC.selection, wrapped)
  },
  selectionClipboard: async () => parseSelection((await ipcRenderer.invoke(IPC.selectionClipboard)) as Partial<SelectionEvent>),
  selectionReplace: async (captureId: string, text: string) => {
    const r = (await ipcRenderer.invoke(IPC.selectionReplace, String(captureId), String(text))) as { ok?: unknown; reason?: unknown; verified?: unknown } | null
    return { ok: r?.ok === true, reason: typeof r?.reason === 'string' ? r.reason : '', verified: r?.verified === true }
  },
  pasteArm: async (text: string, target?: 'chatgpt') => {
    const r = (await ipcRenderer.invoke(IPC.pasteArm, String(text), target === 'chatgpt' ? 'chatgpt' : undefined)) as {
      ok?: unknown
      reason?: unknown
    } | null
    return { ok: r?.ok === true, reason: typeof r?.reason === 'string' ? r.reason : '' }
  },
  pasteCancel: () => ipcRenderer.send(IPC.pasteCancel),
  onPasteState: (listener: (event: PasteStateEvent) => void) => {
    const wrapped = (_e: Electron.IpcRendererEvent, payload: unknown): void => {
      const p = payload as Partial<PasteStateEvent> | null
      if (!p || !['armed', 'done', 'cancelled', 'expired', 'failed'].includes(String(p.state))) return
      listener({ state: p.state as PasteStateEvent['state'], reason: typeof p.reason === 'string' ? p.reason : '', verified: p.verified === true })
    }
    ipcRenderer.on(IPC.pasteState, wrapped)
    return () => ipcRenderer.removeListener(IPC.pasteState, wrapped)
  },
  selectionShortcutGet: async () => String((await ipcRenderer.invoke(IPC.selectionShortcutGet)) ?? ''),
  selectionShortcutSet: async (accelerator: string) => {
    const r = (await ipcRenderer.invoke(IPC.selectionShortcutSet, String(accelerator))) as { ok?: unknown; reason?: unknown; shortcut?: unknown } | null
    return { ok: r?.ok === true, reason: typeof r?.reason === 'string' ? r.reason : '', shortcut: typeof r?.shortcut === 'string' ? r.shortcut : '' }
  },
  setupGet: async () =>
    (await ipcRenderer.invoke(IPC.setupGet)) as Awaited<ReturnType<MikoApi['setupGet']>>,
  setupUpdate: async (update) =>
    (await ipcRenderer.invoke(IPC.setupUpdate, update)) as Awaited<ReturnType<MikoApi['setupUpdate']>>,
  voicePermissionGet: async () =>
    (await ipcRenderer.invoke(IPC.voicePermissionGet)) as Awaited<ReturnType<MikoApi['voicePermissionGet']>>,
  voicePermissionRequest: async () =>
    (await ipcRenderer.invoke(IPC.voicePermissionRequest)) as Awaited<ReturnType<MikoApi['voicePermissionRequest']>>,
  voiceSettingsOpen: async (help?: 'microphone-privacy' | 'sound-input' | 'speech-language') =>
    (await ipcRenderer.invoke(
      IPC.voiceSettingsOpen,
      help === 'microphone-privacy' || help === 'sound-input' || help === 'speech-language' ? help : undefined
    )) === true,
  voiceInputDevices: async () => {
    const raw = (await ipcRenderer.invoke(IPC.voiceInputDevices)) as
      | { devices?: unknown; detail?: unknown; defaultDevice?: unknown; recognizers?: unknown }
      | null
    const list = (value: unknown, max: number): string[] =>
      Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string').map((item) => item.slice(0, max)).slice(0, 20) : []
    return {
      devices: list(raw?.devices, 120),
      defaultDevice: typeof raw?.defaultDevice === 'string' ? raw.defaultDevice.slice(0, 120) : '',
      recognizers: list(raw?.recognizers, 20),
      detail: typeof raw?.detail === 'string' ? raw.detail.slice(0, 300) : ''
    }
  },
  voiceMicTest: async () =>
    (await ipcRenderer.invoke(IPC.voiceMicTest)) as Awaited<ReturnType<MikoApi['voiceMicTest']>>,
  systemOptionsGet: async () => parseSystemOptions(await ipcRenderer.invoke(IPC.systemOptionsGet)),
  systemOptionsSet: async (next) => {
    const raw = (await ipcRenderer.invoke(IPC.systemOptionsSet, {
      ...(typeof next.launchAtLogin === 'boolean' ? { launchAtLogin: next.launchAtLogin } : {}),
      ...(typeof next.desktopShortcut === 'boolean' ? { desktopShortcut: next.desktopShortcut } : {})
    })) as { reason?: unknown } | null
    return { ...parseSystemOptions(raw), reason: typeof raw?.reason === 'string' ? raw.reason.slice(0, 200) : '' }
  },
  openLogsFolder: async () => (await ipcRenderer.invoke(IPC.openLogsFolder)) === true,
  voiceMicTestCancel: (): void => {
    ipcRenderer.send(IPC.voiceMicTestCancel)
  },
  onMicTestPhase: (listener) => {
    const phases = ['starting', 'listening', 'hearing', 'processing', 'done', 'error', 'cancelled'] as const
    const wrapped = (_event: Electron.IpcRendererEvent, payload: unknown): void => {
      const p = payload as { phase?: unknown; detail?: unknown } | null
      const phase = phases.find((item) => item === p?.phase)
      if (!phase) return
      listener({ phase, detail: typeof p?.detail === 'string' ? p.detail.slice(0, 400) : '' })
    }
    ipcRenderer.on(IPC.voiceMicTestPhase, wrapped)
    return () => ipcRenderer.removeListener(IPC.voiceMicTestPhase, wrapped)
  },
  summonShortcutGet: async () =>
    (await ipcRenderer.invoke(IPC.summonShortcutGet)) as Awaited<ReturnType<MikoApi['summonShortcutGet']>>,
  summonShortcutSet: async (accelerator: string) =>
    (await ipcRenderer.invoke(IPC.summonShortcutSet, String(accelerator))) as Awaited<
      ReturnType<MikoApi['summonShortcutSet']>
    >,
  bridgeCancel: (requestId: string) => ipcRenderer.send(IPC.bridgeCancel, String(requestId)),
  bridgeNew: async () => {
    await ipcRenderer.invoke(IPC.bridgeNew)
  },
  prefsGet: async () => {
    const v: unknown = await ipcRenderer.invoke(IPC.prefsGet)
    return typeof v === 'string' ? v : ''
  },
  prefsSet: async (text: string) => (await ipcRenderer.invoke(IPC.prefsSet, String(text).slice(0, 2000))) === true,
  appInfo: async () => {
    const v = (await ipcRenderer.invoke(IPC.appInfo)) as {
      name?: unknown
      version?: unknown
      buildId?: unknown
      channel?: unknown
      packaged?: unknown
      platform?: unknown
      arch?: unknown
    } | null
    return {
      name: typeof v?.name === 'string' ? v.name : 'MIKO',
      version: typeof v?.version === 'string' ? v.version : '0.1.0',
      buildId: typeof v?.buildId === 'string' ? v.buildId : 'unknown',
      channel: typeof v?.channel === 'string' ? v.channel : 'private-beta',
      packaged: v?.packaged === true,
      platform: typeof v?.platform === 'string' ? v.platform : '',
      arch: typeof v?.arch === 'string' ? v.arch : ''
    }
  },
  feedbackConfigGet: async () => {
    const v = (await ipcRenderer.invoke(IPC.feedbackConfigGet)) as {
      endpoint?: unknown
      inviteCode?: unknown
      hasEndpoint?: unknown
    } | null
    return {
      endpoint: typeof v?.endpoint === 'string' ? v.endpoint : '',
      inviteCode: typeof v?.inviteCode === 'string' ? v.inviteCode : '',
      hasEndpoint: v?.hasEndpoint === true
    }
  },
  feedbackConfigSet: async (partial) => {
    const v = (await ipcRenderer.invoke(IPC.feedbackConfigSet, partial)) as {
      endpoint?: unknown
      inviteCode?: unknown
      hasEndpoint?: unknown
    } | null
    return {
      endpoint: typeof v?.endpoint === 'string' ? v.endpoint : '',
      inviteCode: typeof v?.inviteCode === 'string' ? v.inviteCode : '',
      hasEndpoint: v?.hasEndpoint === true
    }
  },
  feedbackPreview: async (draft, opts) =>
    (await ipcRenderer.invoke(IPC.feedbackPreview, draft, opts ?? null)) as Awaited<ReturnType<MikoApi['feedbackPreview']>>,
  feedbackSubmit: async (draft, opts) =>
    (await ipcRenderer.invoke(IPC.feedbackSubmit, draft, opts ?? null)) as Awaited<ReturnType<MikoApi['feedbackSubmit']>>,
  feedbackList: async () => (await ipcRenderer.invoke(IPC.feedbackList)) as Awaited<ReturnType<MikoApi['feedbackList']>>,
  feedbackRetry: async (id) =>
    (await ipcRenderer.invoke(IPC.feedbackRetry, String(id))) as Awaited<ReturnType<MikoApi['feedbackRetry']>>,
  feedbackDelete: async (id) =>
    (await ipcRenderer.invoke(IPC.feedbackDelete, String(id))) as Awaited<ReturnType<MikoApi['feedbackList']>>,
  feedbackExport: async (id) =>
    (await ipcRenderer.invoke(IPC.feedbackExport, String(id))) as Awaited<ReturnType<MikoApi['feedbackExport']>>,
  feedbackExportDraft: async (draft, opts) =>
    (await ipcRenderer.invoke(IPC.feedbackExportDraft, draft, opts ?? null)) as Awaited<
      ReturnType<MikoApi['feedbackExportDraft']>
    >,
  updateGet: async () => (await ipcRenderer.invoke(IPC.updateGet)) as Awaited<ReturnType<MikoApi['updateGet']>>,
  updateCheck: async () => (await ipcRenderer.invoke(IPC.updateCheck)) as Awaited<ReturnType<MikoApi['updateCheck']>>,
  updateRestart: async (draftText) =>
    (await ipcRenderer.invoke(
      IPC.updateRestart,
      typeof draftText === 'string' ? draftText.slice(0, 8000) : ''
    )) as Awaited<ReturnType<MikoApi['updateRestart']>>,
  updateLater: async () => (await ipcRenderer.invoke(IPC.updateLater)) as Awaited<ReturnType<MikoApi['updateLater']>>,
  updateOpenDownload: async (draftText) =>
    (await ipcRenderer.invoke(
      IPC.updateOpenDownload,
      typeof draftText === 'string' ? draftText.slice(0, 8000) : ''
    )) as Awaited<ReturnType<MikoApi['updateOpenDownload']>>,
  updateFeedSet: async (url) =>
    (await ipcRenderer.invoke(IPC.updateFeedSet, String(url))) as Awaited<ReturnType<MikoApi['updateFeedSet']>>,
  updateManualReleaseSet: async (partial) =>
    (await ipcRenderer.invoke(IPC.updateManualReleaseSet, partial)) as Awaited<
      ReturnType<MikoApi['updateManualReleaseSet']>
    >,
  updateStartup: async () =>
    (await ipcRenderer.invoke(IPC.updateStartup)) as Awaited<ReturnType<MikoApi['updateStartup']>>,
  onUpdateStatus: (listener) => {
    const wrapped = (_e: Electron.IpcRendererEvent, payload: unknown): void => {
      if (!payload || typeof payload !== 'object') return
      listener(payload as Awaited<ReturnType<MikoApi['updateGet']>>)
    }
    ipcRenderer.on(IPC.updateStatus, wrapped)
    return () => ipcRenderer.removeListener(IPC.updateStatus, wrapped)
  },
  onBridge: (listener: (update: BridgeUpdate) => void) => {
    const wrapped = (_e: Electron.IpcRendererEvent, payload: unknown): void => {
      const u = payload as Partial<BridgeUpdate> | null
      if (!u || typeof u.requestId !== 'string' || typeof u.phase !== 'string') return
      if (!['running', 'done', 'failed', 'cancelled', 'timeout'].includes(u.phase)) return
      listener({
        requestId: u.requestId,
        phase: u.phase as BridgeUpdate['phase'],
        reply: typeof u.reply === 'string' ? u.reply.slice(0, 4000) : undefined,
        thread: typeof u.thread === 'string' ? u.thread.slice(0, 64) : undefined,
        reason: typeof u.reason === 'string' ? u.reason.slice(0, 300) : undefined,
        seconds: typeof u.seconds === 'number' ? u.seconds : undefined
      })
    }
    ipcRenderer.on(IPC.bridgeUpdate, wrapped)
    return () => ipcRenderer.removeListener(IPC.bridgeUpdate, wrapped)
  },
  mailStatus: async () => (await ipcRenderer.invoke(IPC.mailStatus)) as MailStatusInfo | null,
  mailConnect: async (hint?: string) => {
    const r = (await ipcRenderer.invoke(IPC.mailConnect, typeof hint === 'string' ? hint : undefined)) as {
      ok?: unknown
      reason?: unknown
      email?: unknown
    } | null
    return {
      ok: r?.ok === true,
      reason: typeof r?.reason === 'string' ? r.reason : '',
      email: typeof r?.email === 'string' ? r.email : undefined
    }
  },
  mailDisconnect: async (email: string) => (await ipcRenderer.invoke(IPC.mailDisconnect, String(email))) === true,
  mailList: async (request: MailListRequest) => (await ipcRenderer.invoke(IPC.mailList, request)) as MailListResult | null,
  mailRead: async (key: string) => (await ipcRenderer.invoke(IPC.mailRead, String(key))) as MailReadResult,
  mailOpenOriginal: async (key: string) => (await ipcRenderer.invoke(IPC.mailOpenOriginal, String(key))) === true,
  mailSetup: async (clientId: string, clientSecret: string) => {
    const r = (await ipcRenderer.invoke(IPC.mailSetup, { clientId: String(clientId), clientSecret: String(clientSecret) })) as {
      ok?: unknown
      reason?: unknown
    } | null
    return { ok: r?.ok === true, reason: typeof r?.reason === 'string' ? r.reason : '' }
  },
  mailRules: async () => (await ipcRenderer.invoke(IPC.mailRules)) as ImportanceRules | null,
  mailSetRules: async (rules: ImportanceRules) => (await ipcRenderer.invoke(IPC.mailSetRules, rules)) as ImportanceRules | null,
  mailCorrections: async () => (await ipcRenderer.invoke(IPC.mailCorrections)) as MailCorrections | null,
  mailCorrect: async (request: MailCorrectRequest) =>
    (await ipcRenderer.invoke(IPC.mailCorrect, {
      key: String(request.key),
      fromEmail: String(request.fromEmail),
      category: request.category === null ? null : String(request.category),
      scope: request.scope === 'sender' ? 'sender' : 'message'
    })) as MailCorrections | null,
  mailSetupLink: async (which: MailSetupLink) => (await ipcRenderer.invoke(IPC.mailSetupLink, String(which))) === true,
  openSwitcher: (): void => {
    ipcRenderer.send(IPC.openSwitcher)
  },
  setReducedMotion: (reduced: boolean): void => {
    ipcRenderer.send(IPC.setReducedMotion, reduced)
  },
  exitFinished: (generation: number): void => {
    ipcRenderer.send(IPC.exitFinished, generation)
  },
  onPresence: (listener: (event: PresenceEvent) => void): (() => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, payload: unknown): void => {
      if (!payload || typeof payload !== 'object') return
      const { phase, generation } = payload as Partial<PresenceEvent>
      if (phase !== 'shown' && phase !== 'exit' && phase !== 'hidden') return
      if (typeof generation !== 'number') return
      listener({ phase, generation })
    }
    ipcRenderer.on(IPC.presence, wrapped)
    return () => ipcRenderer.removeListener(IPC.presence, wrapped)
  },
  onPlacement: (listener: (event: PlacementEvent) => void): (() => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, payload: unknown): void => {
      if (!payload || typeof payload !== 'object') return
      const { x, span } = payload as Partial<PlacementEvent>
      if (typeof x !== 'number' || typeof span !== 'number') return
      if (!Number.isFinite(x) || !Number.isFinite(span)) return
      listener({ x, span })
    }
    ipcRenderer.on(IPC.placement, wrapped)
    return () => ipcRenderer.removeListener(IPC.placement, wrapped)
  },
  onPointer: (listener: (sample: PointerSample) => void): (() => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, payload: unknown): void => {
      if (!payload || typeof payload !== 'object') return
      const sample = payload as Partial<PointerSample>
      if (
        typeof sample.x !== 'number' ||
        typeof sample.y !== 'number' ||
        typeof sample.windowX !== 'number' ||
        typeof sample.windowY !== 'number' ||
        typeof sample.scaleFactor !== 'number'
      ) {
        return
      }
      if (![sample.x, sample.y, sample.windowX, sample.windowY, sample.scaleFactor].every(Number.isFinite)) return
      if (Math.abs(sample.x) > 100000 || Math.abs(sample.y) > 100000) return
      listener({
        x: sample.x,
        y: sample.y,
        windowX: sample.windowX,
        windowY: sample.windowY,
        scaleFactor: sample.scaleFactor
      })
    }
    ipcRenderer.on(IPC.pointer, wrapped)
    return () => ipcRenderer.removeListener(IPC.pointer, wrapped)
  }
}

function parseSelection(p: Partial<SelectionEvent> | null): SelectionEvent {
  return {
    captureId: typeof p?.captureId === 'string' ? p.captureId : '',
    ok: p?.ok === true,
    text: typeof p?.text === 'string' ? p.text.slice(0, 12000) : '',
    app: typeof p?.app === 'string' ? p.app.slice(0, 80) : '',
    method: typeof p?.method === 'string' ? p.method : '',
    canReplace: p?.canReplace === true,
    reason: typeof p?.reason === 'string' ? p.reason : ''
  }
}

function parseOpen(value: unknown): OpenResult {
  const v = (value ?? {}) as { ok?: unknown; target?: unknown; appName?: unknown }
  const target = v.target === 'app' || v.target === 'browser' || v.target === 'workspace' ? v.target : 'none'
  return { ok: v.ok === true, target, appName: typeof v.appName === 'string' ? v.appName.slice(0, 80) : '' }
}

function parseOpenUrl(value: unknown): OpenUrlResult {
  const v = (value ?? {}) as { ok?: unknown; url?: unknown; name?: unknown; browser?: unknown; reason?: unknown }
  return {
    ok: v.ok === true,
    url: typeof v.url === 'string' ? v.url.slice(0, 2000) : '',
    name: typeof v.name === 'string' ? v.name.slice(0, 80) : '',
    browser: typeof v.browser === 'string' ? v.browser.slice(0, 80) : '',
    reason: typeof v.reason === 'string' ? v.reason.slice(0, 200) : ''
  }
}

function parseChromeProfilesList(value: unknown) {
  const v = (value ?? {}) as {
    status?: unknown
    profiles?: unknown
    reason?: unknown
    fallbacks?: unknown
    note?: unknown
  }
  if (v.status === 'ok' && Array.isArray(v.profiles)) {
    return v.profiles
      .filter((p): p is Record<string, unknown> => !!p && typeof p === 'object')
      .map((p) => ({
        directoryId: typeof p.directoryId === 'string' ? p.directoryId.slice(0, 40) : '',
        displayName: typeof p.displayName === 'string' ? p.displayName.slice(0, 80) : '',
        secondaryLabel: typeof p.secondaryLabel === 'string' ? p.secondaryLabel.slice(0, 40) : null,
        initials: typeof p.initials === 'string' ? p.initials.slice(0, 4) : '?',
        avatarDataUrl:
          typeof p.avatarDataUrl === 'string' && p.avatarDataUrl.startsWith('data:image/')
            ? p.avatarDataUrl.slice(0, 600_000)
            : null,
        accent: typeof p.accent === 'string' ? p.accent.slice(0, 40) : null,
        isSavedDefault: p.isSavedDefault === true
      }))
      .filter((p) => p.directoryId && p.displayName)
  }
  const fallbacks = Array.isArray(v.fallbacks)
    ? v.fallbacks
        .filter((f): f is Record<string, unknown> => !!f && typeof f === 'object')
        .map((f) => ({
          id: typeof f.id === 'string' ? f.id.slice(0, 40) : '',
          label: typeof f.label === 'string' ? f.label.slice(0, 80) : ''
        }))
        .filter((f) => f.id && f.label)
    : []
  return {
    status: typeof v.status === 'string' ? v.status : 'missing',
    reason: typeof v.reason === 'string' ? v.reason.slice(0, 240) : 'Chrome profiles unavailable.',
    fallbacks
  }
}

function parseChromeLaunch(value: unknown) {
  const v = (value ?? {}) as Record<string, unknown>
  return {
    ok: v.ok === true,
    directoryId: typeof v.directoryId === 'string' ? v.directoryId.slice(0, 40) : '',
    displayName: typeof v.displayName === 'string' ? v.displayName.slice(0, 80) : '',
    url: typeof v.url === 'string' ? v.url.slice(0, 2000) : '',
    reason: typeof v.reason === 'string' ? v.reason.slice(0, 240) : '',
    verified: false as const,
    verificationNote: typeof v.verificationNote === 'string' ? v.verificationNote.slice(0, 320) : ''
  }
}

function parseChromeFallback(value: unknown) {
  const v = (value ?? {}) as Record<string, unknown>
  return {
    ok: v.ok === true,
    reason: typeof v.reason === 'string' ? v.reason.slice(0, 240) : '',
    verified: false as const,
    verificationNote: typeof v.verificationNote === 'string' ? v.verificationNote.slice(0, 320) : ''
  }
}

function parseCloseWebsite(value: unknown): CloseWebsiteResult {
  const v = (value ?? {}) as {
    status?: unknown
    closed?: unknown
    tabs?: unknown
    reason?: unknown
  }
  const tabs = Array.isArray(v.tabs)
    ? v.tabs
        .filter((t): t is Record<string, unknown> => !!t && typeof t === 'object')
        .map((t) => ({
          browser: t.browser === 'safari' ? 'safari' : 'chrome',
          window: Number(t.window) || 0,
          tab: Number(t.tab) || 0,
          title: typeof t.title === 'string' ? t.title.slice(0, 120) : '',
          url: typeof t.url === 'string' ? t.url.slice(0, 2000) : ''
        }))
    : []
  if (v.status === 'closed') return { status: 'closed', closed: Number(v.closed) || 0, tabs }
  if (v.status === 'choices') return { status: 'choices', tabs, reason: typeof v.reason === 'string' ? v.reason : 'Which tab?' }
  if (v.status === 'unsupported') return { status: 'unsupported', reason: typeof v.reason === 'string' ? v.reason : 'Unsupported.' }
  if (v.status === 'none') return { status: 'none', reason: typeof v.reason === 'string' ? v.reason : 'No matching tabs.' }
  return { status: 'failed', reason: typeof v.reason === 'string' ? v.reason : 'I couldn’t close that.' }
}

function parseChats(value: unknown): SavedChat[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((row): row is SavedChat => !!row && typeof row.name === 'string' && typeof row.url === 'string')
    .map((row) => ({ name: row.name.slice(0, 60), url: row.url.slice(0, 2000) }))
}

function parseEdit(value: unknown): ChatEditResult {
  const v = (value ?? {}) as { ok?: unknown; reason?: unknown; list?: unknown }
  return { ok: v.ok === true, reason: typeof v.reason === 'string' ? v.reason : '', list: parseChats(v.list) }
}

function parseClose(value: unknown): CloseResult {
  const fallback: CloseResult = { status: 'failed', name: 'That app' }
  if (!value || typeof value !== 'object') return fallback
  const { status, name } = value as Partial<CloseResult>
  if (
    status !== 'requested' &&
    status !== 'already-closed' &&
    status !== 'unsupported' &&
    status !== 'failed' &&
    status !== 'needs-confirm'
  ) {
    return fallback
  }
  if (typeof name !== 'string' || name.length === 0) return fallback
  return { status, name: name.slice(0, 80) }
}

function parseCloseUpdate(value: unknown): CloseUpdate | null {
  if (!value || typeof value !== 'object') return null
  const { id, name, status } = value as Partial<CloseUpdate>
  const action = parseActionId(id)
  if (!action || typeof name !== 'string' || (status !== 'closed' && status !== 'still-open')) return null
  return { id: action, name: name.slice(0, 80), status }
}

function parseSpeech(value: unknown): SpeechEvent | null {
  if (!value || typeof value !== 'object') return null
  const { phase, text } = value as Partial<SpeechEvent>
  const rawSession = (value as { session?: unknown }).session
  const session = Number.isInteger(rawSession) ? (rawSession as number) : undefined
  if (
    phase !== 'transcript' &&
    phase !== 'denied' &&
    phase !== 'silence' &&
    phase !== 'unavailable' &&
    phase !== 'cancelled' &&
    phase !== 'failed'
  ) {
    return null
  }
  if (phase === 'transcript') {
    if (typeof text !== 'string' || text.trim().length === 0) return null
    return { phase, text: text.trim().slice(0, 400), session }
  }
  const rawDetail = (value as { detail?: unknown }).detail
  const rawHelp = (value as { help?: unknown }).help
  const help =
    rawHelp === 'microphone-privacy' || rawHelp === 'sound-input' || rawHelp === 'speech-language' ? rawHelp : undefined
  return { phase, session, ...(typeof rawDetail === 'string' && rawDetail ? { detail: rawDetail.slice(0, 500) } : {}), ...(help ? { help } : {}) }
}

function parseFollow(value: unknown): FollowEvent | null {
  if (!value || typeof value !== 'object') return null
  const { kind, x, y } = value as Partial<FollowEvent>
  if (kind === 'placed') return { kind }
  if (kind !== 'approach' || typeof x !== 'number' || typeof y !== 'number') return null
  if (!Number.isFinite(x) || !Number.isFinite(y) || Math.abs(x) > 100000 || Math.abs(y) > 100000) return null
  return { kind, x, y }
}

const WHATSAPP_STATUS = new Set([
  'opened',
  'assisted',
  'none',
  'choices',
  'lost-focus',
  'permission',
  'failed',
  'unsupported',
  'cancelled',
  'unverified'
])

function parseWhatsAppMatches(value: unknown): WhatsAppOpenResult['matches'] {
  if (!Array.isArray(value)) return []
  const out: WhatsAppOpenResult['matches'] = []
  for (const row of value.slice(0, 12)) {
    if (!row || typeof row !== 'object') continue
    const { id, name, snippet, exact, kind } = row as Partial<WhatsAppOpenResult['matches'][number]>
    if (typeof id !== 'string' || typeof name !== 'string' || !name.trim()) continue
    const match: WhatsAppOpenResult['matches'][number] = {
      id: id.slice(0, 400),
      name: name.slice(0, 80),
      snippet: typeof snippet === 'string' ? snippet.slice(0, 120) : '',
      exact: exact === true
    }
    if (kind === 'contact' || kind === 'group') match.kind = kind
    out.push(match)
  }
  return out
}

function parseWhatsApp(value: unknown): WhatsAppOpenResult {
  const fallback: WhatsAppOpenResult = {
    status: 'failed',
    query: '',
    names: [],
    matches: [],
    header: '',
    reason: 'WhatsApp didn’t answer.',
    composerReady: false
  }
  if (!value || typeof value !== 'object') return fallback
  const row = value as Partial<WhatsAppOpenResult>
  if (typeof row.status !== 'string' || !WHATSAPP_STATUS.has(row.status)) return fallback
  const matches = parseWhatsAppMatches(row.matches)
  const names = matches.length
    ? matches.map((m) => m.name)
    : Array.isArray(row.names)
      ? row.names.filter((name): name is string => typeof name === 'string').slice(0, 12).map((name) => name.slice(0, 80))
      : []
  return {
    status: row.status as WhatsAppOpenResult['status'],
    query: typeof row.query === 'string' ? row.query.slice(0, 80) : '',
    names,
    matches,
    header: typeof row.header === 'string' ? row.header.slice(0, 80) : '',
    reason: typeof row.reason === 'string' ? row.reason.slice(0, 400) : '',
    composerReady: row.composerReady === true
  }
}

function parseAliases(value: unknown): WhatsAppAlias[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((row): row is WhatsAppAlias => Boolean(row) && typeof row === 'object' && typeof (row as WhatsAppAlias).alias === 'string' && typeof (row as WhatsAppAlias).name === 'string')
    .slice(0, 40)
    .map((row) => ({ alias: row.alias.slice(0, 80), name: row.name.slice(0, 80) }))
}

function parseWhatsAppPeek(value: unknown): WhatsAppPeekResult {
  const fallback: WhatsAppPeekResult = {
    status: 'failed',
    header: '',
    messages: [],
    composerText: '',
    composerReady: false,
    reason: 'WhatsApp didn’t answer.',
    contextNotice: false
  }
  if (!value || typeof value !== 'object') return fallback
  const row = value as Partial<WhatsAppPeekResult>
  const known = new Set(['peeked', 'lost-focus', 'permission', 'failed', 'cancelled', 'unsupported'])
  if (typeof row.status !== 'string' || !known.has(row.status)) return fallback
  const messages = Array.isArray(row.messages)
    ? row.messages
        .filter((m): m is WhatsAppPeekResult['messages'][number] => Boolean(m) && typeof m === 'object' && typeof (m as { text?: unknown }).text === 'string')
        .slice(0, 12)
        .map((m) => ({
          sender: typeof m.sender === 'string' ? m.sender.slice(0, 80) : 'Contact',
          text: m.text.slice(0, 500),
          mine: m.mine === true,
          raw: typeof m.raw === 'string' ? m.raw.slice(0, 600) : m.text.slice(0, 600)
        }))
    : []
  return {
    status: row.status as WhatsAppPeekResult['status'],
    header: typeof row.header === 'string' ? row.header.slice(0, 80) : '',
    messages,
    composerText: typeof row.composerText === 'string' ? row.composerText.slice(0, 4000) : '',
    composerReady: row.composerReady === true,
    reason: typeof row.reason === 'string' ? row.reason.slice(0, 400) : '',
    contextNotice: row.contextNotice === true,
    atLatest: row.atLatest !== false,
    diag: typeof row.diag === 'string' ? row.diag.slice(0, 240) : ''
  }
}

function parseWhatsAppInsert(value: unknown): WhatsAppInsertResult {
  const fallback: WhatsAppInsertResult = {
    status: 'failed',
    header: '',
    composerText: '',
    verified: false,
    reason: 'WhatsApp didn’t answer.'
  }
  if (!value || typeof value !== 'object') return fallback
  const row = value as Partial<WhatsAppInsertResult>
  const known = new Set(['inserted', 'empty', 'has-text', 'switched', 'lost-focus', 'permission', 'failed', 'cancelled', 'unsupported'])
  if (typeof row.status !== 'string' || !known.has(row.status)) return fallback
  return {
    status: row.status as WhatsAppInsertResult['status'],
    header: typeof row.header === 'string' ? row.header.slice(0, 80) : '',
    composerText: typeof row.composerText === 'string' ? row.composerText.slice(0, 4000) : '',
    verified: row.verified === true,
    reason: typeof row.reason === 'string' ? row.reason.slice(0, 400) : '',
    diag: typeof row.diag === 'string' ? row.diag.slice(0, 240) : ''
  }
}

function parseAliasEdit(value: unknown): { ok: boolean; reason: string; list: WhatsAppAlias[] } {
  if (!value || typeof value !== 'object') return { ok: false, reason: 'Couldn’t save that.', list: [] }
  const row = value as { ok?: unknown; reason?: unknown; list?: unknown }
  return { ok: row.ok === true, reason: typeof row.reason === 'string' ? row.reason.slice(0, 200) : '', list: parseAliases(row.list) }
}

function parseLaunchResult(value: unknown): LaunchResult {
  if (!value || typeof value !== 'object') return { ok: false, reason: 'That action is not available.' }
  const { ok, reason } = value as Partial<LaunchResult>
  if (typeof ok !== 'boolean' || typeof reason !== 'string') {
    return { ok: false, reason: 'That action is not available.' }
  }
  return { ok, reason: reason.slice(0, 400) }
}

if (!process.contextIsolated) {
  throw new Error('MIKO requires context isolation')
}

contextBridge.exposeInMainWorld('miko', api)
