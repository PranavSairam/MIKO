import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import { parseSavedChats, type SavedChat } from '../shared/chatgpt'
import { parsePanelSize, type PanelKind } from '../shared/layout'
import { parseCorrections, parseRules, type ImportanceRules, type MailCorrections } from '../shared/mail'

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

/**
 * MIKO assistant (questions and writing via the Codex CLI with ChatGPT sign-in).
 * On by default since the owner asked for questions to route through it; the
 * paw menu turns it off (then questions use the ChatGPT app handoff).
 */
export function assistantEnabled(): boolean {
  return readAll().assistantEnabled !== false
}

export function setAssistantEnabled(enabled: boolean): void {
  writeKey('assistantEnabled', enabled)
}

/** Current assistant conversation (Codex thread id; '' = the next question starts a new one). */
export function assistantThread(): string {
  const value = readAll().assistantThread
  return typeof value === 'string' && /^[0-9a-f-]{8,64}$/i.test(value) ? value : ''
}

export function setAssistantThread(thread: string): void {
  writeKey('assistantThread', /^[0-9a-f-]{8,64}$/i.test(thread) ? thread : '')
}

/** MIKO preferences: text the owner explicitly asked MIKO to remember. Local only. */
export function mikoPreferences(): string {
  const value = readAll().mikoPreferences
  return typeof value === 'string' ? value.slice(0, 2000) : ''
}

export function setMikoPreferences(text: string): boolean {
  return writeKey('mikoPreferences', text.replace(/\r/g, '').slice(0, 2000))
}

/** Paste prompts into ChatGPT automatically after bringing it forward (owner asked for this). */
export function chatgptAutoPaste(): boolean {
  return readAll().chatgptAutoPaste !== false
}

export function setChatgptAutoPaste(enabled: boolean): void {
  writeKey('chatgptAutoPaste', enabled)
}

/** Selected-text assistant shortcut (Electron accelerator). */
export const DEFAULT_SELECTION_SHORTCUT = 'Control+Option+S'
export function selectionShortcut(): string {
  const value = readAll().selectionShortcut
  return typeof value === 'string' && value ? value : DEFAULT_SELECTION_SHORTCUT
}

export function setSelectionShortcut(value: string): boolean {
  return writeKey('selectionShortcut', value)
}

/** Mail importance rules (adjustable in the Mail tab). */
export function mailRules(): ImportanceRules {
  return parseRules(readAll().mailRules)
}

export function setMailRules(rules: ImportanceRules): boolean {
  return writeKey('mailRules', parseRules(rules))
}

/** Chosen Chat / Mail panel sizes (null = default size). */
export function panelSizeSetting(kind: PanelKind): { width: number; height: number } | null {
  const all = readAll().panelSizes
  return parsePanelSize(kind, all && typeof all === 'object' ? (all as Record<string, unknown>)[kind] : null)
}

export function setPanelSizeSetting(kind: PanelKind, size: { width: number; height: number } | null): boolean {
  const current = readAll().panelSizes
  const next = { ...(current && typeof current === 'object' ? (current as Record<string, unknown>) : {}) }
  if (size) next[kind] = parsePanelSize(kind, size)
  else delete next[kind]
  return writeKey('panelSizes', next)
}

/** The owner's mail category corrections. */
export function mailCorrections(): MailCorrections {
  return parseCorrections(readAll().mailCorrections)
}

export function setMailCorrections(value: MailCorrections): boolean {
  return writeKey('mailCorrections', parseCorrections(value))
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
