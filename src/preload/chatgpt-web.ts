/**
 * Preload for Interactive GPT chrome only (local shell).
 * Guest chatgpt.com has no preload and must never get these APIs.
 */
import { contextBridge, ipcRenderer } from 'electron'

const IPC = {
  status: 'miko:chatgpt-web-status',
  close: 'miko:chatgpt-web-close',
  collapse: 'miko:chatgpt-web-collapse',
  expand: 'miko:chatgpt-web-expand',
  back: 'miko:chatgpt-web-back',
  forward: 'miko:chatgpt-web-forward',
  reload: 'miko:chatgpt-web-reload',
  chromeHeight: 'miko:chatgpt-web-chrome-height',
  insertTranscript: 'miko:chatgpt-web-insert-transcript',
  pasteClipboard: 'miko:chatgpt-web-paste-clipboard',
  download: 'miko:chatgpt-web-download',
  downloadEvent: 'miko:chatgpt-web-download-event',
  pin: 'miko:chatgpt-web-pin',
  stateEvent: 'miko:chatgpt-web-state',
  dragActive: 'miko:chatgpt-web-drag-active',
  expandFromDrag: 'miko:chatgpt-web-expand-from-drag',
  dictateArm: 'miko:chatgpt-web-dictate-arm',
  retry: 'miko:chatgpt-web-retry',
  openBrowser: 'miko:chatgpt-web-open-browser',
  openBlocked: 'miko:chatgpt-web-open-blocked',
  dismissBlocked: 'miko:chatgpt-web-dismiss-blocked'
} as const

contextBridge.exposeInMainWorld('mikoChatGptWeb', {
  status: () => ipcRenderer.invoke(IPC.status),
  close: () => ipcRenderer.invoke(IPC.close),
  collapse: () => ipcRenderer.invoke(IPC.collapse),
  expand: () => ipcRenderer.invoke(IPC.expand),
  back: () => ipcRenderer.invoke(IPC.back),
  forward: () => ipcRenderer.invoke(IPC.forward),
  reload: () => ipcRenderer.invoke(IPC.reload),
  retry: () => ipcRenderer.invoke(IPC.retry),
  openInBrowser: () => ipcRenderer.invoke(IPC.openBrowser),
  openBlocked: () => ipcRenderer.invoke(IPC.openBlocked),
  dismissBlocked: () => ipcRenderer.invoke(IPC.dismissBlocked),
  setPinned: (pinned: boolean) => ipcRenderer.invoke(IPC.pin, pinned === true),
  setChromeHeight: (height: number) => ipcRenderer.invoke(IPC.chromeHeight, height),
  setDragActive: (active: boolean) => ipcRenderer.invoke(IPC.dragActive, active === true),
  expandFromDrag: () => ipcRenderer.invoke(IPC.expandFromDrag),
  dictateArm: (armed: boolean) => ipcRenderer.invoke(IPC.dictateArm, armed === true),
  insertTranscript: (text: string) => ipcRenderer.invoke(IPC.insertTranscript, String(text).slice(0, 8000)),
  pasteClipboard: () => ipcRenderer.invoke(IPC.pasteClipboard),
  lastDownload: () => ipcRenderer.invoke(IPC.download),
  onDownload: (handler: (info: unknown) => void) => {
    const listener = (_: Electron.IpcRendererEvent, info: unknown): void => handler(info)
    ipcRenderer.on(IPC.downloadEvent, listener)
    return () => ipcRenderer.removeListener(IPC.downloadEvent, listener)
  },
  onState: (handler: (info: unknown) => void) => {
    const listener = (_: Electron.IpcRendererEvent, info: unknown): void => handler(info)
    ipcRenderer.on(IPC.stateEvent, listener)
    return () => ipcRenderer.removeListener(IPC.stateEvent, listener)
  }
})
