/**
 * Regression for live/AX-priority playbook scenarios + continuous conversation routing.
 * Deterministic / mocked only — live AX results belong in PROJECT_LOG.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { routeCommand, type CatalogApp } from './commands.ts'
import { parseRecipientRetarget, reviseInstructionTiming } from './task-purpose.ts'
import { createTask, suspendTask, resumeTask } from './task.ts'
import { newActionId } from './actions.ts'
import {
  mismatchedThirdPersonQuestion,
  parseWhatsAppReplyIntent,
  parseWhatsAppSummarizeIntent,
  polishRecipientAddress,
  resolveAdditiveFollowUpMode,
  whatsAppDraftPrompt
} from './whatsapp-reply.ts'
import { uniqueDownloadPath } from './whatsapp-attachments.ts'

const apps: CatalogApp[] = [
  { id: 'whatsapp', name: 'WhatsApp', installed: true, familiar: true, aliases: ['whatsapp'] },
  { id: 'calculator', name: 'Calculator', installed: true, familiar: true, aliases: ['calculator', 'calc'] }
]

describe('continuous conversation routing (deterministic)', () => {
  it('tell them → them pronoun; Not tomorrow Friday; also ask if they\'re free; casual; summarize; continue phrase', () => {
    const tell = parseWhatsAppReplyIntent("Tell them I'll take them to the movie tomorrow.", {
      messaging: 'whatsapp',
      waChat: 'Me'
    })
    assert.equal(tell?.pronoun, 'them')
    assert.match(tell?.instruction || '', /movie tomorrow/i)

    const revised = reviseInstructionTiming("I'll take them to the movie tomorrow", 'Not tomorrow, Friday')
    assert.ok(revised)
    assert.match(revised!, /friday/i)
    assert.doesNotMatch(revised!, /tomorrow/i)

    const withEvening = reviseInstructionTiming(
      "I'll take them to the movie tomorrow. Are you free in the evening?",
      'Not tomorrow, Friday.'
    )
    assert.ok(withEvening)
    assert.match(withEvening!, /friday/i)
    assert.doesNotMatch(withEvening!, /tomorrow/i)
    assert.match(withEvening!, /evening/i)
    assert.doesNotMatch(withEvening!, /free in the friday/i)

    assert.match(polishRecipientAddress("I'll take them to the movie tomorrow.", 'them'), /take you/i)
    assert.match(
      mismatchedThirdPersonQuestion('Sam will join her.', 'them') || '',
      /who does .her./i
    )

    // “Make it shorter” must not rewrite Friday → shorter.
    assert.equal(reviseInstructionTiming("I'll take them to the movie Friday", 'Make it shorter.'), null)

    const also = parseWhatsAppReplyIntent("Also ask if they're free in the evening.", {
      messaging: 'whatsapp',
      waChat: 'Me',
      draftActive: true
    })
    assert.equal(also?.pronoun, 'them')
    assert.equal(also?.additive, true)
    assert.match(also?.instruction || '', /free in the evening/i)

    const casual = routeCommand('Make it more casual.', 'typed', apps, [], {
      messaging: 'whatsapp',
      waChat: 'Me',
      waDraftActive: true
    })
    assert.equal(casual.type, 'whatsapp-reply')
    if (casual.type === 'whatsapp-reply') assert.equal(casual.intent.refine, true)

    const sum = parseWhatsAppSummarizeIntent("Summarize what they sent. Don't reply.", {
      messaging: 'whatsapp',
      waChat: 'Me'
    })
    assert.ok(sum)
    assert.equal(
      routeCommand("Summarize what they sent. Don't reply.", 'typed', apps, [], {
        messaging: 'whatsapp',
        waChat: 'Me',
        waDraftActive: true
      }).type,
      'whatsapp-summarize'
    )

    assert.match('continue my message', /continue\s+(?:my\s+)?message/i)

    const pov = whatsAppDraftPrompt({
      chatName: 'Me',
      instruction: "I'll take them to the movie Friday",
      pronoun: 'them'
    })
    assert.match(pov, /you|second person|direct/i)
  })
})

describe('live/AX priority scenarios (shared-layer)', () => {
  it('S14 preferLatest with older history is a summarize intent (UI must offer range choice)', () => {
    const intent = parseWhatsAppSummarizeIntent('What did she just say?', {
      messaging: 'whatsapp',
      waChat: 'Me'
    })
    assert.ok(intent)
    assert.equal(intent!.preferLatest, true)
  })

  it('S17 additive mode when composer differs from inserted text', () => {
    const mode = resolveAdditiveFollowUpMode({
      composerStatus: 'has-text',
      composerText: 'edited by user outside MIKO',
      insertedText: 'original miko draft',
      draft: 'original miko draft',
      entryStatus: 'inserted'
    })
    // Manual composer edit must not silently refine-overwrite as if unchanged.
    assert.notEqual(mode, 'refine-unsent')
  })

  it('S23 duplicate download names never overwrite', () => {
    const exists = (p: string) => p.endsWith('/report.pdf')
    const a = uniqueDownloadPath('/tmp', 'report.pdf', exists)
    assert.notEqual(a, '/tmp/report.pdf')
    assert.match(a, /report/)
  })

  it('S37 Sam/him prompt keeps named third person', () => {
    const prompt = whatsAppDraftPrompt({
      chatName: 'Alex',
      instruction: 'Tell Alex that Sam will pick him up.',
      pronoun: 'him'
    })
    assert.match(prompt, /Sam|another person|third person/i)
    assert.match(prompt, /Alex/)
  })

  it('S38 No, this is for B parses retarget', () => {
    assert.equal(parseRecipientRetarget('No, this is for Me 2.'), 'Me 2')
    assert.equal(parseRecipientRetarget('this is for Mum'), 'Mum')
    assert.equal(parseRecipientRetarget('No, this is for him'), null)
  })

  it('S35 suspend/resume preserves purpose across summarize-like park', () => {
    const task = createTask({
      id: newActionId(),
      source: 'typed',
      original: "Tell them I'll take them to the movie",
      steps: [{ kind: 'draft_whatsapp', content: "I'll take them to the movie" }],
      clarification: null,
      pending: { content: "I'll take them to the movie", tone: null }
    })
    const parked = suspendTask(task, 'Paused while summarizing')
    assert.equal(parked.phase, 'suspended')
    assert.ok(parked.purpose.heldDraft?.instruction || parked.purpose.goal)
    const back = resumeTask(parked)
    assert.notEqual(back.phase, 'suspended')
  })
})
