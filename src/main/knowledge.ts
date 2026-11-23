import { join } from 'node:path'
import { cp, mkdir } from 'node:fs/promises'
import type { Worker } from 'node:worker_threads'
// Bundled separately by electron-vite (keeps the main bundle's layout unchanged).
import createKnowledgeWorker from './knowledge-worker?nodeWorker'
import { app, dialog, ipcMain, shell, type IpcMainInvokeEvent } from 'electron'
import { IPC, type KnowledgeEvent, type KnowledgeHit } from '../shared/api'
import { KNOWLEDGE_LIMITS, type KnowledgeFileKind } from '../shared/knowledge'
import type { ExtractResult } from './knowledge-extract'
import { KnowledgeStore, type KnowledgeChange } from './knowledge-store'
import { getPetBrowserWindow, isTrustedSender, postToPet } from './pet-window'
import { logDiag } from './diagnostics'
import { sourcePath } from './helper-app'

/**
 * Knowledge in the app: the store lives under userData/knowledge; files are read in a worker
 * thread (one at a time, stopped after a timeout or on Cancel); the pet panel gets state
 * events. Diagnostics log counts and statuses only, never document text or file names.
 */

let store: KnowledgeStore | null = null
let stateTimer: NodeJS.Timeout | null = null
const workers = new Set<Worker>()

function failed(detail: string): ExtractResult {
  return { status: 'unreadable', detail, blocks: [], hash: '', size: 0, chars: 0, truncated: false }
}

function extractInWorker(path: string, kind: KnowledgeFileKind, signal: AbortSignal): Promise<ExtractResult> {
  return new Promise((resolve) => {
    let done = false
    const worker = createKnowledgeWorker({
      workerData: { path, kind },
      resourceLimits: { maxOldGenerationSizeMb: 1024 }
    })
    workers.add(worker)
    const finish = (result: ExtractResult): void => {
      if (done) return
      done = true
      clearTimeout(timer)
      signal.removeEventListener('abort', onAbort)
      workers.delete(worker)
      void worker.terminate()
      resolve(result)
    }
    const timer = setTimeout(() => finish(failed(`Took too long to read (over ${KNOWLEDGE_LIMITS.extractTimeoutMs / 1000} s).`)), KNOWLEDGE_LIMITS.extractTimeoutMs)
    const onAbort = (): void => finish(failed('Cancelled.'))
    signal.addEventListener('abort', onAbort)
    worker.on('message', (msg: { ok: boolean; result?: ExtractResult; error?: string }) => {
      finish(msg.ok && msg.result ? msg.result : failed(`Couldn’t read this file (${msg.error ?? 'reader error'}).`))
    })
    worker.on('error', (error) => finish(failed(`Couldn’t read this file (${String(error.message).slice(0, 120)}).`)))
    worker.on('exit', (code) => {
      if (!done) finish(failed(code === 0 ? 'The reader stopped early.' : 'The reader ran out of memory or crashed on this file.'))
    })
  })
}

function onChange(change: KnowledgeChange): void {
  if (change.type === 'removed') {
    postToPet(IPC.knowledgeEvent, { type: 'removed', ids: change.ids } satisfies KnowledgeEvent)
    return
  }
  if (stateTimer) return
  stateTimer = setTimeout(() => {
    stateTimer = null
    if (store) postToPet(IPC.knowledgeEvent, { type: 'state', state: store.state() } satisfies KnowledgeEvent)
  }, 120)
}

export function knowledgeStore(): KnowledgeStore {
  if (!store) {
    store = new KnowledgeStore(join(app.getPath('userData'), 'knowledge'), extractInWorker, onChange)
    void store.load().then(() => {
      const s = store!.state()
      logDiag('knowledge', 'loaded', { sources: s.sources.length, chunks: s.totalChunks, pending: s.pending })
    })
  }
  return store
}

/** Quit: stop reading (interrupted jobs resume next time) and end worker threads. */
export function stopKnowledge(): void {
  store?.cancel()
  for (const w of workers) void w.terminate()
  workers.clear()
}

function trusted(event: IpcMainInvokeEvent): boolean {
  return isTrustedSender(event.sender.id)
}

function cleanIds(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  return value.filter((v): v is string => typeof v === 'string' && /^[0-9a-f]{16}$/.test(v)).slice(0, 50)
}

