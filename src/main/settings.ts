import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import { parseSavedChats, type SavedChat } from '../shared/chatgpt'

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
  writeKey('voiceAutoExecute', enabled)
}

/** Saved ChatGPT shortcuts ({ name, url }), validated on every read. */
export function savedChats(): SavedChat[] {
  return parseSavedChats(readAll().savedChats)
}

export function setSavedChats(list: SavedChat[]): boolean {
  return writeKey('savedChats', list)
}

function writeKey(key: string, value: unknown): boolean {
  const all = readAll()
  all[key] = value
  try {
    writeFileSync(file(), JSON.stringify(all, null, 2))
    return true
  } catch {
    return false
  }
}
