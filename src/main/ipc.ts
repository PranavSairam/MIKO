import { app, clipboard, ipcMain, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron'
import { IPC, type AppListing, type HitRect, type LaunchResult, type PanelLayout } from '../shared/api'
import { parseActionId } from '../shared/commands'
import { launchApplication, listApplications } from './apps'
import { openChatGpt, openChatUrl } from './chatgpt'
import { addChat, removeChat, renameChat, type ChatEdit } from '../shared/chatgpt'
import { comeToFront, enableFollow } from './follow'
import { requestClose, watchClose } from './quit'
import { cancelListening, startListening, stopListening } from './speech'
import { openSwitcher, registerSwitcherIpc } from './switcher-window'
import { registerMailIpc } from './mail/ipc'
import { savedChats, setSavedChats, voiceAutoExecute } from './settings'
import {
  currentLayout,
  isTrustedSender,
  movePetBy,
  postToPet,
  setDragActive,
  setHitRects,
  setPanelOpen,
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
}): void {
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

  ipcMain.handle(IPC.launchApp, (event, payload: unknown): Promise<LaunchResult> => {
    if (!trusted(event)) return Promise.resolve({ ok: false, reason: 'That action is not available.' })
    const request = parseLaunch(payload)
    if (!request) return Promise.resolve({ ok: false, reason: 'That action is not available.' })
    return launchApplication(request.id, request.confirm)
  })

  ipcMain.handle(IPC.openChatGpt, (event) => {
    if (!trusted(event)) return { ok: false, target: 'none', appName: '' }
    return openChatGpt()
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
    openSwitcher()
  })

  registerSwitcherIpc()
  registerMailIpc()

  ipcMain.handle(IPC.getVoiceAuto, (event) => (trusted(event) ? voiceAutoExecute() : true))

  ipcMain.on(IPC.quitApp, (event) => {
    if (!trusted(event)) return
    app.quit()
  })

  ipcMain.handle(IPC.listenStart, (event) => {
    if (!trusted(event)) return Promise.resolve({ ok: false, reason: 'Speech recognition is not available.' })
    return startListening()
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
