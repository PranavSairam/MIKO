import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import { parseSavedChats, type SavedChat } from '../shared/chatgpt'
import { parseRules, type ImportanceRules } from '../shared/mail'

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

/** ChatGPT bridge proof of concept: off unless the owner turns it on. */
export function bridgeEnabled(): boolean {
  return readAll().bridgeEnabled === true
}

export function setBridgeEnabled(enabled: boolean): void {
  writeKey('bridgeEnabled', enabled)
}

/** Codex thread id chosen for bridge requests ('' = start a new conversation). */
export function bridgeThread(): string {
  const value = readAll().bridgeThread
  return typeof value === 'string' && /^[0-9a-f-]{8,64}$/i.test(value) ? value : ''
}

export function setBridgeThread(thread: string): void {
  writeKey('bridgeThread', /^[0-9a-f-]{8,64}$/i.test(thread) ? thread : '')
}

/** Mail importance rules (adjustable in the Mail tab). */
export function mailRules(): ImportanceRules {
  return parseRules(readAll().mailRules)
}

export function setMailRules(rules: ImportanceRules): boolean {
  return writeKey('mailRules', parseRules(rules))
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
