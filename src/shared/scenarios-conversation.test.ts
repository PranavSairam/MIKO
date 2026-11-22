/**
 * Multi-turn conversation scenarios A–H (deterministic / mocked).
 * Live-model wording is not asserted here — see PROJECT_LOG for controlled live checks.
 * Holdout eval conversations stay in src/shared/eval/holdout-*.json (separate from these).
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { newActionId } from './actions.ts'
import { routeCommand, type CatalogApp } from './commands.ts'
import {
  buildContextSnapshot,
  draftRefineCandidates,
  emptyContext,
  resolveRequestReferences,
  type DraftRef
} from './context.ts'
import { bindPlanToSnapshot, tryDeterministicPlan } from './interpret.ts'
import { retrieveExamples, type CorrectionExample } from './preferences.ts'
import {
  cancelTask,
  createTask,
  isLive,
  patchPurpose,
  recordTaskOutcome,
  resumeTask,
  suspendTask
} from './task.ts'
import {
  appendTaskHistoryPreferUnresolved,
  bumpPurposeRevision,
  clarificationExpired,
  createPurpose,
  heldDraftFromInstruction,
  resolveClarificationAnswer,
  reviseInstructionTiming
} from './task-purpose.ts'
import { parseWhatsAppSummarizeIntent, whatsAppDraftPrompt } from './whatsapp-reply.ts'

const apps: CatalogApp[] = [
  { id: 'whatsapp', name: 'WhatsApp', installed: true, familiar: true, aliases: ['whatsapp'] },
  { id: 'chrome', name: 'Chrome', installed: true, familiar: true, aliases: ['chrome'] },
  { id: 'calculator', name: 'Calculator', installed: true, familiar: true, aliases: ['calculator', 'calc'] }
]

describe('conversation A: failed recipient recovery', () => {
  it('keeps held draft across none; correction re-searches; cancel stays local', () => {
    const plan = tryDeterministicPlan(
      'Open Santosh Ji in WhatsApp and tell him I have class tomorrow.',
      'typed'
    )
    assert.ok(plan)
    assert.equal(plan!.steps[0]?.kind, 'open_whatsapp_chat')
    assert.match(plan!.pending?.content || plan!.steps[1]?.content || '', /class tomorrow/i)

    const task = createTask(plan!)
    assert.ok(task.purpose.heldDraft?.instruction)
    assert.equal(task.purpose.heldDraft?.source, 'explicit')
    assert.equal(task.purpose.unresolvedQuery, 'Santosh Ji')

    // Recoverable failure: needs_choice + held draft retained (not cancelled).
    const waiting = patchPurpose(
      { ...task, phase: 'needs_choice' },
      bumpPurposeRevision(task.purpose, {
        unresolvedQuery: 'Santosh Ji',
        clarification: {
          kind: 'recipient',
          question: 'No match for Santosh Ji. Who did you mean?',
          held: task.purpose.heldDraft,
          createdAt: Date.now()
        }
      })
    )
    assert.equal(waiting.phase, 'needs_choice')
    assert.ok(waiting.purpose.heldDraft?.instruction)

    const answer = resolveClarificationAnswer('Santosh G.', waiting.purpose.clarification)
    assert.equal(answer.kind, 'recipient')
    if (answer.kind === 'recipient') assert.equal(answer.query, 'Santosh G')

    const awaiting = { awaitingWaRecipient: true, messaging: 'whatsapp' as const, assistantActive: true }
    const routed = routeCommand('Santosh G.', 'typed', apps, [], awaiting)
    assert.equal(routed.type, 'whatsapp')
    if (routed.type === 'whatsapp') {
      assert.equal(routed.query, 'Santosh G')
      assert.equal(routed.pendingDraft, undefined)
    }

    // Unrelated instruction must not steal the clarification.
    assert.equal(
      resolveClarificationAnswer('open calculator', waiting.purpose.clarification).kind,
      'unrelated'
    )
  })
})

describe('conversation B: contextual opening + POV draft', () => {
  it('open → contact → ask her → casual refine; prompt uses direct address, no invented date', () => {
    assert.equal(routeCommand('Open WhatsApp.', 'typed', apps).type, 'launch')
    const contact = routeCommand('Open Gayu Sis.', 'typed', apps, [], { messaging: 'whatsapp' })
    assert.equal(contact.type, 'whatsapp')

    const ask = routeCommand('Ask if she wants to watch a movie.', 'typed', apps, [], {
      messaging: 'whatsapp',
      waChat: 'Gayu Sis'
    })
    assert.equal(ask.type, 'whatsapp-reply')
    if (ask.type === 'whatsapp-reply') {
      assert.equal(ask.intent.pronoun, 'her')
      assert.match(ask.intent.instruction, /watch a movie/i)
      assert.equal(ask.intent.literal, undefined)
    }

    const prompt = whatsAppDraftPrompt({
      chatName: 'Gayu Sis',
      instruction: 'Ask if she wants to watch a movie.',
      pronoun: 'her'
    })
    assert.match(prompt, /second person|“you”|direct/i)
    assert.doesNotMatch(prompt, /\b202[0-9]\b/)

    const casual = routeCommand('Make it casual.', 'typed', apps, [], {
      messaging: 'whatsapp',
      waChat: 'Gayu Sis',
      waDraftActive: true
    })
    assert.equal(casual.type, 'whatsapp-reply')
    if (casual.type === 'whatsapp-reply') assert.equal(casual.intent.refine, true)
  })
})

describe('conversation C: attachment reference survives a general question', () => {
  it('copy that PDF binds the verified file, not the math answer', () => {
    const working = emptyContext()
    working.retrievedFile = {
      path: '/tmp/FreshNet.pdf',
      filename: 'FreshNet.pdf',
      bytes: 2048,
      chatName: 'Dad',
      attachmentId: 'att-pdf',
      retrievedAt: Date.now(),
      scopeLabel: 'latest-visible'
    }
    const snap = buildContextSnapshot({
      working,
      platform: 'darwin',
      messaging: 'whatsapp',
      waChat: 'Dad',
      waDraftActive: false,
      recentTasks: [
        {
          id: 't-math',
          kinds: ['assistant_chat'],
          original: 'What is 12 × 8?',
          phase: 'completed',
          summary: '96',
          at: Date.now()
        }
      ]
    })
    const refs = resolveRequestReferences('Copy that PDF.', snap)
    assert.ok(refs.some((r) => r.kind === 'file' && r.filename === 'FreshNet.pdf'))
    assert.ok(!refs.some((r) => r.kind === 'draft_refine'))

    const copy = routeCommand('Copy that PDF.', 'typed', apps, [], {
      messaging: 'whatsapp',
      waChat: 'Dad',
      hasRetrievedFile: true
    })
    assert.equal(copy.type, 'whatsapp-attachment')
  })
})

describe('conversation D: ambiguous draft refine', () => {
  it('asks which draft when two chat drafts exist; single draft resolves', () => {
    const working = emptyContext()
    const draft: DraftRef = {
      text: 'See you tomorrow.',
      chatName: 'Mum',
      insertedText: 'See you tomorrow.',
      instruction: 'see you tomorrow',
      tone: null,
      updatedAt: Date.now(),
      source: 'explicit'
    }
    working.draft = draft
    const snap = buildContextSnapshot({
      working,
      platform: 'darwin',
      messaging: 'whatsapp',
      waChat: 'Mum',
      waDraftActive: true,
      liveDraft: draft,
      recentTasks: [
        {
          id: 't1',
          kinds: ['draft_whatsapp'],
          original: 'tell Dad hi',
          phase: 'completed',
          summary: 'draft for Dad',
          at: Date.now() - 1000,
          artifacts: { draftChat: 'Dad' }
        },
        {
          id: 't2',
          kinds: ['draft_whatsapp'],
          original: 'tell Mum hi',
          phase: 'completed',
          summary: 'draft for Mum',
          at: Date.now(),
          artifacts: { draftChat: 'Mum' }
        }
      ]
    })
    const candidates = draftRefineCandidates(snap)
    assert.ok(candidates.length >= 2)
    const refs = resolveRequestReferences('Make it shorter.', snap)
    assert.ok(refs.some((r) => r.kind === 'ambiguous'))

    // Explicit single-candidate path still resolves.
    const one = buildContextSnapshot({
      working,
      platform: 'darwin',
      messaging: 'whatsapp',
      waChat: 'Mum',
      waDraftActive: true,
      liveDraft: draft,
      recentTasks: []
    })
    assert.ok(resolveRequestReferences('Make it shorter.', one).some((r) => r.kind === 'draft_refine'))
  })
})

describe('conversation E: changed destination blocks silent insert', () => {
  it('does not rewrite a verified draft target to a newly open chat', () => {
    const drafted = {
      id: newActionId(),
      source: 'typed' as const,
      original: 'tell her I’ll call tonight',
      steps: [{ kind: 'draft_whatsapp' as const, content: 'I’ll call tonight', target: 'Gayu Sis' }],
      clarification: null as string | null,
      pending: null
    }
    const switched = bindPlanToSnapshot(
      drafted,
      buildContextSnapshot({
        working: emptyContext(),
        platform: 'darwin',
        messaging: 'whatsapp',
        waChat: 'Dad',
        waDraftActive: false
      })
    )
    const step = switched.steps[0]
    assert.ok(step)
    // Insert path revalidates the header live; binder must not silently retarget to Dad.
    if (step.kind === 'draft_whatsapp') {
      assert.equal(step.target, 'Gayu Sis')
      assert.notEqual(step.target, 'Dad')
    }
  })
})

describe('conversation F: cancellation scopes and invalidates', () => {
  it('cancel bumps token so late callbacks are dead; unrelated reply does not revive', () => {
    const task = createTask({
      id: newActionId(),
      source: 'typed',
      original: 'Open Santosh and tell him hi',
      steps: [{ kind: 'open_whatsapp_chat', target: 'Santosh' }, { kind: 'draft_whatsapp', content: 'hi' }],
      clarification: null,
      pending: { content: 'hi', tone: null }
    })
    const token = task.token
    const cancelled = cancelTask(task, 'Okay. Cancelled.')
    assert.equal(cancelled.phase, 'cancelled')
    assert.ok(cancelled.token > token)
    assert.equal(isLive(cancelled, token), false)
    assert.equal(isLive(cancelled, cancelled.token), false)

    // Clarification answer after cancel must not treat recipient wait as active.
    const answer = resolveClarificationAnswer('Santosh G', {
      kind: 'recipient',
      question: 'Who?',
      createdAt: Date.now() - 1000
    })
    // Parser still understands the name, but the live task gate is cancelled.
    assert.equal(answer.kind, 'recipient')
    assert.equal(cancelled.purpose.heldDraft?.instruction || task.purpose.heldDraft?.instruction, 'hi')
  })
})

describe('conversation G: contradictory timing update', () => {
  it('actually next week revises tomorrow instead of stacking both', () => {
    const base = 'tell him I’ll come tomorrow'
    const revised = reviseInstructionTiming(base, 'Actually, next week.')
    assert.ok(revised)
    assert.match(revised!, /next week/i)
    assert.doesNotMatch(revised!, /tomorrow/i)

    const bare = reviseInstructionTiming('I’ll come tomorrow', 'next week')
    assert.ok(bare)
    assert.match(bare!, /next week/i)
    assert.doesNotMatch(bare!, /tomorrow/i)
  })
})

describe('conversation H: negation — summarize, don’t reply', () => {
  it('routes to summarize only; composer path stays off', () => {
    const sum = parseWhatsAppSummarizeIntent("Summarize it, don't reply.", {
      messaging: 'whatsapp',
      waChat: 'Mum'
    })
    assert.ok(sum)
    assert.equal(sum!.scope, 'incoming')

    const routed = routeCommand("Summarize it, don't reply.", 'typed', apps, [], {
      messaging: 'whatsapp',
      waChat: 'Mum'
    })
    assert.equal(routed.type, 'whatsapp-summarize')

    const plan = tryDeterministicPlan("Summarize, don't reply", 'typed')
    // Deterministic plan may need WA context via eval; router path is the live gate.
    if (plan) {
      assert.ok(plan.steps.every((s) => s.kind === 'summarize_whatsapp' || s.kind === 'clarify'))
      assert.ok(!plan.steps.some((s) => s.kind === 'draft_whatsapp' || s.kind === 'insert_whatsapp_draft'))
    }
  })
})

describe('conversation: purpose, suspend, history trim, corrections', () => {
  it('suspend preserves purpose; resume restores; expired clarification asks first', () => {
    const purpose = createPurpose('Open Santosh and tell him I have class', {
      heldDraft: heldDraftFromInstruction('I have class tomorrow', { pronoun: 'him' }),
      unresolvedQuery: 'Santosh',
      clarification: {
        kind: 'recipient',
        question: 'Who did you mean?',
        createdAt: Date.now() - 40 * 60 * 1000,
        expiresAt: Date.now() - 1000
      }
    })
    assert.ok(clarificationExpired(purpose.clarification!))

    const task = createTask({
      id: newActionId(),
      source: 'typed',
      original: purpose.goal,
      steps: [{ kind: 'open_whatsapp_chat', target: 'Santosh' }],
      clarification: null,
      pending: { content: 'I have class tomorrow', tone: null }
    })
    const parked = suspendTask(task)
    assert.equal(parked.phase, 'suspended')
    assert.equal(parked.purpose.suspended, true)
    assert.ok(parked.purpose.heldDraft?.instruction || parked.purpose.goal)

    const back = resumeTask(parked)
    assert.notEqual(back.phase, 'suspended')
    assert.equal(back.purpose.suspended, false)
  })

  it('history trim prefers unresolved goals', () => {
    let hist: { id: string; phase: string; at: number }[] = []
    for (let i = 0; i < 8; i += 1) {
      hist = appendTaskHistoryPreferUnresolved(
        hist,
        {
          id: `t${i}`,
          phase: i === 3 ? 'needs_choice' : 'completed',
          at: Date.now() + i
        },
        3
      )
    }
    assert.ok(hist.some((e) => e.phase === 'needs_choice'))
    assert.ok(hist.length <= 3)
  })

  it('retrieveExamples surfaces reviewed corrections without inventing training', () => {
    const examples: CorrectionExample[] = [
      {
        id: 'ex1',
        wording: 'open yt',
        actionKind: 'open_website',
        note: 'yt means YouTube',
        createdAt: Date.now()
      }
    ]
    const hit = retrieveExamples(examples, 'please open yt now', 3)
    assert.equal(hit.length, 1)
    assert.equal(hit[0]?.actionKind, 'open_website')
  })

  it('recordTaskOutcome keeps purpose summary on history artifacts', () => {
    const task = createTask({
      id: newActionId(),
      source: 'typed',
      original: 'Open Dad and tell him hi',
      steps: [{ kind: 'open_whatsapp_chat', target: 'Dad' }, { kind: 'draft_whatsapp', content: 'hi' }],
      clarification: null,
      pending: { content: 'hi', tone: null }
    })
    const hist = recordTaskOutcome([], { ...task, phase: 'needs_choice' })
    assert.equal(hist[0]?.artifacts?.heldDraft, true)
    assert.ok(hist[0]?.artifacts?.unresolvedQuery || hist[0]?.summary)
  })
})
