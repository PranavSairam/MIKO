import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'
import { BRIDGE_TEST_PROMPT, assistantInstructions, bridgeResult, emptyBridge, readBridgeEvent } from './bridge.ts'

const lines = (thread: string, text: string) => [
  `{"type":"thread.started","thread_id":"${thread}"}`,
  '{"type":"turn.started"}',
  `{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":${JSON.stringify(text)}}}`,
  '{"type":"turn.completed","usage":{"input_tokens":10,"output_tokens":3}}'
]

describe('bridge events', () => {
  it('succeeds only after the matching reply and turn completion', () => {
    let s = emptyBridge()
    const [a, b, c, d] = lines('t-1', 'MIKO bridge test')
    s = readBridgeEvent(readBridgeEvent(s, a), b)
    assert.equal(bridgeResult(s, null).ok, false, 'no reply yet')
    s = readBridgeEvent(s, c)
    assert.equal(bridgeResult(s, null).ok, false, 'reply but turn not completed')
    s = readBridgeEvent(s, d)
    assert.deepEqual(bridgeResult(s, null), { ok: true, reply: 'MIKO bridge test', thread: 't-1' })
  })
  it('rejects a reply from a different conversation than requested', () => {
    const s = lines('t-other', 'hi').reduce(readBridgeEvent, emptyBridge())
    const r = bridgeResult(s, 't-chosen')
    assert.equal(r.ok, false)
    assert.match(!r.ok ? r.reason : '', /different conversation/)
  })
  it('reports errors and ignores noise', () => {
    let s = readBridgeEvent(emptyBridge(), 'not json')
    s = readBridgeEvent(s, '{"type":"turn.failed","error":{"message":"usage limit reached"}}')
    const r = bridgeResult(s, null)
    assert.equal(r.ok, false)
    assert.match(!r.ok ? r.reason : '', /usage limit/)
  })
  it('keeps the last agent message as the reply', () => {
    const s = [...lines('t', 'first'), '{"type":"item.completed","item":{"type":"agent_message","text":"final"}}'].reduce(readBridgeEvent, emptyBridge())
    assert.equal(s.reply, 'final')
  })
  it('uses the exact test prompt', () => {
    assert.equal(BRIDGE_TEST_PROMPT, 'Reply with MIKO bridge test')
  })
})

describe('assistantInstructions', () => {
  it('is short, has no tools, forbids inventing mail, and adds MIKO preferences', () => {
    const text = assistantInstructions('Call me Pranav.\nI prefer short answers.')
    assert.ok(text.length < 1500, `length ${text.length}`)
    assert.match(text, /no tools/i)
    assert.match(text, /never invent/i)
    assert.match(text, /MIKO preferences/)
    assert.match(text, /I prefer short answers\./)
  })
  it('omits the preferences block when there are none and caps long ones', () => {
    assert.doesNotMatch(assistantInstructions(''), /MIKO preferences/)
    assert.ok(assistantInstructions('x'.repeat(10000)).length < 4000)
  })
})
