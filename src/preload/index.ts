import { contextBridge, ipcRenderer } from 'electron'
import {
  IPC,
  type AppListing,
  type HitRect,
  type InsertResult,
  type BridgeStatusInfo,
  type BridgeUpdate,
  type ImportanceRules,
  type MailListRequest,
  type MailListResult,
  type MailReadResult,
  type MailStatusInfo,
  type OpenResult,
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
  type TravelDelta
} from '../shared/api'
import { parseActionId } from '../shared/commands'

const api: MikoApi = {
  moveBy: (delta: MoveDelta): void => {
    ipcRenderer.send(IPC.moveBy, delta)
  },
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
    if (r && (r.state === 'inserted' || r.state === 'has-text' || r.state === 'unavailable' || r.state === 'failed')) return r
    return { state: 'failed', reason: 'No response.' }
  },
  listChats: async (): Promise<SavedChat[]> => parseChats(await ipcRenderer.invoke(IPC.chatsList)),
  addChat: async (name: string, url: string): Promise<ChatEditResult> =>
    parseEdit(await ipcRenderer.invoke(IPC.chatsAdd, { name: String(name), url: String(url) })),
  renameChat: async (from: string, to: string): Promise<ChatEditResult> =>
    parseEdit(await ipcRenderer.invoke(IPC.chatsRename, { from: String(from), to: String(to) })),
  removeChat: async (name: string): Promise<ChatEditResult> => parseEdit(await ipcRenderer.invoke(IPC.chatsRemove, String(name))),
  openChat: async (name: string): Promise<OpenResult> => parseOpen(await ipcRenderer.invoke(IPC.chatsOpen, String(name))),
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
  listenStart: async (): Promise<LaunchResult> => {
    const payload: unknown = await ipcRenderer.invoke(IPC.listenStart)
    return parseLaunchResult(payload)
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
  bridgeSend: async (requestId: string, prompt: string) => {
    const r = (await ipcRenderer.invoke(IPC.bridgeSend, String(requestId), String(prompt))) as { ok?: unknown; reason?: unknown } | null
    return { ok: r?.ok === true, reason: typeof r?.reason === 'string' ? r.reason : '' }
  },
  bridgeCancel: (requestId: string) => ipcRenderer.send(IPC.bridgeCancel, String(requestId)),
  bridgeNew: async () => {
    await ipcRenderer.invoke(IPC.bridgeNew)
  },
  prefsGet: async () => {
    const v: unknown = await ipcRenderer.invoke(IPC.prefsGet)
    return typeof v === 'string' ? v : ''
  },
  prefsSet: async (text: string) => (await ipcRenderer.invoke(IPC.prefsSet, String(text).slice(0, 2000))) === true,
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

function parseOpen(value: unknown): OpenResult {
  const v = (value ?? {}) as { ok?: unknown; target?: unknown; appName?: unknown }
  const target = v.target === 'app' || v.target === 'browser' ? v.target : 'none'
  return { ok: v.ok === true, target, appName: typeof v.appName === 'string' ? v.appName.slice(0, 80) : '' }
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

function parseListings(value: unknown): AppListing[] {
  if (!Array.isArray(value) || value.length > 120) return []
  const apps: AppListing[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object') return []
    const { id, name, installed, familiar, aliases } = item as Partial<AppListing>
    const action = parseActionId(id)
    if (!action || typeof name !== 'string' || name.length === 0 || name.length > 80) return []
    if (typeof installed !== 'boolean' || typeof familiar !== 'boolean' || !Array.isArray(aliases)) return []
    if (aliases.length > 24 || aliases.some((alias) => typeof alias !== 'string' || alias.length > 80)) return []
    apps.push({ id: action, name, installed, familiar, aliases: aliases as string[] })
  }
  return apps
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
  return { phase, session }
}

function parseFollow(value: unknown): FollowEvent | null {
  if (!value || typeof value !== 'object') return null
  const { kind, x, y } = value as Partial<FollowEvent>
  if (kind === 'placed') return { kind }
  if (kind !== 'approach' || typeof x !== 'number' || typeof y !== 'number') return null
  if (!Number.isFinite(x) || !Number.isFinite(y) || Math.abs(x) > 100000 || Math.abs(y) > 100000) return null
  return { kind, x, y }
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
