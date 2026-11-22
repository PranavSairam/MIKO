/**
 * MIKO Lens control + Finder file resolve + ChatGPT file attach.
 * Always verifies the bound CGWindow before input; never targets “whatever is frontmost”.
 */
import { basename } from 'node:path'
import { existsSync, statSync } from 'node:fs'
import { BrowserWindow, dialog, nativeImage } from 'electron'
import { runAx, type AxResult } from './ax'
import { getGptModeState } from './gpt-mode'
import {
  copyFileToClipboard,
  isProvenAttachmentPath,
  listProvenAttachmentPaths,
  revealInFinder
} from './whatsapp-attachments'
import {
  type LensAttachResult,
  type LensFinderSelectionResult,
  type LensPointerRequest,
  type LensPointerResult,
  type LensResolvedFile,
  type LensTypeRequest,
  type LensTypeResult,
  type LensWindowBounds,
  isChatGptOwner,
  isFinderOwner,
  isSpotifyOwner,
  parseCaptureWindowId,
  sanitizeLensFilePath
} from '../shared/lens-control'

/** Bumped to drop in-flight pointer/type work when Control cancels or the source changes. */
let lensInputGeneration = 0

export function cancelLensInput(reason = 'cancelled'): void {
  lensInputGeneration += 1
  void reason
}

type LensPayload = AxResult & {
  activated?: boolean
  windowId?: number
  name?: string
  owner?: string
  bundle?: string
  x?: number
  y?: number
  width?: number
  height?: number
  paths?: string[]
  status?: string
  filename?: string
  path?: string
  verified?: boolean
  composerText?: string
}

async function runLens(args: string[], input?: string, timeoutMs = 10000): Promise<LensPayload> {
  return (await runAx(args, input, timeoutMs)) as LensPayload
}

function boundSourceId(explicit?: string): string {
  const id = (explicit || getGptModeState().captureSourceId || '').trim()
  return id
}

export async function lensWindowBounds(sourceId?: string): Promise<LensWindowBounds | null> {
  if (process.platform !== 'darwin') return null
  const id = boundSourceId(sourceId)
  if (!id || !parseCaptureWindowId(id)) return null
  const payload = await runLens(['lens-window', '--source-id', id], undefined, 6000)
  if (!payload.ok) return null
  const width = Number(payload.width) || 0
  const height = Number(payload.height) || 0
  if (width < 2 || height < 2) return null
  return {
    x: Number(payload.x) || 0,
    y: Number(payload.y) || 0,
    width,
    height,
    windowId: Number(payload.windowId) || parseCaptureWindowId(id) || 0,
    pid: Number(payload.pid) || 0,
    name: String(payload.name || ''),
    owner: String(payload.owner || ''),
    bundle: String(payload.bundle || '')
  }
}

/** One intentional activate of the bound source (Open original). Never used for scroll/move/capture. */
export async function lensOpenOriginal(sourceId?: string): Promise<{ ok: boolean; reason: string; pid: number }> {
  if (process.platform !== 'darwin') {
    return { ok: false, reason: 'Open original isn’t available on this platform.', pid: 0 }
  }
  const bounds = await lensWindowBounds(sourceId)
  if (!bounds || bounds.pid <= 0) {
    return { ok: false, reason: 'Couldn’t verify the bound window.', pid: 0 }
  }
  const payload = await runAx(['focus-info', '--activate', String(bounds.pid)], undefined, 5000)
  if (payload.ok !== true) {
    return {
      ok: false,
      reason: typeof payload.reason === 'string' && payload.reason ? payload.reason.slice(0, 400) : 'Couldn’t bring the original forward.',
      pid: bounds.pid
    }
  }
  return { ok: true, reason: `Brought ${bounds.owner || 'the source'} forward.`, pid: bounds.pid }
}

