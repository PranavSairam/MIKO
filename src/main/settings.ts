import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import { parseSavedChats, type SavedChat } from '../shared/chatgpt'
import { parseAliases, type WhatsAppAlias } from '../shared/whatsapp'
import { parsePanelSize, type PanelKind } from '../shared/layout'
import { parseCorrections, parseRules, type ImportanceRules, type MailCorrections } from '../shared/mail'
import { parseExamples, parsePreferences, type CorrectionExample, type MikoStructuredPreferences } from '../shared/preferences'
import { parseSetupState, type SetupState } from '../shared/setup'
import { chooseSummonShortcut, DEFAULT_SUMMON_SHORTCUT } from '../shared/shortcut'

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

/** Opt-in GPT Mode (persisted). Runtime always starts paused after relaunch. */
export function gptModeOptedIn(): boolean {
  return readAll().gptModeOptedIn === true
}

export function setGptModeOptedIn(enabled: boolean): void {
  writeKey('gptModeOptedIn', enabled === true)
}

/** GPT Mode live viewer bounds (logical pixels). */
export function gptLiveBoundsSetting(): { x: number; y: number; width: number; height: number } | null {
  const value = readAll().gptLiveBounds
  if (!value || typeof value !== 'object') return null
  const v = value as Record<string, unknown>
  const x = typeof v.x === 'number' ? v.x : null
  const y = typeof v.y === 'number' ? v.y : null
  const width = typeof v.width === 'number' ? v.width : null
  const height = typeof v.height === 'number' ? v.height : null
  if (x === null || y === null || width === null || height === null) return null
  if (width < 320 || height < 240) return null
  return { x, y, width, height }
}

export function setGptLiveBoundsSetting(bounds: { x: number; y: number; width: number; height: number }): boolean {
  return writeKey('gptLiveBounds', {
    x: Math.round(bounds.x),
    y: Math.round(bounds.y),
    width: Math.round(bounds.width),
    height: Math.round(bounds.height)
  })
}

/** Interactive GPT (ChatGPT Web) workspace bounds. */
export function chatgptWebBoundsSetting(): { x: number; y: number; width: number; height: number } | null {
  const value = readAll().chatgptWebBounds
  if (!value || typeof value !== 'object') return null
  const v = value as Record<string, unknown>
  const x = typeof v.x === 'number' ? v.x : null
  const y = typeof v.y === 'number' ? v.y : null
  const width = typeof v.width === 'number' ? v.width : null
  const height = typeof v.height === 'number' ? v.height : null
  if (x === null || y === null || width === null || height === null) return null
  if (width < 420 || height < 320) return null
  return { x, y, width, height }
}

export function setChatgptWebBoundsSetting(bounds: { x: number; y: number; width: number; height: number }): boolean {
  return writeKey('chatgptWebBounds', {
    x: Math.round(bounds.x),
    y: Math.round(bounds.y),
    width: Math.round(bounds.width),
    height: Math.round(bounds.height)
  })
}

/** Last guest URL so reopen restores the same page (login/session still via partition). */
export function chatgptWebLastUrlSetting(): string {
  const value = readAll().chatgptWebLastUrl
  return typeof value === 'string' && /^https:\/\//i.test(value) ? value.slice(0, 2000) : ''
}

export function setChatgptWebLastUrlSetting(url: string): boolean {
  if (typeof url !== 'string' || !/^https:\/\//i.test(url)) return writeKey('chatgptWebLastUrl', '')
  return writeKey('chatgptWebLastUrl', url.slice(0, 2000))
}

/** Pin Interactive GPT above other apps (default on). */
export function chatgptWebPinnedSetting(): boolean {
  return readAll().chatgptWebPinned !== false
}

export function setChatgptWebPinnedSetting(pinned: boolean): boolean {
  return writeKey('chatgptWebPinned', pinned === true)
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

/** Show/hide shortcut. Registration is managed by summon-shortcut.ts. */
export function summonShortcut(): string {
  return chooseSummonShortcut(readAll().summonShortcut).shortcut || DEFAULT_SUMMON_SHORTCUT
}

export function setSummonShortcut(value: string): boolean {
  return writeKey('summonShortcut', value)
}

/** Versioned first-run setup/tutorial state. */
export function setupState(): SetupState {
  return parseSetupState(readAll().setupTutorial)
}

export function hasSetupState(): boolean {
  return Object.prototype.hasOwnProperty.call(readAll(), 'setupTutorial')
}

export function setSetupState(value: SetupState): boolean {
  return writeKey('setupTutorial', parseSetupState(value))
}

/** Mail importance rules (adjustable in the Mail tab). */
export function mailRules(): ImportanceRules {
  return parseRules(readAll().mailRules)
}

export function setMailRules(rules: ImportanceRules): boolean {
  return writeKey('mailRules', parseRules(rules))
}

/** The chosen pet id as stored (validated by the caller). Absent = the Doberman. */
export function selectedPet(): unknown {
  return readAll().pet
}

export function setSelectedPet(id: string): boolean {
  return writeKey('pet', id)
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

/** Short names for WhatsApp chats, on this Mac only. */
export function whatsAppAliases(): WhatsAppAlias[] {
  return parseAliases(readAll().whatsappAliases)
}

export function setWhatsAppAliases(list: WhatsAppAlias[]): boolean {
  return writeKey('whatsappAliases', parseAliases(list))
}

/** First-use notice: WhatsApp reply context is sent to MIKO’s model. */
export function whatsAppContextNoticeSeen(): boolean {
  return readAll().whatsappContextNoticeSeen === true
}

export function setWhatsAppContextNoticeSeen(seen: boolean): boolean {
  return writeKey('whatsappContextNoticeSeen', seen === true)
}

/** Structured approved preferences (browser, tone, …) — not model weights. */
export function structuredPreferences(): MikoStructuredPreferences {
  return parsePreferences(readAll().structuredPreferences)
}

export function setStructuredPreferences(prefs: MikoStructuredPreferences): boolean {
  return writeKey('structuredPreferences', parsePreferences(prefs))
}

/** Owner-approved routing correction examples for the interpreter. */
export function correctionExamples(): CorrectionExample[] {
  return parseExamples(readAll().correctionExamples)
}

export function setCorrectionExamples(list: CorrectionExample[]): boolean {
  return writeKey('correctionExamples', parseExamples(list))
}

export function addCorrectionExample(example: Omit<CorrectionExample, 'id' | 'createdAt'> & { id?: string }): CorrectionExample[] {
  const list = correctionExamples()
  const next: CorrectionExample = {
    id: example.id || `ex-${Date.now().toString(36)}`,
    wording: example.wording.slice(0, 200),
    actionKind: example.actionKind.slice(0, 64),
    targetAlias: example.targetAlias?.slice(0, 80),
    note: example.note?.slice(0, 200),
    createdAt: Date.now()
  }
  const deduped = list.filter((e) => e.wording.toLowerCase() !== next.wording.toLowerCase() || e.actionKind !== next.actionKind)
  deduped.unshift(next)
  setCorrectionExamples(deduped.slice(0, 50))
  return correctionExamples()
}

export function removeCorrectionExample(id: string): CorrectionExample[] {
  setCorrectionExamples(correctionExamples().filter((e) => e.id !== id))
  return correctionExamples()
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
