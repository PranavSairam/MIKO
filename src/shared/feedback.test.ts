import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  buildDiagnostics,
  buildFeedbackPayload,
  emptyFeedbackDraft,
  formatFeedbackPreview,
  isFeedbackCommand,
  sanitizeErrorCode,
  sanitizeIncomingPayload,
  validateFeedbackDraft
} from './feedback.ts'
import { routeCommand, type CatalogApp } from './commands.ts'

const apps: CatalogApp[] = [
  { id: 'whatsapp', name: 'WhatsApp', installed: true, familiar: true, aliases: ['whatsapp'] }
]

describe('feedback schema and routing', () => {
  it('routes report / give feedback without treating them as questions', () => {
    assert.equal(isFeedbackCommand('report a problem'), true)
    assert.equal(isFeedbackCommand('give feedback'), true)
    assert.equal(isFeedbackCommand('Send feedback.'), true)
    assert.equal(routeCommand('report a problem', 'typed', apps).type, 'feedback')
    assert.equal(routeCommand('give feedback', 'voice', apps).type, 'feedback')
    assert.notEqual(routeCommand('what is feedback?', 'typed', apps).type, 'feedback')
  })

  it('validates drafts and builds a preview without chat/mail bodies', () => {
    const bad = validateFeedbackDraft(emptyFeedbackDraft())
    assert.equal(bad.ok, false)
    const draft = emptyFeedbackDraft({
      kind: 'problem',
      happened: 'Insert failed after chat switch',
      expected: 'A clear error and no send',
      contact: 'friend@example.com',
      includeLastCommand: true,
      lastCommand: 'tell her I am late',
      inviteCode: 'beta-test'
    })
    assert.equal(validateFeedbackDraft(draft).ok, true)
    const diagnostics = buildDiagnostics({
      platform: 'darwin',
      arch: 'arm64',
      actionType: 'whatsapp-reply',
      errorCode: 'wa-reply-failed'
    })
    const payload = buildFeedbackPayload(draft, diagnostics)
    const preview = formatFeedbackPreview(payload)
    assert.match(preview, /What happened/)
    assert.match(preview, /wa-reply-failed/)
    assert.match(preview, /Not included: chat history/)
    assert.equal(payload.diagnostics.actionType, 'whatsapp-reply')
    assert.equal(sanitizeErrorCode('STACK TRACE /tmp/secret'), 'unspecified')
  })

  it('sanitizes inbound payloads and drops non-image screenshots', () => {
    const ok = sanitizeIncomingPayload({
      id: 'fb_abc',
      clientKey: 'ck_abc',
      kind: 'suggestion',
      happened: 'Wish the bird could sit',
      expected: 'Sit pose',
      contact: '',
      lastCommand: null,
      diagnostics: { appVersion: '0.1.0', buildId: 'x', channel: 'private-beta', platform: 'darwin', arch: 'arm64' },
      screenshotDataUrl: 'data:text/plain,nope'
    })
    assert.ok(ok)
    assert.equal(ok?.hasScreenshot, false)
    assert.equal(ok?.screenshotDataUrl, undefined)
  })
})
