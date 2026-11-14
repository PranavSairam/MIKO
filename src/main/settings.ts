import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'

/** Small persisted preferences in userData/miko-settings.json. Unknown keys (e.g. summonShortcut) are kept. */

function file(): string {
  return join(app.getPath('userData'), 'miko-settings.json')
}

function readAll(): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(readFileSync(file(), 'utf8'))
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

/** "Execute voice commands automatically". On by default; off restores transcript review. */
export function voiceAutoExecute(): boolean {
  return readAll().voiceAutoExecute !== false
}

export function setVoiceAutoExecute(enabled: boolean): void {
  const all = readAll()
  all.voiceAutoExecute = enabled
  try {
    writeFileSync(file(), JSON.stringify(all, null, 2))
  } catch {
    // Not persisted; the in-memory menu still reflects the choice until restart.
  }
}
