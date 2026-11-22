import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  appendTaskHistory,
  buildContextSnapshot,
  emptyContext,
  hostMatchesSite,
  hostOf,
  isFresh,
  resolveRequestReferences,
  type DraftRef,
  type TaskHistoryEntry
} from './context.ts'

describe('working context helpers', () => {
  it('matches domain boundaries without confusing youtube.com and notyoutube.com', () => {
    assert.equal(hostMatchesSite('www.youtube.com', 'youtube.com'), true)
    assert.equal(hostMatchesSite('m.youtube.com', 'youtube.com'), true)
    assert.equal(hostMatchesSite('notyoutube.com', 'youtube.com'), false)
    assert.equal(hostOf('https://www.youtube.com/watch?v=1'), 'youtube.com')
  })

  it('treats captures as fresh within the window', () => {
    const now = Date.now()
    assert.equal(isFresh(now - 1000, now, 5000), true)
    assert.equal(isFresh(now - 10_000, now, 5000), false)
  })
})

describe('context snapshot + reference resolution', () => {
  const draft: DraftRef = {
    text: 'I’ll take you to the movie tomorrow.',
    chatName: 'Gayu Sis',
    insertedText: 'I’ll take you to the movie tomorrow.',
    instruction: 'take her to the movie tomorrow',
    tone: null,
    updatedAt: Date.now()
  }

  it('builds a fresh snapshot from working context and live flags', () => {
    const working = emptyContext()
    working.whatsapp = { header: 'Gayu Sis', verifiedAt: Date.now() }
    working.retrievedFile = {
      path: '/tmp/report.pdf',
      filename: 'report.pdf',
      bytes: 10,
      chatName: 'Dad',
      attachmentId: 'a1',
      retrievedAt: Date.now(),
      scopeLabel: 'latest-visible'
    }
    const snap = buildContextSnapshot({
      working,
      platform: 'darwin',
      messaging: 'whatsapp',
      waChat: 'Gayu Sis',
      waDraftActive: true,
      liveDraft: draft,
      recentTasks: []
    })
    assert.equal(snap.waChat, 'Gayu Sis')
    assert.equal(snap.waDraftActive, true)
    assert.equal(snap.draft?.chatName, 'Gayu Sis')
    assert.equal(snap.retrievedFile?.filename, 'report.pdf')
  })

  it('resolves her / that file / shorter against verified objects only', () => {
    const working = emptyContext()
    working.retrievedFile = {
      path: '/tmp/report.pdf',
      filename: 'report.pdf',
      bytes: 10,
      chatName: 'Dad',
      attachmentId: 'a1',
      retrievedAt: Date.now(),
      scopeLabel: 'latest-visible'
    }
    const snap = buildContextSnapshot({
      working,
      platform: 'darwin',
      messaging: 'whatsapp',
      waChat: 'Gayu Sis',
      waDraftActive: true,
      liveDraft: draft
    })
    const her = resolveRequestReferences('Also tell her the movie is at 3 PM', snap)
    assert.ok(her.some((r) => r.kind === 'pronoun' && r.pronoun === 'her' && r.chatName === 'Gayu Sis'))

    const file = resolveRequestReferences('copy that file', snap)
    assert.ok(file.some((r) => r.kind === 'file' && r.filename === 'report.pdf'))

    const shorter = resolveRequestReferences('make it shorter', snap)
    assert.ok(shorter.some((r) => r.kind === 'draft_refine' && r.change === 'shorter'))
  })

  it('asks when her has no verified chat and when that file is missing', () => {
    const snap = buildContextSnapshot({
      working: emptyContext(),
      platform: 'darwin',
      messaging: null,
      waChat: null,
      waDraftActive: false
    })
    const her = resolveRequestReferences('tell her I am late', snap)
    assert.ok(her.some((r) => r.kind === 'ambiguous'))
    const file = resolveRequestReferences('attach that file here', snap)
    assert.ok(file.some((r) => r.kind === 'unresolved'))
  })

  it('bounds task history', () => {
    let hist: TaskHistoryEntry[] = []
    for (let i = 0; i < 12; i += 1) {
      hist = appendTaskHistory(hist, {
        id: `t${i}`,
        kinds: ['draft_whatsapp'],
        original: `req ${i}`,
        phase: 'completed',
        summary: `done ${i}`,
        at: i
      })
    }
    assert.equal(hist.length, 8)
    assert.equal(hist[0]?.id, 't4')
    assert.equal(hist[7]?.id, 't11')
  })
})