async function pick(folder: boolean): Promise<string[]> {
  const parent = getPetBrowserWindow()
  const options: Electron.OpenDialogOptions = folder
    ? { title: 'Add a folder to Knowledge', buttonLabel: 'Add folder', properties: ['openDirectory'] }
    : {
        title: 'Add documents to Knowledge',
        buttonLabel: 'Add',
        properties: ['openFile', 'multiSelections'],
        filters: [{ name: 'Documents (TXT, Markdown, PDF, DOCX)', extensions: ['txt', 'text', 'md', 'markdown', 'pdf', 'docx'] }]
      }
  const res = parent && !parent.isDestroyed() ? await dialog.showOpenDialog(parent, options) : await dialog.showOpenDialog(options)
  return res.canceled ? [] : res.filePaths
}

export function registerKnowledgeIpc(): void {
  ipcMain.handle(IPC.knowledgeState, async (event) => {
    if (!trusted(event)) return null
    await knowledgeStore().load()
    return knowledgeStore().state()
  })
  ipcMain.handle(IPC.knowledgeAdd, async (event, how: unknown, paths: unknown) => {
    if (!trusted(event)) return null
    let list: string[] = []
    if (how === 'files' || how === 'folder') list = await pick(how === 'folder')
    else if (how === 'paths' && Array.isArray(paths)) list = paths.filter((p): p is string => typeof p === 'string' && p.length < 4096).slice(0, 500)
    if (!list.length) return { added: 0, skipped: [], note: '' }
    const res = await knowledgeStore().addPaths(list)
    logDiag('knowledge', 'add', { how: String(how), added: res.added, skipped: res.skipped.length })
    return res
  })
  ipcMain.handle(IPC.knowledgeSample, async (event) => {
    if (!trusted(event)) return null
    const from = sourcePath(join('knowledge-sample', 'MIKO-sample-guide.md'))
    if (!from) return { added: 0, skipped: [], note: 'The sample document isn’t in this build.' }
    const dir = join(app.getPath('userData'), 'knowledge-sample')
    await mkdir(dir, { recursive: true })
    const to = join(dir, 'MIKO-sample-guide.md')
    await cp(from, to, { force: true })
    return knowledgeStore().addPaths([to])
  })
  ipcMain.handle(IPC.knowledgeAction, async (event, action: unknown, id: unknown) => {
    if (!trusted(event)) return false
    const s = knowledgeStore()
    const sid = typeof id === 'string' && /^[0-9a-f]{16}$/.test(id) ? id : undefined
    if (action === 'cancel') s.cancel()
    else if (action === 'retry' && sid) s.retry(sid)
    else if (action === 'refresh') await s.refresh(sid)
    else if (action === 'remove' && sid) await s.remove(sid)
    else if (action === 'clear') await s.clear()
    else if (action === 'consent-on') await s.setConsent(true)
    else if (action === 'consent-off') await s.setConsent(false)
    else return false
    logDiag('knowledge', 'action', { action: String(action) })
    return true
  })
  ipcMain.handle(IPC.knowledgeSearch, async (event, query: unknown, opts: unknown) => {
    if (!trusted(event) || typeof query !== 'string') return []
    await knowledgeStore().load()
    const o = (opts ?? {}) as { sourceIds?: unknown; limit?: unknown; perSource?: unknown }
    const hits = knowledgeStore().search(query.slice(0, 2000), {
      sourceIds: cleanIds(o.sourceIds),
      limit: typeof o.limit === 'number' ? Math.max(1, Math.min(12, o.limit)) : 6,
      perSource: typeof o.perSource === 'number' ? Math.max(1, Math.min(6, o.perSource)) : 3
    })
    return hits.map(
      (h): KnowledgeHit => ({
        chunkId: h.chunk.id,
        sourceId: h.chunk.sourceId,
        name: h.chunk.name,
        page: h.chunk.page,
        heading: h.chunk.heading,
        text: h.chunk.text,
        version: h.chunk.version,
        score: Math.round(h.score * 100) / 100
      })
    )
  })
  ipcMain.handle(IPC.knowledgePassage, (event, chunkId: unknown, version: unknown) => {
    if (!trusted(event) || typeof chunkId !== 'string' || typeof version !== 'string') return { ok: false, reason: 'Not allowed.' }
    return knowledgeStore().passage(chunkId, version)
  })
  ipcMain.handle(IPC.knowledgeOpen, async (event, sourceId: unknown) => {
    if (!trusted(event) || typeof sourceId !== 'string') return { ok: false, reason: 'Not allowed.' }
    const path = knowledgeStore().sourcePath(sourceId)
    if (!path) return { ok: false, reason: 'That document is no longer in Knowledge.' }
    const error = await shell.openPath(path)
    return error ? { ok: false, reason: `Couldn’t open it: ${error}` } : { ok: true, reason: '' }
  })
}