export async function lensPointer(req: LensPointerRequest): Promise<LensPointerResult> {
  if (process.platform !== 'darwin') {
    return { ok: false, reason: 'Lens control isn’t available on this platform.', activated: false, pid: 0, windowId: 0 }
  }
  const gen = lensInputGeneration
  const state = getGptModeState()
  const sourceId = req.expectSourceId.trim()
  if (!sourceId || sourceId !== (state.captureSourceId || '')) {
    return { ok: false, reason: 'Source changed — control stopped. Choose the window again.', activated: false, pid: 0, windowId: 0 }
  }
  if (!Number.isFinite(req.x) || !Number.isFinite(req.y)) {
    return { ok: false, reason: 'Invalid coordinates.', activated: false, pid: 0, windowId: 0 }
  }
  const action = req.action === 'dblclick' || req.action === 'scroll' ? req.action : 'click'
  const bounds = await lensWindowBounds(sourceId)
  if (gen !== lensInputGeneration) {
    return { ok: false, reason: 'Control cancelled.', activated: false, pid: 0, windowId: 0 }
  }
  if (!bounds) {
    return { ok: false, reason: 'Couldn’t verify the bound window — control stopped.', activated: false, pid: 0, windowId: 0 }
  }
  const spotify =
    isSpotifyOwner(bounds.owner, bounds.name, bounds.bundle) ||
    isSpotifyOwner(state.captureOwner, state.captureSourceName)
  // Spotify Electron ignores reliable background HID; only Control-original handoff is offered.
  if (spotify && req.intent !== 'control-original') {
    return {
      ok: false,
      reason:
        'Spotify isn’t interactive inside the Lens mirror. Use Media controls, or Control original (one handoff to the real window).',
      activated: false,
      pid: bounds.pid,
      windowId: bounds.windowId
    }
  }
  // Never activate on scroll. Clicks/types activate only when the viewer asks explicitly.
  const wantActivate = req.activate === true && action !== 'scroll'
  const args = [
    'lens-pointer',
    '--source-id',
    sourceId,
    '--action',
    action,
    '--x',
    String(req.x),
    '--y',
    String(req.y),
    '--expect-pid',
    String(bounds.pid)
  ]
  if (wantActivate) args.push('--activate')
  if (action === 'scroll') {
    args.push('--dx', String(Math.round(req.dx || 0)), '--dy', String(Math.round(req.dy || 0)))
  }
  const payload = await runLens(args, undefined, 8000)
  if (gen !== lensInputGeneration) {
    return { ok: false, reason: 'Control cancelled.', activated: false, pid: 0, windowId: 0 }
  }
  return {
    ok: payload.ok === true,
    reason:
      typeof payload.reason === 'string' && payload.reason
        ? payload.reason.slice(0, 400)
        : payload.ok
          ? ''
          : 'Pointer action failed.',
    activated: payload.activated === true,
    pid: Number(payload.pid) || bounds.pid,
    windowId: Number(payload.windowId) || bounds.windowId
  }
}

export async function lensType(req: LensTypeRequest): Promise<LensTypeResult> {
  if (process.platform !== 'darwin') {
    return { ok: false, reason: 'Lens typing isn’t available on this platform.', activated: false, pid: 0 }
  }
  const gen = lensInputGeneration
  const state = getGptModeState()
  const sourceId = req.expectSourceId.trim()
  if (!sourceId || sourceId !== (state.captureSourceId || '')) {
    return { ok: false, reason: 'Source changed — control stopped.', activated: false, pid: 0 }
  }
  const text = String(req.text || '').slice(0, 4000)
  if (!text.trim()) return { ok: false, reason: 'Nothing to type.', activated: false, pid: 0 }
  const bounds = await lensWindowBounds(sourceId)
  if (gen !== lensInputGeneration) return { ok: false, reason: 'Control cancelled.', activated: false, pid: 0 }
  if (!bounds) return { ok: false, reason: 'Couldn’t verify the bound window.', activated: false, pid: 0 }
  const spotify =
    isSpotifyOwner(bounds.owner, bounds.name, bounds.bundle) ||
    isSpotifyOwner(state.captureOwner, state.captureSourceName)
  if (spotify && req.intent !== 'control-original') {
    return {
      ok: false,
      reason: 'Spotify typing inside the mirror isn’t supported. Use Control original for the real window.',
      activated: false,
      pid: bounds.pid
    }
  }
  const args = ['lens-type', '--source-id', sourceId, '--expect-pid', String(bounds.pid)]
  if (req.activate === true) args.push('--activate')
  const payload = await runLens(args, text, 10000)
  if (gen !== lensInputGeneration) return { ok: false, reason: 'Control cancelled.', activated: false, pid: 0 }
  return {
    ok: payload.ok === true,
    reason:
      typeof payload.reason === 'string' && payload.reason
        ? payload.reason.slice(0, 400)
        : payload.ok
          ? ''
          : 'Typing failed.',
    activated: payload.activated === true,
    pid: Number(payload.pid) || bounds.pid
  }
}

