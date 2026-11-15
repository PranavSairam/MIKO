import { app, clipboard, ipcMain, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron'
import { IPC, type AppListing, type HitRect, type LaunchResult, type PanelLayout } from '../shared/api'
import { parseActionId } from '../shared/commands'
import { launchApplication, listApplications } from './apps'
import { insertIntoChatGpt, openChatGpt, openChatUrl } from './chatgpt'
import { addChat, removeChat, renameChat, type ChatEdit } from '../shared/chatgpt'
import { comeToFront, enableFollow } from './follow'
import { requestClose, watchClose } from './quit'
import { cancelListening, startListening, stopListening } from './speech'
import { openSwitcher, registerSwitcherIpc } from './switcher-window'
import { registerMailIpc } from './mail/ipc'
import { bridgeStatus, cancelBridge, newConversation, sendBridge } from './bridge'
import { armPaste, clipboardSelection, disarmPaste, replaceSelection } from './selection'
import {
  addCorrectionExample,
  correctionExamples,
  mikoPreferences,
  removeCorrectionExample,
  savedChats,
  setMikoPreferences,
  setSavedChats,
  setStructuredPreferences,
  structuredPreferences,
  voiceAutoExecute
} from './settings'
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
import { lastExternalApp } from './foreground'
import { launchChromeFallback, launchChromeProfile, listChromeProfiles } from './chrome-profiles'
import { isValidChromeDirectoryId } from '../shared/chrome-profiles'
import {
  currentLayout,
  isTrustedSender,
  movePetBy,
  postToPet,
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
    return insertIntoChatGpt(prompt, mode === 'append' || mode === 'replace' ? mode : undefined)
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
    openSwitcher()
  })

  registerSwitcherIpc()
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
  ipcMain.handle(IPC.prefsGet, (event) => (trusted(event) ? mikoPreferences() : ''))
  ipcMain.handle(IPC.prefsSet, (event, text: unknown) => (trusted(event) && typeof text === 'string' ? setMikoPreferences(text) : false))
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
