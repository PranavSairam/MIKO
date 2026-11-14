import { contextBridge, ipcRenderer } from 'electron'

// Sandboxed preloads cannot load shared chunks, so the channel names are inlined
// here instead of importing ../shared/api (keep in sync with IPC.switcher*).
const IPC = {
  switcherList: 'miko:switcher-list',
  switcherFocus: 'miko:switcher-focus',
  switcherQuit: 'miko:switcher-quit',
  switcherTabs: 'miko:switcher-tabs',
  switcherFocusTab: 'miko:switcher-focus-tab',
  switcherClose: 'miko:switcher-close',
  switcherOpened: 'miko:switcher-opened'
} as const
import type { BrowserTab, MikoSwitcherApi, SwitcherApp } from '../shared/switcher'

const api: MikoSwitcherApi = {
  list: async () => {
    const payload: unknown = await ipcRenderer.invoke(IPC.switcherList)
    return Array.isArray(payload) ? (payload as SwitcherApp[]) : []
  },
  focus: async (pid) => (await ipcRenderer.invoke(IPC.switcherFocus, pid)) === true,
  quit: async (pid) => (await ipcRenderer.invoke(IPC.switcherQuit, pid)) === true,
  tabs: async (browser) => {
    const payload = (await ipcRenderer.invoke(IPC.switcherTabs, browser)) as {
      ok?: unknown
      tabs?: unknown
      reason?: unknown
    } | null
    return {
      ok: payload?.ok === true,
      tabs: Array.isArray(payload?.tabs) ? (payload.tabs as BrowserTab[]) : [],
      reason: typeof payload?.reason === 'string' ? payload.reason : ''
    }
  },
  focusTab: async (browser, window, tab) => (await ipcRenderer.invoke(IPC.switcherFocusTab, { browser, window, tab })) === true,
  close: () => ipcRenderer.send(IPC.switcherClose),
  onOpen: (listener) => {
    const wrapped = (): void => listener()
    ipcRenderer.on(IPC.switcherOpened, wrapped)
    return () => ipcRenderer.removeListener(IPC.switcherOpened, wrapped)
  }
}

contextBridge.exposeInMainWorld('mikoSwitcher', api)
