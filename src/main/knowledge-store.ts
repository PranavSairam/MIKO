import { createHash } from 'node:crypto'
import { lstat, mkdir, readdir, readFile, realpath, rename, rm, stat, unlink, writeFile } from 'node:fs/promises'
import { basename, join, relative, isAbsolute } from 'node:path'
import {
  buildIndex,
  chunkBlocks,
  fileKind,
  KNOWLEDGE_LIMITS,
  searchIndex,
  sensitivePathReason,
  SUPPORTED_FORMATS_LABEL,
  whereLabel,
  type Chunk,
  type IndexedChunk,
  type KnowledgeAddResult,
  type KnowledgeFileKind,
  type KnowledgeIndex,
  type KnowledgeSourceInfo,
  type KnowledgeState,
  type PassagePreview,
  type SearchHit,
  type SourceStatus
} from '../shared/knowledge.ts'
import type { ExtractResult } from './knowledge-extract.ts'

/**
 * Knowledge collection on disk (under the app's userData, never in the project or Git):
 *   sources.json        what was added, status, version (content hash)
 *   chunks/<id>.json    extracted text chunks of the indexed version
 *   settings.json       the owner's consent to send excerpts to the assistant
 * Only files/folders the owner explicitly added are read. Extraction runs through `extract`
 * (a worker thread in the app), one file at a time, cancellable; interrupted jobs resume on load.
 */

export type KnowledgeChange = { type: 'state' } | { type: 'removed'; ids: string[] }
export type Extractor = (path: string, kind: KnowledgeFileKind, signal: AbortSignal) => Promise<ExtractResult>

interface StoredChunks {
  version: string
  chunks: Chunk[]
}

function idFor(realPath: string): string {
  return createHash('sha256').update(realPath).digest('hex').slice(0, 16)
}