function fileRow(path: string, provenance: LensResolvedFile['provenance']): LensResolvedFile | null {
  const safe = sanitizeLensFilePath(path)
  if (!safe || !existsSync(safe)) return null
  try {
    const st = statSync(safe)
    if (!st.isFile() || st.size <= 0) return null
    return { path: safe, filename: basename(safe), bytes: st.size, provenance }
  } catch {
    return null
  }
}

export async function lensFinderSelection(sourceId?: string): Promise<LensFinderSelectionResult> {
  if (process.platform !== 'darwin') {
    return { ok: false, reason: 'Finder selection isn’t available on this platform.', files: [] }
  }
  const id = boundSourceId(sourceId)
  const state = getGptModeState()
  if (id && id === (state.captureSourceId || '')) {
    const bounds = await lensWindowBounds(id)
    if (bounds && !isFinderOwner(bounds.owner, bounds.name, bounds.bundle)) {
      return { ok: false, reason: 'Selected files only work when Lens is bound to Finder.', files: [] }
    }
  }
  const args = ['finder-selection']
  if (id) args.push('--source-id', id)
  const payload = await runLens(args, undefined, 10000)
  const paths = Array.isArray(payload.paths) ? payload.paths : []
  const files = paths
    .map((p) => fileRow(String(p), 'finder-selection'))
    .filter((f): f is LensResolvedFile => Boolean(f))
    .slice(0, 20)
  if (!payload.ok || files.length === 0) {
    return {
      ok: false,
      reason:
        typeof payload.reason === 'string' && payload.reason
          ? payload.reason.slice(0, 400)
          : 'No files selected in Finder.',
      files: []
    }
  }
  return { ok: true, reason: payload.reason || `Resolved ${files.length} file(s).`, files }
}

export async function lensPickFiles(parent: BrowserWindow | null): Promise<LensFinderSelectionResult> {
  const opts = {
    title: 'Choose files for MIKO Lens',
    properties: ['openFile', 'multiSelections'] as Array<'openFile' | 'multiSelections'>,
    message: 'Pick real files to copy, drag, or attach. Paths are never guessed from the mirror.'
  }
  const result = parent
    ? await dialog.showOpenDialog(parent, opts)
    : await dialog.showOpenDialog(opts)
  if (result.canceled) return { ok: false, reason: 'Cancelled.', files: [] }
  const files = (result.filePaths || [])
    .map((p) => fileRow(p, 'native-picker'))
    .filter((f): f is LensResolvedFile => Boolean(f))
    .slice(0, 20)
  if (!files.length) return { ok: false, reason: 'No readable files selected.', files: [] }
  return { ok: true, reason: `Picked ${files.length} file(s).`, files }
}

/** Paths accepted this session as verified attachments (WhatsApp save / user accept). */
const lensProvenExtra = new Set<string>()

export function rememberLensProvenPath(path: string): void {
  const row = fileRow(path, 'proven-attachment')
  if (row) lensProvenExtra.add(row.path)
}

export function lensProvenFiles(): LensResolvedFile[] {
  const seen = new Set<string>()
  const out: LensResolvedFile[] = []
  for (const row of listProvenAttachmentPaths()) {
    const file = fileRow(row.path, 'proven-attachment')
    if (!file || seen.has(file.path)) continue
    seen.add(file.path)
    out.push(file)
  }
  for (const path of lensProvenExtra) {
    const file = fileRow(path, 'proven-attachment')
    if (!file || seen.has(file.path)) continue
    seen.add(file.path)
    out.push(file)
  }
  return out.slice(0, 20)
}

