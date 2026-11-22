/**
 * Persist MIKO-owned state before an update restart, and clear replay markers.
 * Never resumes send / paste / attachment insert after relaunch.
 */

import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import type { UpdateHandoff } from '../shared/updater'
import { SETTINGS_SCHEMA_VERSION } from '../shared/updater'
import { SETUP_TUTORIAL_VERSION } from '../shared/setup'
import { cancelWhatsApp } from './whatsapp'
import { cancelAttachmentWork } from './whatsapp-attachments'
import { stopAllBridges } from './bridge'
import { disarmPaste } from './selection'
import { cancelListening } from './speech'
import { hasSetupState, setSetupState } from './settings'

function handoffPath(): string {
  return join(app.getPath('userData'), 'update-handoff.json')
}

function recoveredDraftPath(): string {
  return join(app.getPath('userData'), 'recovered-chat-draft.txt')
}

function schemaPath(): string {
  return join(app.getPath('userData'), 'settings-schema.json')
}

export function migrateSettingsIfNeeded(): void {
  try {
    let current = 0
    if (existsSync(schemaPath())) {
      const parsed = JSON.parse(readFileSync(schemaPath(), 'utf8')) as { version?: unknown }
      if (typeof parsed.version === 'number') current = parsed.version
    }
    // Schema-v1 profiles predate onboarding. Mark them migrated so an app update
    // does not unexpectedly interrupt an existing owner with first-run setup.
    // A clean profile (no schema checkpoint) remains pending.
    if (current === 1 && !hasSetupState()) {
      const saved = setSetupState({
        tutorialVersion: SETUP_TUTORIAL_VERSION,
        status: 'skipped',
        currentStep: 'done',
        completedAt: Date.now()
      })
      if (!saved) return
    }
    // Unknown keys in miko-settings.json are preserved by settings.ts.
    if (current < SETTINGS_SCHEMA_VERSION) {
      writeFileSync(schemaPath(), JSON.stringify({ version: SETTINGS_SCHEMA_VERSION, migratedAt: Date.now() }, null, 2), {
        mode: 0o600
      })
    }
  } catch {
    // Migration must never block launch.
  }
}

export function readUpdateHandoff(): UpdateHandoff | null {
  try {
    if (!existsSync(handoffPath())) return null
    const parsed = JSON.parse(readFileSync(handoffPath(), 'utf8')) as Partial<UpdateHandoff>
    if (!parsed || typeof parsed.at !== 'number') return null
    return {
      at: parsed.at,
      fromVersion: typeof parsed.fromVersion === 'string' ? parsed.fromVersion : '',
      toVersion: typeof parsed.toVersion === 'string' ? parsed.toVersion : null,
      cancelledActionKinds: Array.isArray(parsed.cancelledActionKinds)
        ? parsed.cancelledActionKinds.filter((k): k is string => typeof k === 'string').slice(0, 32)
        : [],
      draftText: typeof parsed.draftText === 'string' ? parsed.draftText.slice(0, 8000) : '',
      prefsFlushed: parsed.prefsFlushed === true
    }
  } catch {
    return null
  }
}

export function clearUpdateHandoff(): void {
  try {
    if (existsSync(handoffPath())) unlinkSync(handoffPath())
  } catch {
    // Ignore.
  }
}

/**
 * Cancel in-flight external actions and write a handoff record.
 * Returns the cancelled kinds so the renderer can mirror UI.
 */
export function prepareForUpdateRestart(input: {
  fromVersion: string
  toVersion: string | null
  draftText?: string
}): UpdateHandoff {
  const cancelled: string[] = []
  try {
    cancelWhatsApp()
    cancelled.push('whatsapp-open')
  } catch {
    // Ignore.
  }
  try {
    cancelAttachmentWork()
    cancelled.push('whatsapp-attachment')
  } catch {
    // Ignore.
  }
  try {
    stopAllBridges()
    cancelled.push('assistant-bridge')
  } catch {
    // Ignore.
  }
  try {
    disarmPaste('cancelled', 'Cancelled before update restart')
    cancelled.push('paste')
  } catch {
    // Ignore.
  }
  try {
    cancelListening()
    cancelled.push('speech')
  } catch {
    // Ignore.
  }

  const handoff: UpdateHandoff = {
    at: Date.now(),
    fromVersion: input.fromVersion,
    toVersion: input.toVersion,
    cancelledActionKinds: cancelled,
    draftText: (input.draftText || '').slice(0, 8000),
    prefsFlushed: true
  }
  try {
    writeFileSync(handoffPath(), JSON.stringify(handoff, null, 2), { mode: 0o600 })
    if (handoff.draftText) {
      writeFileSync(recoveredDraftPath(), handoff.draftText, { mode: 0o600 })
    }
  } catch {
    // Still proceed with cancel — better to lose handoff than replay a send.
  }
  return handoff
}

/** One-shot recovered chat box text after an update restart. */
export function takeRecoveredDraft(): string {
  try {
    if (!existsSync(recoveredDraftPath())) return ''
    const text = readFileSync(recoveredDraftPath(), 'utf8').slice(0, 8000)
    unlinkSync(recoveredDraftPath())
    return text
  } catch {
    return ''
  }
}

export function takeUpdateNotice(): string {
  const handoff = readUpdateHandoff()
  if (!handoff) return ''
  clearUpdateHandoff()
  if (!handoff.cancelledActionKinds.length) return 'Updated successfully. Preferences and accounts were kept.'
  return `Updated. Cancelled in-progress actions were not replayed (${handoff.cancelledActionKinds.join(', ')}).`
}
