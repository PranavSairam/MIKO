import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  isInteractiveGptTransferControl,
  looksLikeWhatsAppApp,
  parseInteractiveGptTransferAction,
  selectionUsableForGptTransfer
} from './interactive-gpt-transfer.ts'

describe('Interactive GPT transfer controls', () => {
  it('parses paste clipboard into GPT phrases', () => {
    assert.equal(parseInteractiveGptTransferAction('Paste clipboard into GPT'), 'paste-clipboard')
    assert.equal(parseInteractiveGptTransferAction('please paste the clipboard into Interactive GPT'), 'paste-clipboard')
    assert.equal(parseInteractiveGptTransferAction('Put clipboard into ChatGPT Web'), 'paste-clipboard')
    assert.equal(isInteractiveGptTransferControl('paste clipboard into gpt'), true)
  })

  it('parses copy this WhatsApp message to GPT', () => {
    assert.equal(parseInteractiveGptTransferAction('Copy this WhatsApp message to GPT'), 'wa-message-to-gpt')
    assert.equal(parseInteractiveGptTransferAction('transfer this message to Interactive GPT'), 'wa-message-to-gpt')
    assert.equal(parseInteractiveGptTransferAction('copy this message to gpt'), 'wa-message-to-gpt')
  })

  it('does not intercept quoted or ordinary prompts', () => {
    assert.equal(parseInteractiveGptTransferAction('type exactly: paste clipboard into GPT'), null)
    assert.equal(parseInteractiveGptTransferAction('"paste clipboard into GPT"'), null)
    assert.equal(parseInteractiveGptTransferAction('summarize this chat'), null)
    assert.equal(parseInteractiveGptTransferAction('open WhatsApp'), null)
  })

  it('requires an explicit usable selection for WA→GPT', () => {
    assert.equal(selectionUsableForGptTransfer(null), false)
    assert.equal(selectionUsableForGptTransfer({ ok: false, text: 'hi' }), false)
    assert.equal(selectionUsableForGptTransfer({ ok: true, text: '   ' }), false)
    assert.equal(selectionUsableForGptTransfer({ ok: true, text: 'hello', app: 'WhatsApp' }), true)
    assert.equal(looksLikeWhatsAppApp('‎WhatsApp'), true)
    assert.equal(looksLikeWhatsAppApp('TextEdit'), false)
  })
})
