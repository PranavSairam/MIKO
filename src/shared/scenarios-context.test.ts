/**
 * Multi-turn context/action scenarios (deterministic).
 * Covers app/chat switches, unrelated questions, ambiguous refs, cancel, unsent drafts.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { routeCommand, type CatalogApp } from './commands.ts'
import {
  buildContextSnapshot,
  emptyContext,
  resolveRequestReferences,
  type DraftRef
} from './context.ts'
import { bindPlanToSnapshot, parseInterpretResult, shouldTryInterpreter, tryDeterministicPlan } from './interpret.ts'
import { cancelTask, createTask, recordTaskOutcome, supersedeTask } from './task.ts'
import { newActionId } from './actions.ts'

const apps: CatalogApp[] = [
  { id: 'whatsapp', name: 'WhatsApp', installed: true, familiar: true, aliases: ['whatsapp'] },
  { id: 'chrome', name: 'Chrome', installed: true, familiar: true, aliases: ['chrome'] },
  { id: 'calculator', name: 'Calculator', installed: true, familiar: true, aliases: ['calculator', 'calc'] }
]

describe('scenario: multi-turn context / action layer', () => {
  it('keeps unsent draft refine after an unrelated question in between', () => {
    const draft: DraftRef = {
      text: 'I’ll take you to the movie tomorrow.',
      chatName: 'Gayu Sis',
      insertedText: 'I’ll take you to the movie tomorrow.',
      instruction: 'take her to the movie',
      tone: null,
      updatedAt: Date.now()
    }
    const working = emptyContext()
    working.draft = draft
    working.whatsapp = { header: 'Gayu Sis', verifiedAt: Date.now() }

    // Unrelated general question should not go through WA interpret when no chat cues.
    assert.equal(
      shouldTryInterpreter({ type: 'question' }, 'how tall is the eiffel tower', {
        waChat: 'Gayu Sis',
        messaging: 'whatsapp',
        waDraftActive: true
      }),
      false
    )

    const snap = buildContextSnapshot({
      working,
      platform: 'darwin',
      messaging: 'whatsapp',
      waChat: 'Gayu Sis',
      waDraftActive: true,
      liveDraft: draft
    })
    const shorter = routeCommand('make it shorter', 'typed', apps, [], {
      messaging: 'whatsapp',
      waChat: 'Gayu Sis',
      waDraftActive: true
    })
    assert.equal(shorter.type, 'whatsapp-reply')
    if (shorter.type === 'whatsapp-reply') {
      assert.equal(shorter.intent.refine, true)
      assert.equal(shorter.intent.instruction, 'shorter')
    }
    assert.ok(resolveRequestReferences('make it shorter', snap).some((r) => r.kind === 'draft_refine'))
  })

  it('binds her to the verified chat and clarifies when chat switched away', () => {
    const withChat = buildContextSnapshot({
      working: emptyContext(),
      platform: 'darwin',
      messaging: 'whatsapp',
      waChat: 'Gayu Sis',
      waDraftActive: false
    })
    const plan = parseInterpretResult(
      JSON.stringify({
        steps: [{ kind: 'draft_whatsapp', content: 'the movie is at 3 PM', target: null }],
        clarification: null
      }),
      'tell her the movie is at 3 PM',
      'typed',
      'darwin'
    )
    assert.ok(plan)
    const bound = bindPlanToSnapshot(plan!, withChat)
    assert.equal(bound.steps[0]?.target, 'Gayu Sis')

    const noChat = buildContextSnapshot({
      working: emptyContext(),
      platform: 'darwin',
      messaging: null,
      waChat: null,
      waDraftActive: false
    })
    const unbound = bindPlanToSnapshot(plan!, noChat)
    assert.equal(unbound.steps[0]?.kind, 'clarify')
  })

  it('resolves that file only while a retrieved file is fresh; cancel invalidates the live task', () => {
    const working = emptyContext()
    working.retrievedFile = {
      path: '/tmp/FreshNet.pdf',
      filename: 'FreshNet.pdf',
      bytes: 100,
      chatName: 'V T S MUKUNDAN',
      attachmentId: 'att-1',
      retrievedAt: Date.now(),
      scopeLabel: 'latest-visible'
    }
    const snap = buildContextSnapshot({
      working,
      platform: 'darwin',
      messaging: 'whatsapp',
      waChat: 'V T S MUKUNDAN',
      waDraftActive: false
    })
    assert.ok(snap.retrievedFile)
    const copy = routeCommand('copy that file', 'typed', apps, [], {
      messaging: 'whatsapp',
      waChat: 'V T S MUKUNDAN',
      hasRetrievedFile: true
    })
    assert.equal(copy.type, 'whatsapp-attachment')

    const task = createTask({
      id: newActionId(),
      source: 'typed',
      original: 'copy that file',
      steps: [{ kind: 'copy_file' }],
      clarification: null,
      pending: null
    })
    const cancelled = cancelTask(task, 'Okay. Cancelled.')
    assert.equal(cancelled.phase, 'cancelled')
    assert.ok(cancelled.token > task.token)
    const hist = recordTaskOutcome([], cancelled)
    assert.equal(hist.length, 1)
    assert.equal(hist[0]?.phase, 'cancelled')
  })

  it('supersedes a prior live task when a new plan starts; platform kinds are enforced', () => {
    const prior = createTask({
      id: newActionId(),
      source: 'typed',
      original: 'summarize',
      steps: [{ kind: 'summarize_whatsapp' }],
      clarification: null,
      pending: null
    })
    const superseded = supersedeTask(prior)
    assert.equal(superseded?.phase, 'cancelled')

    const winReject = parseInterpretResult(
      JSON.stringify({
        steps: [{ kind: 'close_browser_tab', target: 'youtube.com' }],
        clarification: null
      }),
      'close that youtube tab',
      'typed',
      'win32'
    )
    assert.equal(winReject, null)

    const darwinOk = parseInterpretResult(
      JSON.stringify({
        steps: [{ kind: 'close_browser_tab', target: 'youtube.com' }],
        clarification: null
      }),
      'close that youtube tab',
      'typed',
      'darwin'
    )
    assert.ok(darwinOk)
  })

  it('compound open+tell remains deterministic; cancel-workflow stays local', () => {
    const plan = tryDeterministicPlan("Open Dad in WhatsApp and tell him I'll call tomorrow", 'typed')
    assert.ok(plan)
    assert.equal(plan!.steps[0]?.kind, 'open_whatsapp_chat')
    assert.equal(plan!.steps[1]?.kind, 'draft_whatsapp')
    assert.equal(plan!.pending?.content, "I'll call tomorrow")
    assert.equal(routeCommand('never mind', 'typed', apps, [], { messaging: 'whatsapp', waDraftActive: true }).type, 'cancel-workflow')
  })

  it('failed-search recovery: correction resumes WhatsApp open; cancel stays local; bare name alone does not', () => {
    const plan = tryDeterministicPlan(
      'Open Santosh Ji in WhatsApp and tell him the meeting moved to 4',
      'typed'
    )
    assert.ok(plan)
    assert.equal(plan!.steps[0]?.target, 'Santosh Ji')
    assert.match(plan!.pending?.content || plan!.steps[1]?.content || '', /meeting moved to 4/i)

    const awaiting = { awaitingWaRecipient: true, messaging: 'whatsapp' as const, assistantActive: true }
    const correction = routeCommand('Santosh G', 'typed', apps, [], awaiting)
    assert.equal(correction.type, 'whatsapp')
    if (correction.type === 'whatsapp') {
      assert.equal(correction.query, 'Santosh G')
      // Correction carries no new draft — the held instruction stays in the pending task.
      assert.equal(correction.pendingDraft, undefined)
    }
    assert.equal(routeCommand('I meant Santosh G', 'typed', apps, [], awaiting).type, 'whatsapp')
    assert.equal(routeCommand('cancel that', 'typed', apps, [], awaiting).type, 'cancel-workflow')
    assert.equal(routeCommand('open calculator', 'typed', apps, [], awaiting).type, 'launch')
    // No pending wait → bare name must not open WhatsApp.
    assert.notEqual(routeCommand('Santosh G', 'typed', apps, [], { assistantActive: true }).type, 'whatsapp')
  })

  it('ambiguous pronoun without chat becomes clarify, not a guessed draft target', () => {
    const plan = parseInterpretResult(
      JSON.stringify({
        steps: [{ kind: 'draft_whatsapp', content: 'running late', target: null }],
        clarification: null
      }),
      'tell her I am running late',
      'voice',
      'darwin'
    )
    assert.ok(plan)
    const bound = bindPlanToSnapshot(
      plan!,
      buildContextSnapshot({
        working: emptyContext(),
        platform: 'darwin',
        messaging: null,
        waChat: null,
        waDraftActive: false
      })
    )
    assert.equal(bound.steps[0]?.kind, 'clarify')
    assert.match(bound.clarification || bound.steps[0]?.content || '', /Which WhatsApp chat|Open the chat/i)
  })
})