export async function lensCopyFile(path: string): Promise<{ ok: boolean; reason: string }> {
  const row = fileRow(path, 'native-picker')
  if (!row) return { ok: false, reason: 'That file isn’t on disk.' }
  const copied = await copyFileToClipboard(row.path)
  return { ok: copied.status === 'copied' && copied.verified, reason: copied.reason }
}

export function lensRevealFile(path: string): boolean {
  const row = fileRow(path, 'native-picker')
  if (!row) return false
  return revealInFinder(row.path)
}

export function lensStartDrag(event: Electron.IpcMainEvent, path: string): { ok: boolean; reason: string } {
  const row = fileRow(path, 'native-picker')
  if (!row) return { ok: false, reason: 'That file isn’t on disk.' }
  try {
    const icon =
      nativeImage.createFromPath(row.path).isEmpty()
        ? nativeImage.createEmpty()
        : nativeImage.createFromPath(row.path)
    event.sender.startDrag({
      file: row.path,
      icon: icon.isEmpty() ? nativeImage.createFromDataURL(
        'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAFElEQVQ4T2NkYGD4z0BUYKDJg1EABQAAJgABdQZx1gAAAABJRU5ErkJggg=='
      ) : icon
    })
    return { ok: true, reason: '' }
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message.slice(0, 200) : 'Native file drag failed.'
    }
  }
}

export async function lensAttachToChatGpt(path: string, sourceId?: string): Promise<LensAttachResult> {
  if (process.platform !== 'darwin') {
    return {
      ok: false,
      status: 'unsupported',
      reason: 'ChatGPT file attach isn’t available on this platform.',
      path: '',
      filename: '',
      verified: false,
      composerText: ''
    }
  }
  const row = fileRow(path, 'native-picker')
  if (!row) {
    return {
      ok: false,
      status: 'failed',
      reason: 'That file isn’t on disk.',
      path: '',
      filename: '',
      verified: false,
      composerText: ''
    }
  }
  const state = getGptModeState()
  const id = (sourceId || state.captureSourceId || '').trim()
  // Prefer binding to the ChatGPT Lens source when present; otherwise open ChatGPT app.
  if (id) {
    const bounds = await lensWindowBounds(id)
    if (bounds && !isChatGptOwner(bounds.owner, bounds.name, bounds.bundle) && !isChatGptOwner(state.captureOwner, state.captureSourceName)) {
      // Finder (or other) source — still allow explicit “Attach to ChatGPT” as a destination action.
    }
  }
  const args = ['paste-file-chatgpt', '--path', row.path]
  if (id && isChatGptOwner(state.captureOwner, state.captureSourceName)) {
    args.push('--source-id', id)
  }
  // No stdin payload — path is on argv so the helper can’t block on stdin.
  const payload = await runLens(args, undefined, 15000)
  const statusRaw = typeof payload.status === 'string' ? payload.status : payload.ok ? 'attached' : 'failed'
  const status = (
    ['attached', 'failed', 'permission', 'lost-focus', 'switched', 'cancelled', 'unsupported'].includes(statusRaw)
      ? statusRaw
      : 'failed'
  ) as LensAttachResult['status']
  return {
    ok: payload.ok === true && status === 'attached' && payload.verified === true,
    status,
    reason:
      typeof payload.reason === 'string' && payload.reason
        ? payload.reason.slice(0, 400)
        : status === 'attached'
          ? 'Attached (unsent).'
          : 'Attach failed.',
    path: row.path,
    filename: row.filename,
    verified: payload.verified === true && status === 'attached',
    composerText: typeof payload.composerText === 'string' ? payload.composerText.slice(0, 4000) : ''
  }
}

/** Register a real on-disk file so Lens can offer it on the shelf. */
export function registerLensFileFromProven(path: string): LensResolvedFile | null {
  const provenance: LensResolvedFile['provenance'] = isProvenAttachmentPath(path)
    ? 'proven-attachment'
    : 'drop'
  const row = fileRow(path, provenance)
  if (!row) return null
  rememberLensProvenPath(row.path)
  return row
}
