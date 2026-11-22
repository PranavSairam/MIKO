import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { routeCommand } from './commands.ts'
import {
  composerMatchesBinding,
  gptDraftBindingFresh,
  isSendItPhrase,
  resolveSendDestination,
  type InteractiveGptDraftBinding
} from './send-destination.ts'
import { buildContextSnapshot, emptyContext } from './context.ts'

const catalog = [{ id: 'notes', name: 'Notes', installed: true, familiar: true, aliases: [] }]

function pendingGpt(partial?: Partial<InteractiveGptDraftBinding>): InteractiveGptDraftBinding {
  return {
    expectedText: 'everything works perfectly',
    insertedAt: Date.now(),
    partition: 'persist:miko-chatgpt-web',
    source: 'dictate',
    generation: 1,
    status: 'pending',
    ...partial
  }
}

describe('isSendItPhrase', () => {
  it('matches bare send / submit drafts', () => {
    assert.equal(isSendItPhrase('Send it'), true)
    assert.equal(isSendItPhrase('please send it.'), true)
    assert.equal(isSendItPhrase('submit this draft'), true)
    assert.equal(isSendItPhrase('send the draft'), true)
  })

  it('rejects send-to-recipient and open WhatsApp', () => {
    assert.equal(isSendItPhrase('send that to Dad'), false)
    assert.equal(isSendItPhrase('Open WhatsApp'), false)
    assert.equal(isSendItPhrase('tell him send it tomorrow'), false)
  })
})

describe('routeCommand send-it', () => {
  it('routes Send it before assistant fallthrough', () => {
    assert.deepEqual(routeCommand('Send it', 'voice', catalog, [], { assistantActive: true }), {
      type: 'send-it'
    })
    // Ordinary open stays local (not send-it / not assistant).
    assert.notEqual(routeCommand('Open WhatsApp', 'voice', catalog).type, 'send-it')
    assert.notEqual(routeCommand('Open WhatsApp', 'voice', catalog).type, 'question')
  })
})

describe('resolveSendDestination', () => {
  it('1. Explicit GPT dictation binding → Interactive GPT', () => {
    const d = resolveSendDestination({
      gptBinding: pendingGpt({ source: 'dictate' }),
      waDraftActive: false
    })
    assert.equal(d.kind, 'interactive-gpt')
    if (d.kind === 'interactive-gpt') assert.equal(d.binding.expectedText, 'everything works perfectly')
  })

  it('2. Old WhatsApp history does not steal destination', () => {
    const working = emptyContext()
    working.interactiveGptDraft = pendingGpt()
    // Completed WA task in history must not create waDraftActive.
    const snap = buildContextSnapshot({
      working,
      platform: 'darwin',
      messaging: null,
      waChat: null,
      waDraftActive: false,
      recentTasks: [
        {
          id: 't1',
          kinds: ['whatsapp-reply'],
          original: 'tell Santhosh hello',
          phase: 'completed',
          summary: 'Drafted to Santhosh',
          at: Date.now() - 60_000,
          artifacts: { draftChat: 'Santhosh', waChat: 'Santhosh' }
        }
      ]
    })
    const d = resolveSendDestination({
      gptBinding: snap.interactiveGptDraft,
      waDraftActive: snap.waDraftActive,
      waDraftChat: snap.draft?.chatName
    })
    assert.equal(d.kind, 'interactive-gpt')
  })

  it('3. Competing pending destinations → clarification', () => {
    const d = resolveSendDestination({
      gptBinding: pendingGpt(),
      waDraftActive: true,
      waDraftChat: 'Santhosh'
    })
    assert.equal(d.kind, 'clarify')
    if (d.kind === 'clarify') {
      assert.match(d.question, /ChatGPT or WhatsApp/i)
      assert.deepEqual(
        d.options.map((o) => o.id),
        ['chatgpt', 'whatsapp']
      )
    }
  })

  it('4. Empty / missing GPT binding with no WA → none', () => {
    assert.equal(
      resolveSendDestination({ gptBinding: null, waDraftActive: false }).kind,
      'none'
    )
    assert.equal(
      resolveSendDestination({
        gptBinding: pendingGpt({ expectedText: '' }),
        waDraftActive: false
      }).kind,
      'none'
    )
  })

  it('5. Cancelled / stale binding → no GPT target', () => {
    assert.equal(
      gptDraftBindingFresh(pendingGpt({ status: 'cancelled' })),
      false
    )
    assert.equal(
      gptDraftBindingFresh(pendingGpt({ insertedAt: Date.now() - 2 * 60 * 60 * 1000 })),
      false
    )
    const d = resolveSendDestination({
      gptBinding: pendingGpt({ status: 'cancelled' }),
      waDraftActive: false
    })
    assert.equal(d.kind, 'none')
  })

  it('preserves WhatsApp unsent policy when only WA draft is active', () => {
    const d = resolveSendDestination({
      gptBinding: null,
      waDraftActive: true,
      waDraftChat: 'Santhosh'
    })
    assert.equal(d.kind, 'whatsapp-unsent')
    if (d.kind === 'whatsapp-unsent') {
      assert.match(d.reason, /unsent/i)
      assert.match(d.reason, /Santhosh/)
    }
  })

  it('workspace visibility alone is not modeled here — no binding means none', () => {
    // Opening Interactive GPT does not create a binding; resolver sees null.
    const d = resolveSendDestination({ gptBinding: null, waDraftActive: false })
    assert.equal(d.kind, 'none')
    assert.match(d.kind === 'none' ? d.reason : '', /Opening Interactive GPT alone/i)
  })
})

describe('composerMatchesBinding', () => {
  it('detects empty, match, and changed', () => {
    const b = pendingGpt({ expectedText: 'hello world' })
    assert.equal(composerMatchesBinding('', b), 'empty')
    assert.equal(composerMatchesBinding('hello world', b), 'match')
    assert.equal(composerMatchesBinding('prior hello world', b), 'match')
    assert.equal(composerMatchesBinding('something else', b), 'changed')
  })
})
