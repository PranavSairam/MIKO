/**
 * Windows speech helper protocol (resources/listen-win.ps1). Pure; used by main and tests.
 */

export type WinSpeechError =
  | 'cancelled'
  | 'silence'
  | 'no-audio'
  | 'no-recognizer'
  | 'no-device'
  | 'denied'
  | 'unavailable'

export type WinSpeechLine =
  | { kind: 'ready'; recognizer: string }
  | { kind: 'text'; text: string }
  | { kind: 'error'; code: WinSpeechError; detail: string }
  | { kind: 'devices'; devices: string[]; defaultDevice: string; recognizers: string[] }
  /** Startup timing from the helper (diagnostics only). */
  | { kind: 'stage'; stage: WinSpeechStage; ms: number }
  /** Speech detected (the user is talking); no words. */
  | { kind: 'heard' }

export type WinSpeechStage = 'speech-loaded' | 'recognizer' | 'input' | 'recognizing'
const STAGES: readonly WinSpeechStage[] = ['speech-loaded', 'recognizer', 'input', 'recognizing']

const strings = (value: unknown, max: number, count: number): string[] =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim() !== '').map((item) => item.slice(0, max)).slice(0, count)
    : []

const ERRORS: readonly WinSpeechError[] = ['cancelled', 'silence', 'no-audio', 'no-recognizer', 'no-device', 'denied', 'unavailable']

export function parseWinSpeechLine(line: string): WinSpeechLine | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(line.replace(/^﻿/, '').trim())
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object') return null
  const record = parsed as Record<string, unknown>
  if (record.ready === true) {
    return { kind: 'ready', recognizer: typeof record.recognizer === 'string' ? record.recognizer.slice(0, 20) : '' }
  }
  if (typeof record.text === 'string' && record.text.trim()) {
    return { kind: 'text', text: record.text.trim().slice(0, 400) }
  }
  if (Array.isArray(record.devices)) {
    return {
      kind: 'devices',
      devices: strings(record.devices, 120, 20),
      defaultDevice: typeof record.default === 'string' ? record.default.slice(0, 120) : '',
      recognizers: strings(record.recognizers, 20, 20)
    }
  }
  if (record.heard === true) return { kind: 'heard' }
  if (typeof record.stage === 'string' && (STAGES as readonly string[]).includes(record.stage)) {
    const ms = typeof record.ms === 'number' && Number.isFinite(record.ms) ? Math.max(0, Math.round(record.ms)) : 0
    return { kind: 'stage', stage: record.stage as WinSpeechStage, ms }
  }
  if (typeof record.error === 'string') {
    const code = (ERRORS as readonly string[]).includes(record.error) ? (record.error as WinSpeechError) : 'unavailable'
    return { kind: 'error', code, detail: typeof record.detail === 'string' ? record.detail.slice(0, 300) : '' }
  }
  return null
}

/** Which Windows settings page helps with this failure. */
export type SpeechHelp = 'microphone-privacy' | 'sound-input' | 'speech-language' | null

export interface SpeechProblem {
  /** Phase sent to the panel (existing renderer contract). */
  phase: 'denied' | 'silence' | 'unavailable' | 'cancelled'
  /** Plain, actionable text for the panel. */
  text: string
  help: SpeechHelp
}

export function winSpeechProblem(code: WinSpeechError, detail = ''): SpeechProblem {
  switch (code) {
    case 'cancelled':
      return { phase: 'cancelled', text: 'Stopped listening.', help: null }
    case 'silence':
      return { phase: 'silence', text: 'I didn’t catch any words. Try again and speak right after you click the mic.', help: null }
    case 'no-audio':
      return {
        phase: 'silence',
        text:
          'The microphone sent no sound. Windows may be blocking desktop apps from the microphone, or a different mic is the default input. ' +
          'Check Microphone privacy (“Let desktop apps access your microphone”) and Sound → Input, then Retry.',
        help: 'microphone-privacy'
      }
    case 'no-device':
      return {
        phase: 'unavailable',
        text: `I couldn’t open a microphone${detail ? ` (${detail})` : ''}. Plug one in or choose an input device in Sound settings, then Retry.`,
        help: 'sound-input'
      }
    case 'denied':
      return {
        phase: 'denied',
        text: 'Windows blocked the microphone. Turn on “Let desktop apps access your microphone” in Microphone privacy settings, then Retry.',
        help: 'microphone-privacy'
      }
    case 'no-recognizer':
      return {
        phase: 'unavailable',
        text:
          'Windows has no speech recognizer for MIKO to use. Add a speech language (Settings → Time & language → Speech, e.g. English (United States)), then Retry.',
        help: 'speech-language'
      }
    default:
      return {
        phase: 'unavailable',
        text: `Windows speech recognition couldn’t start${detail ? ` (${detail})` : ''}. Retry, or check Speech settings.`,
        help: 'speech-language'
      }
  }
}

export function speechHelpUrl(help: SpeechHelp): string {
  if (help === 'microphone-privacy') return 'ms-settings:privacy-microphone'
  if (help === 'sound-input') return 'ms-settings:sound'
  if (help === 'speech-language') return 'ms-settings:speech'
  return ''
}
