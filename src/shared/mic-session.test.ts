import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { MicSessionLog, micSessionLine, micTestPhaseText } from './mic-session.ts'

describe('microphone session log', () => {
  it('records stages, ready and end once per session, with times since the request', () => {
    let now = 1000
    const log = new MicSessionLog(() => now)
    log.start(1, 'tap', 'panel', 'win32')
    now = 1800
    assert.equal(log.stage(1, 'speech-loaded'), 800)
    now = 2600
    assert.equal(log.ready(1, 'en-US'), 1600)
    // A duplicate ready (stale callback) doesn't move the time.
    now = 3000
    assert.equal(log.ready(1, 'en-US'), null)
    now = 3400
    assert.equal(log.heard(1), 2400)
    now = 4000
    assert.equal(log.end(1, 'transcript', { chars: 14 }), true)
    // A second end is a late or duplicate callback: rejected.
    assert.equal(log.end(1, 'failed'), false)
    assert.equal(log.stage(1, 'input'), null)
    const line = micSessionLine(log.get(1)!)
    assert.match(line, /#1 tap panel transcript ready=1600ms heard=2400ms end=3000ms chars=14 lang=en-US \[speech-loaded=800\]/)
  })

  it('never stores the words, only their length', () => {
    const log = new MicSessionLog(() => 0)
    log.start(2, 'test', 'test', 'darwin')
    log.end(2, 'transcript', { chars: 'open calculator'.length })
    const json = JSON.stringify(log.recent())
    assert.doesNotMatch(json, /calculator/)
    assert.match(json, /"chars":15/)
  })

  it('keeps only the last few sessions', () => {
    const log = new MicSessionLog(() => 0)
    for (let id = 1; id <= 12; id += 1) log.start(id, 'tap', 'panel', 'win32')
    assert.deepEqual(log.recent().map((r) => r.id), [5, 6, 7, 8, 9, 10, 11, 12])
    assert.equal(log.get(1), null)
  })

  it('has a plain status line for every test phase', () => {
    for (const phase of ['starting', 'listening', 'hearing', 'processing', 'done', 'error', 'cancelled'] as const) {
      assert.ok(micTestPhaseText(phase, 'win32').length > 3)
    }
    assert.match(micTestPhaseText('listening', 'win32'), /this PC/)
    assert.match(micTestPhaseText('cancelled', 'darwin'), /released/)
  })
})

describe('speech.ts lifecycle (static)', () => {
  const main = readFileSync(new URL('../main/speech.ts', import.meta.url), 'utf8')

  it('a second start while Windows is still starting joins it instead of spawning another helper', () => {
    assert.match(main, /if \(starting\) \{[\s\S]{0,200}return starting/)
  })

  it('the microphone test owns the mic: a normal start during it gets a clear reason', () => {
    assert.match(main, /if \(session\?\.kind === 'test'\) \{\s*return \{ ok: false, reason: 'The microphone test is using the microphone/)
  })

  it('every session ends once; late helper lines are logged as stale, not delivered', () => {
    assert.match(main, /if \(!micLog\.end\(id, outcome, \{ code, chars \}\)\) return false/)
    assert.match(main, /stale transcript ignored/)
    assert.match(main, /stale ready ignored/)
  })

  it('the safety timer reports a reason instead of silently cancelling', () => {
    assert.match(main, /close\('safety-timeout'\)/)
    assert.match(main, /Listening stopped without a result/)
  })

  it('the Mac test no longer runs the words as a command (its own sink, not the speech channel)', () => {
    const body = main.slice(main.indexOf('function runMacMicTest('), main.indexOf('// ---------------------------------------------------------------- Windows'))
    assert.doesNotMatch(body, /IPC\.speech/)
    assert.match(body, /testPhase\('listening'\)/)
  })

  it('diagnostics never include transcript text', () => {
    assert.doesNotMatch(main, /diag\([^)]*text:/)
    assert.doesNotMatch(main, /logDiag\([^)]*line\.text[^.]/)
  })
})
