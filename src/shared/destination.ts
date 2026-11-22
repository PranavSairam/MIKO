/**
 * Shared typing destination — extends WorkingContext without a parallel system.
 * Capture before MIKO takes focus; revalidate immediately before insert.
 */

import type { FactSource } from './task-purpose.ts'

/** Where text should go. Never MIKO’s own panel. */
export type DestinationKind =
  | 'chatgpt-composer'
  | 'whatsapp-composer'
  | 'omnibox'
  | 'notes'
  | 'external-field'
  | 'choose'

export interface TypeDestination {
  kind: DestinationKind
  appName: string
  bundleId: string
  pid: number
  /** AX field signature when known. */
  fieldSig: string
  fieldRole: string
  /** Chat / note / tab title when known. */
  label: string
  capturedAt: number
  verified: boolean
  source: FactSource
  /** Secure/password fields must never be written. */
  secure: boolean
}

export type TypeMode = 'replace' | 'append' | 'ask'

export type InsertVerifyStatus =
  | 'inserted'
  | 'pasted-unverified'
  | 'has-text'
  | 'switched'
  | 'secure'
  | 'unsupported'
  | 'choose'
  | 'cancelled'
  | 'failed'

export interface TypeInsertResult {
  status: InsertVerifyStatus
  destination: TypeDestination | null
  composerText: string
  verified: boolean
  reason: string
}

export const CHATGPT_BUNDLES = ['com.openai.chat', 'com.openai.codex'] as const
export const CHROME_BUNDLES = ['com.google.Chrome', 'com.google.Chrome.canary', 'com.brave.Browser'] as const
export const NOTES_BUNDLES = ['com.apple.Notes'] as const
export const MIKO_BUNDLES = ['com.miko.app', 'com.electron.miko'] as const

export function isChatGptBundle(bundle: string): boolean {
  return CHATGPT_BUNDLES.some((b) => b === bundle)
}

export function isChromeBundle(bundle: string): boolean {
  return CHROME_BUNDLES.some((b) => b === bundle) || /chrome|brave/i.test(bundle)
}

export function isNotesBundle(bundle: string): boolean {
  return NOTES_BUNDLES.some((b) => b === bundle) || /notes/i.test(bundle)
}

export function isMikoBundle(bundle: string, appName = ''): boolean {
  if (MIKO_BUNDLES.some((b) => b === bundle)) return true
  return /^miko$/i.test(appName.trim())
}

/** True when an armed / captured destination is still usable (soft TTL). */
export const DESTINATION_TTL_MS = 30 * 60 * 1000

export function destinationExpired(dest: TypeDestination | null | undefined, now = Date.now()): boolean {
  if (!dest) return true
  return now - dest.capturedAt > DESTINATION_TTL_MS
}

export function destinationSummary(dest: TypeDestination | null | undefined): string {
  if (!dest) return 'no destination'
  const bits = [dest.appName]
  if (dest.label) bits.push(dest.label)
  if (dest.kind === 'omnibox') bits.push('address bar')
  if (dest.kind === 'chatgpt-composer') bits.push('composer')
  if (dest.kind === 'external-field' && dest.fieldRole) bits.push(dest.fieldRole)
  return bits.filter(Boolean).join(' · ').slice(0, 80)
}