function inside(root: string, path: string): boolean {
  const rel = relative(root, path)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

export class KnowledgeStore {
  private sources = new Map<string, KnowledgeSourceInfo>()
  private chunks = new Map<string, IndexedChunk[]>()
  private index: KnowledgeIndex | null = null
  private queue: string[] = []
  private running: Promise<void> | null = null
  private current: { id: string; abort: AbortController } | null = null
  private cancelGen = 0
  private consent = false
  private writes: Promise<void> = Promise.resolve()
  private loading: Promise<void> | null = null
  private adding = new Set<Promise<KnowledgeAddResult>>()

  private readonly dir: string
  private readonly extract: Extractor
  private readonly onChange: (change: KnowledgeChange) => void

  constructor(dir: string, extract: Extractor, onChange: (change: KnowledgeChange) => void = () => undefined) {
    this.dir = dir
    this.extract = extract
    this.onChange = onChange
  }

  // ------------------------------------------------------------ persistence

  private get chunkDir(): string {
    return join(this.dir, 'chunks')
  }

  private async writeJson(name: string, value: unknown): Promise<void> {
    const target = join(this.dir, name)
    const tmp = `${target}.${process.pid}.tmp`
    this.writes = this.writes
      .then(async () => {
        await mkdir(this.dir, { recursive: true })
        await writeFile(tmp, JSON.stringify(value))
        await rename(tmp, target)
      })
      .catch(() => undefined)
    return this.writes
  }

  private persist(): Promise<void> {
    return this.writeJson('sources.json', { v: 1, sources: [...this.sources.values()] })
  }

  /** Loads once; concurrent callers wait for the same load. */
  load(): Promise<void> {
    if (!this.loading) this.loading = this.loadOnce()
    return this.loading
  }

  private async loadOnce(): Promise<void> {
    await mkdir(this.chunkDir, { recursive: true })
    try {
      const raw = JSON.parse(await readFile(join(this.dir, 'sources.json'), 'utf8')) as { sources?: KnowledgeSourceInfo[] }
      for (const s of raw.sources ?? []) if (s && typeof s.id === 'string' && typeof s.path === 'string') this.sources.set(s.id, s)
    } catch {
      /* first run or unreadable index: start empty (the files themselves are untouched) */
    }
    try {
      const raw = JSON.parse(await readFile(join(this.dir, 'settings.json'), 'utf8')) as { cloudConsent?: unknown }
      this.consent = raw.cloudConsent === true
    } catch {
      this.consent = false
    }
    for (const s of this.sources.values()) {
      if (s.status === 'indexed') await this.loadChunks(s)
      // Interrupted while waiting or reading (app quit or crashed): pick it up again.
      if (s.status === 'queued' || s.status === 'indexing') {
        s.status = 'queued'
        s.detail = 'Resuming after an interrupted import.'
        this.queue.push(s.id)
      }
    }
    this.index = null
    if (this.queue.length) this.kick()
  }

  private async loadChunks(s: KnowledgeSourceInfo): Promise<void> {
    try {
      const stored = JSON.parse(await readFile(join(this.chunkDir, `${s.id}.json`), 'utf8')) as StoredChunks
      if (stored.version !== s.version) throw new Error('version mismatch')
      this.chunks.set(
        s.id,
        stored.chunks.map((c) => ({ ...c, id: `${s.id}#${c.n}`, sourceId: s.id, name: s.name, version: s.version }))
      )
    } catch {
      // Index data lost: re-read the file.
      s.status = 'queued'
      s.detail = 'Rebuilding the index for this file.'
      this.queue.push(s.id)
    }
  }

  private async dropChunks(id: string): Promise<void> {
    this.chunks.delete(id)
    this.index = null
    await unlink(join(this.chunkDir, `${id}.json`)).catch(() => undefined)
  }

  // ------------------------------------------------------------ state

  state(): KnowledgeState {
    const sources = [...this.sources.values()].sort((a, b) => b.addedAt - a.addedAt || a.name.localeCompare(b.name))
    return {
      sources,
      pending: sources.filter((s) => s.status === 'queued' || s.status === 'indexing').length,
      totalChunks: [...this.chunks.values()].reduce((n, list) => n + list.length, 0),
      retrieval: 'keyword',
      cloudConsent: this.consent
    }
  }

  async setConsent(on: boolean): Promise<void> {
    this.consent = on
    await this.writeJson('settings.json', { cloudConsent: on })
    this.onChange({ type: 'state' })
  }

  sourcePath(id: string): string | null {
    return this.sources.get(id)?.path ?? null
  }

  // ------------------------------------------------------------ adding

  addPaths(paths: string[]): Promise<KnowledgeAddResult> {
    // The cancel generation is taken now, before any await, so an immediate Cancel applies.
    const job = this.addPathsAt(paths, this.cancelGen)
    this.adding.add(job)
    void job.finally(() => this.adding.delete(job)).catch(() => undefined)
    return job
  }

  private async addPathsAt(paths: string[], gen: number): Promise<KnowledgeAddResult> {
    await this.load()
    const skipped: { path: string; reason: string }[] = []
    const found: { real: string; kind: KnowledgeFileKind | null }[] = []
    let others = 0
    let capped = false
    const push = (real: string, kind: KnowledgeFileKind | null): void => {
      if (found.length >= KNOWLEDGE_LIMITS.maxFilesPerAdd) {
        capped = true
        return
      }
      if (!found.some((f) => f.real === real)) found.push({ real, kind })
    }
    for (const input of paths.slice(0, 1000)) {
      if (typeof input !== 'string' || !input) continue
      const why = sensitivePathReason(input)
      if (why) {
        skipped.push({ path: input, reason: why })
        continue
      }
      let real: string
      try {
        real = await realpath(input)
      } catch {
        skipped.push({ path: input, reason: 'not found' })
        continue
      }
      const info = await stat(real).catch(() => null)
      if (!info) {
        skipped.push({ path: input, reason: 'not found' })
        continue
      }
      if (info.isDirectory()) {
        others += await this.walk(real, push, skipped)
      } else if (info.isFile()) {
        push(real, fileKind(basename(real)))
      }
    }
    if (gen !== this.cancelGen) {
      // Cancelled while the folder was being listed: remember the files as cancelled (Retry adds them).
      for (const f of found) this.upsert(f.real, f.kind, 'cancelled', 'Cancelled before reading. Retry to add it.')
      await this.persist()
      this.onChange({ type: 'state' })
      return { added: 0, skipped, note: 'Cancelled.' }
    }
    let added = 0
    for (const f of found) {
      if (!f.kind) {
        this.upsert(f.real, null, 'unsupported', `Only ${SUPPORTED_FORMATS_LABEL} files can be added.`)
        continue
      }
      const existing = this.sources.get(idFor(f.real))
      const info = await stat(f.real).catch(() => null)
      if (existing && existing.status === 'indexed' && info && info.mtimeMs === existing.mtimeMs && info.size === existing.size) continue
      const s = this.upsert(f.real, f.kind, 'queued', '')
      if (!this.queue.includes(s.id)) this.queue.push(s.id)
      added += 1
    }
    const notes: string[] = []
    if (others) notes.push(`${others} other file${others === 1 ? '' : 's'} skipped (only ${SUPPORTED_FORMATS_LABEL}).`)
    if (capped) notes.push(`Stopped at ${KNOWLEDGE_LIMITS.maxFilesPerAdd} files; add smaller folders for the rest.`)
    await this.persist()
    this.onChange({ type: 'state' })
    this.kick()
    return { added, skipped, note: notes.join(' ') }
  }

  /** Lists supported files under root. Returns how many unsupported files were passed over. */
  private async walk(root: string, push: (real: string, kind: KnowledgeFileKind | null) => void, skipped: { path: string; reason: string }[]): Promise<number> {
    let others = 0
    const stack = [root]
    let visited = 0
    while (stack.length) {
      const dir = stack.pop()!
      if (++visited > 5000) {
        skipped.push({ path: dir, reason: 'folder too deep or too large' })
        break
      }
      let entries: import('node:fs').Dirent[]
      try {
        entries = await readdir(dir, { withFileTypes: true })
      } catch {
        skipped.push({ path: dir, reason: 'no permission to read this folder' })
        continue
      }
      for (const entry of entries) {
        const full = join(dir, entry.name)
        const why = sensitivePathReason(full)
        if (why) {
          skipped.push({ path: full, reason: why })
          continue
        }
        if (entry.name.startsWith('.')) continue
        let target = full
        let isDir = entry.isDirectory()
        let isFile = entry.isFile()
        if (entry.isSymbolicLink()) {
          const real = await realpath(full).catch(() => null)
          if (!real || !inside(root, real)) {
            skipped.push({ path: full, reason: 'link points outside the chosen folder' })
            continue
          }
          const info = await lstat(real).catch(() => null)
          target = real
          isDir = Boolean(info?.isDirectory())
          isFile = Boolean(info?.isFile())
        }
        if (isDir) stack.push(target)
        else if (isFile) {
          const kind = fileKind(entry.name)
          if (kind) push(target, kind)
          else others += 1
        }
      }
    }
    return others
  }

  private upsert(real: string, kind: KnowledgeFileKind | null, status: SourceStatus, detail: string): KnowledgeSourceInfo {
    const id = idFor(real)
    const prev = this.sources.get(id)
    const s: KnowledgeSourceInfo = prev
      ? { ...prev, status, detail }
      : { id, name: basename(real), path: real, kind, size: 0, mtimeMs: 0, version: '', status, detail, chunks: 0, addedAt: Date.now() }
    this.sources.set(id, s)
    return s
  }

  // ------------------------------------------------------------ processing

  private kick(): void {
    if (this.running) return
    this.running = this.run().finally(() => {
      this.running = null
      if (this.queue.length) this.kick()
    })
  }

  /** Resolves when nothing is queued or being read. */
  async whenIdle(): Promise<void> {
    while (this.adding.size) await Promise.allSettled([...this.adding])
    while (this.running) await this.running
    await this.writes
  }

  private async run(): Promise<void> {
    while (this.queue.length) {
      const id = this.queue.shift()!
      const s = this.sources.get(id)
      if (!s || s.status !== 'queued' || !s.kind) continue
      const gen = this.cancelGen
      const abort = new AbortController()
      this.current = { id, abort }
      s.status = 'indexing'
      s.detail = ''
      await this.persist()
      this.onChange({ type: 'state' })
      let res: ExtractResult
      try {
        res = await this.extract(s.path, s.kind, abort.signal)
      } catch (error) {
        res = { status: 'unreadable', detail: String((error as Error)?.message || error).slice(0, 160), blocks: [], hash: '', size: 0, chars: 0, truncated: false }
      }
      this.current = null
      const live = this.sources.get(id)
      if (!live) continue // removed while reading
      if (gen !== this.cancelGen || abort.signal.aborted) {
        this.markCancelled(live)
        await this.persist()
        this.onChange({ type: 'state' })
        continue
      }
      await this.apply(live, res)
      await this.persist()
      this.onChange({ type: 'state' })
    }
  }

  private markCancelled(s: KnowledgeSourceInfo): void {
    if (s.version && this.chunks.has(s.id)) {
      s.status = 'indexed'
      s.detail = 'Refresh cancelled; the previous version is still searchable.'
    } else {
      s.status = 'cancelled'
      s.detail = 'Cancelled. Retry to index it.'
    }
  }

  private async apply(s: KnowledgeSourceInfo, res: ExtractResult): Promise<void> {
    const info = await stat(s.path).catch(() => null)
    s.size = info?.size ?? res.size
    s.mtimeMs = info?.mtimeMs ?? 0
    s.pages = res.pages
    if (res.status !== 'ok') {
      await this.dropChunks(s.id)
      s.status = res.status
      s.detail = res.detail
      s.chunks = 0
      s.version = ''
      return
    }
    const twin = [...this.sources.values()].find((o) => o.id !== s.id && o.status === 'indexed' && o.version === res.hash)
    if (twin) {
      await this.dropChunks(s.id)
      s.status = 'duplicate'
      s.detail = `Same content as “${twin.name}”, so it’s kept once.`
      s.chunks = 0
      s.version = ''
      return
    }
    const chunks = chunkBlocks(res.blocks)
    const others = [...this.chunks.entries()].filter(([id]) => id !== s.id).reduce((n, [, list]) => n + list.length, 0)
    if (others + chunks.length > KNOWLEDGE_LIMITS.maxChunks) {
      await this.dropChunks(s.id)
      s.status = 'too-large'
      s.detail = 'Knowledge is full. Remove some documents to add this one.'
      s.chunks = 0
      s.version = ''
      return
    }
    const removedOld = s.version && s.version !== res.hash
    await mkdir(this.chunkDir, { recursive: true })
    await this.writeJson(join('chunks', `${s.id}.json`), { version: res.hash, chunks } satisfies StoredChunks)
    s.version = res.hash
    s.status = 'indexed'
    s.detail = res.detail
    s.chunks = chunks.length
    s.indexedAt = Date.now()
    this.chunks.set(
      s.id,
      chunks.map((c) => ({ ...c, id: `${s.id}#${c.n}`, sourceId: s.id, name: s.name, version: s.version }))
    )
    this.index = null
    if (removedOld) this.onChange({ type: 'removed', ids: [s.id] })
  }

  // ------------------------------------------------------------ owner actions

  cancel(): void {
    this.cancelGen += 1
    for (const id of this.queue) {
      const s = this.sources.get(id)
      if (s && s.status === 'queued') this.markCancelled(s)
    }
    this.queue = []
    this.current?.abort.abort()
    void this.persist()
    this.onChange({ type: 'state' })
  }

  retry(id: string): void {
    const s = this.sources.get(id)
    if (!s || !s.kind || s.status === 'indexing' || s.status === 'queued') return
    s.status = 'queued'
    s.detail = ''
    if (!this.queue.includes(id)) this.queue.push(id)
    void this.persist()
    this.onChange({ type: 'state' })
    this.kick()
  }

  /** Re-check files (all, or one): missing files are marked; changed files are re-read. */
  async refresh(id?: string): Promise<void> {
    await this.load()
    const list = id ? [this.sources.get(id)].filter((s): s is KnowledgeSourceInfo => Boolean(s)) : [...this.sources.values()]
    for (const s of list) {
      if (s.status === 'queued' || s.status === 'indexing' || !s.kind) continue
      const info = await stat(s.path).catch(() => null)
      if (!info || !info.isFile()) {
        s.status = 'missing'
        s.detail = 'The file was moved or deleted. Remove it here, or put it back and Refresh.'
        this.index = null
        continue
      }
      const changed = info.mtimeMs !== s.mtimeMs || info.size !== s.size
      if (changed || s.status !== 'indexed') {
        s.status = 'queued'
        s.detail = ''
        if (!this.queue.includes(s.id)) this.queue.push(s.id)
      }
    }
    await this.persist()
    this.onChange({ type: 'state' })
    this.kick()
  }

  async remove(id: string): Promise<void> {
    if (this.current?.id === id) this.current.abort.abort()
    this.queue = this.queue.filter((q) => q !== id)
    this.sources.delete(id)
    await this.dropChunks(id)
    await this.persist()
    this.onChange({ type: 'removed', ids: [id] })
    this.onChange({ type: 'state' })
  }

  async clear(): Promise<void> {
    const ids = [...this.sources.keys()]
    this.cancel()
    this.sources.clear()
    this.chunks.clear()
    this.index = null
    await this.writes
    await rm(this.chunkDir, { recursive: true, force: true })
    await mkdir(this.chunkDir, { recursive: true })
    await this.persist()
    this.onChange({ type: 'removed', ids })
    this.onChange({ type: 'state' })
  }

  /** Test hook: leave a source as if the app quit while reading it. */
  async debugMarkInterrupted(id: string): Promise<void> {
    const s = this.sources.get(id)
    if (!s) return
    s.status = 'indexing'
    await this.persist()
  }

  // ------------------------------------------------------------ search

  search(query: string, opts: { sourceIds?: string[]; limit?: number; perSource?: number } = {}): SearchHit[] {
    if (!this.index) {
      const all: IndexedChunk[] = []
      for (const [id, list] of this.chunks) if (this.sources.get(id)?.status === 'indexed') all.push(...list)
      this.index = buildIndex(all)
    }
    return searchIndex(this.index, query, opts)
  }

  /** A passage with a little context, only if it still belongs to the same indexed version. */
  passage(chunkId: string, version: string): PassagePreview {
    const [sourceId, nRaw] = chunkId.split('#')
    const s = sourceId ? this.sources.get(sourceId) : undefined
    if (!s) return { ok: false, reason: 'This document was removed from Knowledge after the answer.' }
    if (s.version !== version || s.status !== 'indexed') {
      return { ok: false, reason: 'This document changed or was removed after the answer, so the passage may no longer be there. Ask again for fresh sources.' }
    }
    const list = this.chunks.get(s.id) ?? []
    const n = Number(nRaw)
    const chunk = list[n]
    if (!chunk) return { ok: false, reason: 'That passage is no longer in the index.' }
    return {
      ok: true,
      reason: '',
      sourceId: s.id,
      name: s.name,
      where: whereLabel(chunk),
      text: chunk.text,
      before: list[n - 1]?.page === chunk.page ? list[n - 1]?.text.slice(-300) : undefined,
      after: list[n + 1]?.page === chunk.page ? list[n + 1]?.text.slice(0, 300) : undefined
    }
  }
}
