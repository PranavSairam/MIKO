/**
 * Schema-validated interpreter helpers (no paid model calls).
 * Fixture parses validate the schema gate — they are not model accuracy.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  parseInterpretResult,
  tryDeterministicPlan,
  interpretPrompt,
  shouldTryInterpreter
} from './interpret.ts'
import { availableKinds } from './capabilities.ts'

describe('interpret schema + deterministic plans', () => {
  it('accepts allowlisted JSON plans and rejects unknown kinds / shell payloads', () => {
    const ok = parseInterpretResult(
      JSON.stringify({
        steps: [{ kind: 'open_website', target: 'youtube.com', url: 'https://www.youtube.com/', browser: 'chrome' }],
        clarification: null
      }),
      'boot up youtube',
      'typed'
    )
    assert.ok(ok)
    assert.equal(ok!.steps[0]?.kind, 'open_website')
    assert.equal(ok!.steps[0]?.url, 'https://www.youtube.com/')

    const bad = parseInterpretResult(
      JSON.stringify({ steps: [{ kind: 'run_shell', content: 'rm -rf /' }], clarification: null }),
      'hack',
      'typed'
    )
    assert.equal(bad, null)

    const clarify = parseInterpretResult(
      JSON.stringify({ steps: [{ kind: 'clarify' }], clarification: 'Which chat?' }),
      'ping them',
      'typed'
    )
    assert.ok(clarify)
    assert.equal(clarify!.clarification, 'Which chat?')
  })

  it('parses fenced JSON and builds a capability-aware interpret prompt', () => {
    const plan = parseInterpretResult(
      '```json\n{"steps":[{"kind":"summarize_whatsapp","scope":"incoming"}],"clarification":null}\n```',
      'summarize',
      'voice'
    )
    assert.ok(plan)
    assert.equal(plan!.steps[0]?.kind, 'summarize_whatsapp')
    assert.equal(plan!.steps[0]?.scope, 'incoming')

    const prompt = interpretPrompt('get rid of every youtube tab', {
      platform: 'darwin',
      waChat: null,
      lastWebsite: 'YouTube',
      preferredBrowser: 'chrome',
      examples: [{ id: '1', wording: 'kill yt tabs', actionKind: 'close_website', createdAt: 1 }],
      preferences: {
        preferredBrowser: 'chrome',
        writingTone: 'natural',
        preferredLanguage: null,
        notes: '',
        defaultChromeProfileDirectory: null,
        defaultChromeProfileName: null,
        chromeProfileAliases: []
      }
    })
    assert.match(prompt, /close_website/)
    assert.match(prompt, /kill yt tabs/)
    for (const kind of availableKinds('darwin')) {
      if (['open_website', 'close_website', 'draft_whatsapp', 'clarify'].includes(kind)) {
        assert.match(prompt, new RegExp(kind))
      }
    }
  })

  it('builds a deterministic open+tell plan without eating the message', () => {
    const plan = tryDeterministicPlan(
      "Open Dad in WhatsApp and tell him I'll visit next month, professionally.",
      'typed'
    )
    assert.ok(plan)
    assert.equal(plan!.steps[0]?.kind, 'open_whatsapp_chat')
    assert.equal(plan!.steps[0]?.target, 'Dad')
    assert.equal(plan!.steps[1]?.kind, 'draft_whatsapp')
    assert.match(plan!.steps[1]?.content || '', /visit next month/i)
    assert.equal(plan!.steps[1]?.tone, 'professional')
  })

  it('builds ping/nudge WA compound plans with tone and send negation', () => {
    const ping = tryDeterministicPlan(
      "ping Dad on WA that I'll drop by next month, keep it proper",
      'typed'
    )
    assert.ok(ping)
    assert.equal(ping!.steps[0]?.kind, 'open_whatsapp_chat')
    assert.equal(ping!.steps[0]?.target, 'Dad')
    assert.equal(ping!.steps[1]?.kind, 'draft_whatsapp')

    const nudge = tryDeterministicPlan(
      'nudge Mum on whatsapp that dinner is at 8, keep it polite',
      'typed'
    )
    assert.ok(nudge)
    assert.equal(nudge!.steps[0]?.target, 'Mum')
    assert.equal(nudge!.steps[1]?.tone, 'polite')

    const nosend = tryDeterministicPlan(
      "ping Dad on WA that I'll visit but don't send it",
      'typed'
    )
    assert.ok(nosend)
    assert.equal(nosend!.steps[1]?.negations?.send, true)
    assert.match(nosend!.steps[1]?.content || '', /visit/i)
  })

  it('gates the AI interpreter for unknowns and context-bound questions only', () => {
    assert.equal(shouldTryInterpreter({ type: 'unknown' }, 'boot up something weird'), true)
    assert.equal(
      shouldTryInterpreter({ type: 'question' }, "what's the scoop on that chat", { waChat: 'Mum' }),
      true
    )
    assert.equal(
      shouldTryInterpreter({ type: 'question' }, 'make the draft briefer', { waDraftActive: true }),
      true
    )
    assert.equal(
      shouldTryInterpreter({ type: 'question' }, 'how tall is the eiffel tower'),
      false
    )
    assert.equal(shouldTryInterpreter({ type: 'open-url' }, 'open youtube'), false)
  })
})
