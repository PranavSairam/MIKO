import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { cp, mkdtemp, mkdir, readdir, rm, symlink, unlink, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { KnowledgeStore } from './knowledge-store.ts'
import { extractFile } from './knowledge-extract.ts'

const fixtures = join(import.meta.dirname, '..', '..', 'test', 'fixtures', 'knowledge')

let base = ''
let docs = ''
let data = ''

function makeStore(): KnowledgeStore {
  return new KnowledgeStore(data, (path, kind) => extractFile(path, kind))
}

function byName(store: KnowledgeStore, name: string) {
  return store.state().sources.find((s) => s.name === name)
}

describe('knowledge store', () => {
  before(async () => {
    base = await mkdtemp(join(tmpdir(), 'miko-knowledge-'))
    docs = join(base, 'docs')
    data = join(base, 'userData', 'knowledge')
    await cp(fixtures, docs, { recursive: true })
  })
  after(async () => {
    await rm(base, { recursive: true, force: true })
  })

  it('indexes a chosen folder and reports each file’s real status', async () => {
    const store = makeStore()
    await store.load()
    const added = await store.addPaths([docs])
    await store.whenIdle()
    assert.ok(added.added >= 10)
    assert.equal(byName(store, 'falcon-status.txt')?.status, 'indexed')
    assert.equal(byName(store, 'vendor-contract.pdf')?.status, 'indexed')
    assert.equal(byName(store, 'travel-policy.docx')?.status, 'indexed')
    assert.equal(byName(store, 'scanned.pdf')?.status, 'scanned')
    assert.equal(byName(store, 'locked.pdf')?.status, 'encrypted')
    assert.equal(byName(store, 'empty.txt')?.status, 'empty')
    const hits = store.search('Falcon budget')
    assert.equal(hits[0]?.chunk.name, 'falcon-status.txt')
    // Nothing is stuck mid-job.
    assert.ok(store.state().sources.every((s) => s.status !== 'queued' && s.status !== 'indexing'))
  })

  it('does not index the same content twice', async () => {
    const store = makeStore()
    await store.load()
    const copy = join(base, 'copy-of-falcon.txt')
    await cp(join(docs, 'falcon-status.txt'), copy)
    await store.addPaths([copy])
    await store.whenIdle()
    const dup = byName(store, 'copy-of-falcon.txt')
    assert.equal(dup?.status, 'duplicate')
    assert.equal(dup?.chunks, 0)
    // Adding the same path again doesn't create a second source.
    const before = store.state().sources.length
    await store.addPaths([join(docs, 'falcon-status.txt')])
    await store.whenIdle()
    assert.equal(store.state().sources.length, before)
  })

  it('refreshes a changed file and invalidates passages from the old version', async () => {
    const store = makeStore()
    await store.load()
    const old = store.search('Weekly sync Tuesday')[0]!
    await writeFile(join(docs, 'falcon-status.txt'), 'Project Falcon status report\n\nWeekly sync moved to Thursday at 4pm.\n')
    await store.refresh()
    await store.whenIdle()
    // The changed file's old text is gone (a separate copy of the old text may still exist on its own).
    assert.ok(store.search('Tuesday 10am').every((h) => h.chunk.name !== 'falcon-status.txt'))
    assert.match(store.search('weekly sync Thursday')[0]!.chunk.text, /Thursday at 4pm/)
    const stale = store.passage(old.chunk.id, old.chunk.version)
    assert.equal(stale.ok, false)
    assert.match(stale.reason, /changed|removed/i)
  })

  it('marks deleted files missing and leaves them out of search', async () => {
    const store = makeStore()
    await store.load()
    await unlink(join(docs, 'falcon-revised.txt'))
    await store.refresh()
    await store.whenIdle()
    assert.equal(byName(store, 'falcon-revised.txt')?.status, 'missing')
    assert.ok(store.search('vendor delay').every((h) => h.chunk.name !== 'falcon-revised.txt'))
  })

  it('persists across restarts', async () => {
    const store = makeStore()
    await store.load()
    assert.equal(byName(store, 'handbook.md')?.status, 'indexed')
    assert.equal(store.search('paid leave days')[0]?.chunk.name, 'handbook.md')
  })

  it('concurrent loads both see the saved documents', async () => {
    const store = makeStore()
    void store.load()
    await store.load()
    assert.equal(byName(store, 'handbook.md')?.status, 'indexed')
  })

  it('recovers an interrupted job on the next start', async () => {
    const store = makeStore()
    await store.load()
    const id = byName(store, 'handbook.md')!.id
    await store.debugMarkInterrupted(id)
    const again = makeStore()
    await again.load()
    await again.whenIdle()
    assert.equal(byName(again, 'handbook.md')?.status, 'indexed')
  })

  it('cancels queued work without leaving files stuck', async () => {
    const store = makeStore()
    await store.load()
    const extra = join(base, 'more')
    await mkdir(extra)
    for (let i = 0; i < 6; i++) await writeFile(join(extra, `note-${i}.txt`), `Note ${i} about topic zebra${i}.`)
    void store.addPaths([extra])
    store.cancel()
    await store.whenIdle()
    const notes = store.state().sources.filter((s) => s.name.startsWith('note-'))
    assert.ok(notes.every((s) => s.status === 'indexed' || s.status === 'cancelled'), notes.map((s) => s.status).join(','))
    const retried = notes.find((s) => s.status === 'cancelled')
    if (retried) {
      store.retry(retried.id)
      await store.whenIdle()
      assert.equal(store.state().sources.find((s) => s.id === retried.id)?.status, 'indexed')
    }
  })

  it('skips credential files, VCS folders and symlinks that leave the chosen folder', async () => {
    const root = join(base, 'project')
    await mkdir(join(root, '.git'), { recursive: true })
    await writeFile(join(root, '.git', 'notes.txt'), 'secret git notes')
    await writeFile(join(root, '.env'), 'API_KEY=abc')
    await writeFile(join(root, 'readme.md'), '# Readme\n\nThe project codename is Heron.')
    await symlink(join(base, 'copy-of-falcon.txt'), join(root, 'outside-link.txt'))
    const store = makeStore()
    await store.load()
    const res = await store.addPaths([root])
    await store.whenIdle()
    assert.equal(byName(store, 'readme.md')?.status, 'indexed')
    assert.ok(!store.state().sources.some((s) => s.path.includes('.git') || s.name === '.env' || s.name === 'outside-link.txt'))
    assert.ok(res.skipped.some((s) => /outside/.test(s.reason)))
  })

  it('removing a source deletes its text and index entries; clear empties everything', async () => {
    const store = makeStore()
    await store.load()
    const handbook = byName(store, 'handbook.md')!
    const hit = store.search('paid leave')[0]!
    await store.remove(handbook.id)
    assert.equal(byName(store, 'handbook.md'), undefined)
    assert.equal(store.search('paid leave').length, 0)
    assert.equal(store.passage(hit.chunk.id, hit.chunk.version).ok, false)
    assert.ok(!existsSync(join(data, 'chunks', `${handbook.id}.json`)))
    await store.clear()
    assert.equal(store.state().sources.length, 0)
    const left = existsSync(join(data, 'chunks')) ? await readdir(join(data, 'chunks')) : []
    assert.equal(left.length, 0)
  })
})
