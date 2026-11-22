import { appendFileSync, renameSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'

/**
 * Local troubleshooting log: userData/miko-diagnostics.log (one previous file kept as .1).
 * Records what MIKO tried and how it went (shortcut registration, app discovery and launch,
 * speech helper start/errors, Interactive GPT loads). Never transcripts, message text,
 * credentials, or full URLs — hosts and short reasons only. Stays on this computer.
 */

const MAX_BYTES = 256 * 1024

export function diagnosticsPath(): string {
  return join(app.getPath('userData'), 'miko-diagnostics.log')
}

export function logDiag(area: string, message: string, extra?: Record<string, unknown>): void {
  try {
    const path = diagnosticsPath()
    try {
      if (statSync(path).size > MAX_BYTES) renameSync(path, `${path}.1`)
    } catch {
      // No file yet.
    }
    const detail = extra ? ` ${safeJson(extra)}` : ''
    const line = `${new Date().toISOString()} [${process.platform}] ${area}: ${oneLine(message)}${detail}\n`
    appendFileSync(path, line, { mode: 0o600 })
  } catch {
    // Logging must never break the feature that called it.
  }
}

function oneLine(text: string): string {
  return text.replace(/[\r\n]+/g, ' ').slice(0, 600)
}

function safeJson(value: Record<string, unknown>): string {
  try {
    return oneLine(JSON.stringify(value))
  } catch {
    return ''
  }
}

/** Host only, for logging a URL without its path or query. */
export function hostOf(raw: string): string {
  try {
    return new URL(raw).host || raw.slice(0, 20)
  } catch {
    return 'invalid-url'
  }
}
