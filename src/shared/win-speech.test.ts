import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { parseWinSpeechLine, speechHelpUrl, winSpeechProblem } from './win-speech.ts'

describe('Windows speech helper protocol', () => {
  it('reads ready, transcript, error and device lines', () => {
    assert.deepEqual(parseWinSpeechLine('{"ready":true,"recognizer":"en-US"}'), { kind: 'ready', recognizer: 'en-US' })
    assert.deepEqual(parseWinSpeechLine('﻿{"text":" open calculator ","level":30}'), { kind: 'text', text: 'open calculator' })
    assert.deepEqual(parseWinSpeechLine('{"error":"no-audio","detail":"x"}'), { kind: 'error', code: 'no-audio', detail: 'x' })
    assert.deepEqual(parseWinSpeechLine('{"error":"weird"}'), { kind: 'error', code: 'unavailable', detail: '' })
    assert.deepEqual(parseWinSpeechLine('{"devices":["Microphone (USB)"]}'), {
      kind: 'devices',
      devices: ['Microphone (USB)'],
      defaultDevice: '',
      recognizers: []
    })
    assert.deepEqual(parseWinSpeechLine('{"devices":[],"default":"Headset (BT)","recognizers":["en-US","en-IN"]}'), {
      kind: 'devices',
      devices: [],
      defaultDevice: 'Headset (BT)',
      recognizers: ['en-US', 'en-IN']
    })
    assert.deepEqual(parseWinSpeechLine('{"stage":"input","ms":2310.4}'), { kind: 'stage', stage: 'input', ms: 2310 })
    assert.equal(parseWinSpeechLine('{"stage":"other","ms":1}'), null)
    assert.deepEqual(parseWinSpeechLine('{"heard":true}'), { kind: 'heard' })
    assert.equal(parseWinSpeechLine('WARNING: something'), null)
    assert.equal(parseWinSpeechLine('{"text":"   "}'), null)
  })

  it('turns failures into actionable text with the settings page that fixes them', () => {
    assert.equal(winSpeechProblem('denied').help, 'microphone-privacy')
    assert.equal(winSpeechProblem('no-audio').help, 'microphone-privacy')
    assert.match(winSpeechProblem('no-audio').text, /desktop apps/)
    assert.equal(winSpeechProblem('no-device', 'No audio input').help, 'sound-input')
    assert.match(winSpeechProblem('no-device', 'No audio input').text, /No audio input/)
    assert.equal(winSpeechProblem('no-recognizer').help, 'speech-language')
    assert.equal(winSpeechProblem('cancelled').phase, 'cancelled')
    assert.equal(speechHelpUrl('microphone-privacy'), 'ms-settings:privacy-microphone')
    assert.equal(speechHelpUrl('sound-input'), 'ms-settings:sound')
    assert.equal(speechHelpUrl(null), '')
  })
})

describe('listen-win.ps1 (static guards against the old bugs)', () => {
  const script = readFileSync(new URL('../../resources/listen-win.ps1', import.meta.url), 'utf8')
  const code = script
    .split(/\r?\n/)
    .filter((line) => !line.trim().startsWith('#'))
    .join('\n')

  it('reads events in its own scope (no -Action blocks, whose $script: vars never reach the loop)', () => {
    assert.doesNotMatch(code, /Register-ObjectEvent[^\n]*-Action/)
    assert.match(code, /Get-Event/)
  })

  it('never blocks on Peek() and reads stdin asynchronously', () => {
    assert.doesNotMatch(code, /\.Peek\(\)/)
    assert.match(code, /ReadLineAsync\(\)/)
  })

  it('reports ready only after RecognizeAsync started', () => {
    const recognize = code.indexOf('$script:engine.RecognizeAsync($recognizeMode)')
    const ready = code.indexOf('Emit @{ ready = $true')
    assert.ok(recognize > 0 && ready > recognize)
  })

  it('hold mode (Shift + A) keeps listening until stop instead of ending on silence', () => {
    assert.match(code, /RecognizeMode\]::Multiple/)
    assert.match(code, /InitialSilenceTimeout = \[TimeSpan\]::Zero/)
  })

  it('releases the microphone on cancel and at the end', () => {
    assert.match(code, /'cancel'\)\s*\{\s*Cleanup/)
    assert.match(code, /Dispose\(\)/)
  })

  it('reports startup stages and speech-detected without words', () => {
    for (const stage of ['speech-loaded', 'recognizer', 'input', 'recognizing']) assert.match(code, new RegExp(`Stage '${stage}'`))
    assert.match(code, /EventName SpeechDetected/)
    assert.match(code, /Emit @\{ heard = \$true \}/)
  })

  it('reads the Windows default recording device with Core Audio (PreserveSig on every COM method)', () => {
    const cs = code.slice(code.indexOf('public static class MikoDefaultMic'), code.indexOf("'@"))
    assert.match(cs, /GetDefaultAudioEndpoint\(1, 0, out device\)/)
    const methods = cs.match(/\bint \w+\(/g) ?? []
    const preserved = cs.match(/\[PreserveSig\] int \w+\(/g) ?? []
    assert.equal(preserved.length, methods.length)
    assert.doesNotMatch(cs, /\$"|\?\.|nameof\(|=>/, 'C# 5 only (Windows PowerShell 5.1)')
  })

  it('is plain ASCII', () => {
    assert.doesNotMatch(script, /[^\x00-\x7f]/)
  })
})
