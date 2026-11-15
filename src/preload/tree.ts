import { contextBridge, ipcRenderer } from 'electron'

// Sandboxed preloads cannot load shared chunks; channel names are inlined (keep in sync with IPC.petModel).
const PET_MODEL = 'miko:pet-model'
const TREE_SCALE = 'miko:tree-scale'

/** The bird's tree window: it only reads the bird asset (for its Tree node) and its scale. */
contextBridge.exposeInMainWorld('mikoTree', {
  model: async (): Promise<ArrayBuffer | null> => {
    const bytes: unknown = await ipcRenderer.invoke(PET_MODEL, 'bird')
    if (!(bytes instanceof Uint8Array)) return null
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
  },
  onScale: (listener: (unitPx: number) => void): void => {
    ipcRenderer.on(TREE_SCALE, (_event, value: unknown) => {
      if (typeof value === 'number' && Number.isFinite(value)) listener(value)
    })
  }
})
