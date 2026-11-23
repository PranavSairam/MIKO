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

describe('Interactive GPT: spoken requests with filler and mishearings', () => {
  it('opens for polite or chatty requests ending in the open command', () => {
    for (const phrase of [
      'Nothing much can you open interact ChatGPT',
      'can you open interactive GPT',
      'could you please open the interactive chat GPT',
      'hey miko open interactive gpt',
      'please open inter active GPT',
      'open interact GPT'
    ]) {
      assert.equal(parseInteractiveGptLocalAction(phrase), 'open', phrase)
    }
  })

  it('does not open for questions or prompts that merely mention it', () => {
    for (const phrase of [
      'should I open interactive GPT later?',
      'what is interactive GPT',
      'ask interactive GPT to open my email',
      'how do I interact with ChatGPT'
    ]) {
      assert.equal(parseInteractiveGptLocalAction(phrase), null, phrase)
    }
  })
})

describe('Talk to GPT switch (voice goes to ChatGPT and is sent)', () => {
  it('turns on', () => {
    for (const phrase of ['talk to GPT', 'talk to chat GPT', 'start talking to interactive GPT', 'can you start talk mode', 'chat with ChatGPT', 'talk mode on']) {
      assert.equal(parseInteractiveGptLocalAction(phrase), 'talk-on', phrase)
    }
  })
  it('turns off', () => {
    for (const phrase of ['stop talking to GPT', 'stop talk mode', 'talk mode off', 'end chat with GPT', 'stop talking to chat GPT.']) {
      assert.equal(parseInteractiveGptLocalAction(phrase), 'talk-off', phrase)
    }
  })
  it('does not trigger on ordinary sentences', () => {
    for (const phrase of ['I need to talk to my GPT teacher tomorrow', 'should I chat with GPT about this?', 'talk to mom']) {
      assert.equal(parseInteractiveGptLocalAction(phrase), null, phrase)
    }
  })
})
