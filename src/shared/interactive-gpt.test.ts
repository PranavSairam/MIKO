import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { isInteractiveGptLocalControl, parseInteractiveGptLocalAction } from './interactive-gpt.ts'

describe('Interactive GPT local controls', () => {
  it('opens / shows / hides the workspace', () => {
    assert.equal(parseInteractiveGptLocalAction('Open interactive GPT'), 'open')
    assert.equal(parseInteractiveGptLocalAction('Show ChatGPT Web'), 'show')
    assert.equal(parseInteractiveGptLocalAction('Hide interactive GPT'), 'hide')
    assert.equal(parseInteractiveGptLocalAction('please collapse ChatGPT Web'), 'hide')
    assert.equal(isInteractiveGptLocalControl('open interactive GPT'), true)
  })

  it('arms and cancels Dictate to GPT', () => {
    assert.equal(parseInteractiveGptLocalAction('Dictate to GPT'), 'dictate')
    assert.equal(parseInteractiveGptLocalAction('start dictating into Interactive GPT'), 'dictate')
    assert.equal(parseInteractiveGptLocalAction('stop dictating'), 'stop-dictate')
    assert.equal(parseInteractiveGptLocalAction('cancel dictate to GPT'), 'stop-dictate')
  })

  it('does not intercept quoted or literal prompt text', () => {
    assert.equal(parseInteractiveGptLocalAction('type exactly: open interactive GPT'), null)
    assert.equal(parseInteractiveGptLocalAction('"open interactive GPT for me"'), null)
    assert.equal(parseInteractiveGptLocalAction('ask ChatGPT about interactive GPT windows'), null)
    assert.equal(parseInteractiveGptLocalAction('explain neural networks'), null)
    assert.equal(parseInteractiveGptLocalAction('Dictate into GPT: open WhatsApp'), null)
  })
})

describe('Interactive GPT phrases as Windows dictation writes them', () => {
  it('opens the workspace for spelled-out and bare forms (never the browser path)', () => {
    for (const phrase of ['Open interactive G P T.', 'interactive g.p.t.', 'open the interactive chat GPT', 'Interactive GPT', 'launch interactive gpt window']) {
      assert.equal(parseInteractiveGptLocalAction(phrase), 'open', phrase)
    }
    assert.equal(parseInteractiveGptLocalAction('hide interactive g p t'), 'hide')
  })

  it('leaves plain ChatGPT opens and prompts to the router', () => {
    assert.equal(parseInteractiveGptLocalAction('open chatgpt'), null)
    assert.equal(parseInteractiveGptLocalAction('Ask interactive GPT why the sky is blue'), null)
    assert.equal(parseInteractiveGptLocalAction('open calculator'), null)
  })
})
