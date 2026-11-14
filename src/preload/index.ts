import { contextBridge, ipcRenderer } from 'electron'
import {
  IPC,
  type AppListing,
  type HitRect,
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
  setPanelOpen: (open: boolean): Promise<PanelLayout> => {
    return ipcRenderer.invoke(IPC.setPanelOpen, open) as Promise<PanelLayout>
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
  openChatGpt: async (): Promise<boolean> => {
    const payload: unknown = await ipcRenderer.invoke(IPC.openChatGpt)
    return payload === true
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
