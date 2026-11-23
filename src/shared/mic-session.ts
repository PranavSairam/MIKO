/**
 * Microphone session bookkeeping for diagnostics (pure; used by main and tests).
 *
 * Every capture gets a session id. Each step (start, helper stages, ready, heard, end)
 * is recorded with its time since the session started, so a duplicate start, a stale
 * callback or a slow helper shows up in the log. Never audio and never the words:
 * a transcript is recorded only as its length.
 */

export type MicMode = 'tap' | 'hold' | 'test'
export type MicSource = 'panel' | 'keys' | 'tray' | 'test' | 'unknown'

/** What the microphone test card shows while it runs. */
export type MicTestPhase = 'starting' | 'listening' | 'hearing' | 'processing' | 'done' | 'error' | 'cancelled'

export interface MicTestPhaseEvent {
  phase: MicTestPhase
  /** Short status line for the card. */
  detail: string
}

export type MicOutcome =
  | 'transcript'
  | 'silence'
  | 'no-audio'
  | 'denied'
  | 'unavailable'
  | 'no-recognizer'
  | 'no-device'
  | 'cancelled'
  | 'ready-timeout'
  | 'helper-exit'
  | 'safety-timeout'
  | 'failed'

export interface MicSessionRecord {
  id: number
  mode: MicMode
  source: MicSource
  platform: string
  /** Epoch ms when the session was requested. */
  startedAt: number
  /** Helper stage → ms since the session was requested. */
  stages: Record<string, number>
  readyMs: number | null
  heardMs: number | null
  endMs: number | null
  outcome: MicOutcome | null
  /** Error code from the helper, if any. */
  code: string
  /** Transcript length only. */
  chars: number
  recognizer: string
  /** Default input device name (Windows), when it was read. */
  device: string
}

const KEEP = 8

export class MicSessionLog {
  private records: MicSessionRecord[] = []
  private readonly now: () => number

  constructor(now: () => number = () => Date.now()) {
    this.now = now
  }

  start(id: number, mode: MicMode, source: MicSource, platform: string): MicSessionRecord {
    const record: MicSessionRecord = {
      id,
      mode,
      source,
      platform,
      startedAt: this.now(),
      stages: {},
      readyMs: null,
      heardMs: null,
      endMs: null,
      outcome: null,
      code: '',
      chars: 0,
      recognizer: '',
      device: ''
    }
    this.records = [...this.records.slice(-(KEEP - 1)), record]
    return record
  }

  get(id: number): MicSessionRecord | null {
    return this.records.find((record) => record.id === id) ?? null
  }

  private since(record: MicSessionRecord): number {
    return Math.max(0, this.now() - record.startedAt)
  }

  stage(id: number, stage: string): number | null {
    const record = this.get(id)
    if (!record || record.endMs !== null) return null
    const ms = this.since(record)
    record.stages[stage.slice(0, 24)] = ms
    return ms
  }

  ready(id: number, recognizer = ''): number | null {
    const record = this.get(id)
    if (!record || record.endMs !== null || record.readyMs !== null) return null
    record.readyMs = this.since(record)
    record.recognizer = recognizer.slice(0, 20)
    return record.readyMs
  }

  heard(id: number): number | null {
    const record = this.get(id)
    if (!record || record.endMs !== null || record.heardMs !== null) return null
    record.heardMs = this.since(record)
    return record.heardMs
  }

  setDevice(id: number, device: string): void {
    const record = this.get(id)
    if (record) record.device = device.slice(0, 120)
  }

  /**
   * Close the session once. A second end (a late or duplicate callback) returns
   * false so the caller can log it as stale instead of delivering it again.
   */
  end(id: number, outcome: MicOutcome, extra: { code?: string; chars?: number } = {}): boolean {
    const record = this.get(id)
    if (!record || record.endMs !== null) return false
    record.endMs = this.since(record)
    record.outcome = outcome
    record.code = (extra.code ?? '').slice(0, 24)
    record.chars = Math.max(0, Math.round(extra.chars ?? 0))
    return true
  }

  recent(): MicSessionRecord[] {
    return this.records.map((record) => ({ ...record, stages: { ...record.stages } }))
  }
}

/** A one-line, transcript-free summary for the diagnostics log and feedback. */
export function micSessionLine(record: MicSessionRecord): string {
  const stages = Object.entries(record.stages)
    .map(([name, ms]) => `${name}=${ms}`)
    .join(' ')
  const parts = [
    `#${record.id}`,
    record.mode,
    record.source,
    record.outcome ?? 'open',
    record.code ? `code=${record.code}` : '',
    record.readyMs !== null ? `ready=${record.readyMs}ms` : '',
    record.heardMs !== null ? `heard=${record.heardMs}ms` : '',
    record.endMs !== null ? `end=${record.endMs}ms` : '',
    record.chars ? `chars=${record.chars}` : '',
    record.recognizer ? `lang=${record.recognizer}` : '',
    record.device ? `device="${record.device}"` : '',
    stages ? `[${stages}]` : ''
  ]
  return parts.filter(Boolean).join(' ')
}

/** The test card's status line for each phase. */
export function micTestPhaseText(phase: MicTestPhase, platform: string): string {
  const here = platform === 'win32' ? 'this PC' : 'this Mac'
  switch (phase) {
    case 'starting':
      return 'Starting the microphone…'
    case 'listening':
      return `Listening — say a short phrase, like “hello MIKO”. Recognition stays on ${here}.`
    case 'hearing':
      return 'Hearing you…'
    case 'processing':
      return 'Working out the words…'
    case 'done':
      return 'Done.'
    case 'cancelled':
      return 'Test cancelled. The microphone is released.'
    default:
      return 'The test didn’t work.'
  }
}
