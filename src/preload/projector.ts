import { contextBridge, ipcRenderer } from 'electron'

// Sandboxed preloads cannot load shared chunks; channel names are inlined (keep in sync with IPC in shared/api.ts).
const C = {
  sources: 'miko:projector-sources',
  select: 'miko:projector-select',
  aspect: 'miko:projector-aspect',
  size: 'miko:projector-size',
  collapse: 'miko:projector-collapse',
  pin: 'miko:projector-pin',
  openOriginal: 'miko:projector-open-original',
  privacy: 'miko:projector-privacy',
  close: 'miko:projector-close'
}

type Source = { id: string; name: string; previewUrl: string; browser: boolean }

/** The video projector window: pick a window, mirror it, a few window controls. Nothing else. */
contextBridge.exposeInMainWorld('mikoProjector', {
  sources: async (): Promise<{ ok: boolean; reason: string; permission: string; sources: Source[] }> => {
    const raw = (await ipcRenderer.invoke(C.sources)) as { ok?: unknown; reason?: unknown; permission?: unknown; sources?: unknown } | null
    const sources = Array.isArray(raw?.sources)
      ? (raw.sources as Source[])
          .filter((s) => s && typeof s.id === 'string' && typeof s.name === 'string')
          .map((s) => ({ id: s.id, name: s.name.slice(0, 120), previewUrl: typeof s.previewUrl === 'string' ? s.previewUrl : '', browser: s.browser === true }))
          .slice(0, 60)
      : []
    return {
      ok: raw?.ok === true,
      reason: typeof raw?.reason === 'string' ? raw.reason.slice(0, 300) : '',
      permission: typeof raw?.permission === 'string' ? raw.permission : '',
      sources
    }
  },
  select: async (id: string): Promise<boolean> => (await ipcRenderer.invoke(C.select, String(id))) === true,
  aspect: (value: number, chrome: number): void => ipcRenderer.send(C.aspect, Number(value), Number(chrome)),
  size: (value: 'small' | 'medium' | 'large'): void => ipcRenderer.send(C.size, value),
  collapse: async (value: boolean): Promise<boolean> => (await ipcRenderer.invoke(C.collapse, value === true)) === true,
  pin: async (value: boolean): Promise<boolean> => (await ipcRenderer.invoke(C.pin, value === true)) === true,
  openOriginal: async (): Promise<{ ok: boolean; reason: string }> => {
    const raw = (await ipcRenderer.invoke(C.openOriginal)) as { ok?: unknown; reason?: unknown } | null
    return { ok: raw?.ok === true, reason: typeof raw?.reason === 'string' ? raw.reason.slice(0, 200) : '' }
  },
  privacy: async (): Promise<boolean> => (await ipcRenderer.invoke(C.privacy)) === true,
  close: (): void => ipcRenderer.send(C.close),
  platform: process.platform
})
