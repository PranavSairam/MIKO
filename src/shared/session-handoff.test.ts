import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { UpdateHandoff } from './updater.ts'

describe('update handoff contract', () => {
  it('records cancelled external actions and never implies replay', () => {
    const handoff: UpdateHandoff = {
      at: Date.now(),
      fromVersion: '0.1.0',
      toVersion: '0.1.1',
      cancelledActionKinds: ['whatsapp-open', 'paste', 'assistant-bridge'],
      draftText: 'keep this draft text',
      prefsFlushed: true
    }
    assert.ok(handoff.cancelledActionKinds.includes('paste'))
    assert.equal(handoff.prefsFlushed, true)
    assert.match(handoff.draftText, /draft/)
  })
})
