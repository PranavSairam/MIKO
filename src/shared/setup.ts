/** Versioned first-run setup + tutorial state. Stored locally in miko-settings.json. */

export const SETUP_TUTORIAL_VERSION = 1

/** First open: Meet MIKO → Try MIKO → Enable voice (optional) → Use ChatGPT (optional) → Your documents (optional) → Ready. */
export const SETUP_STEPS = ['meet', 'try', 'voice', 'chatgpt', 'knowledge', 'ready', 'done'] as const

/** Step names saved by earlier builds, mapped onto the current steps (resume never breaks). */
const LEGACY_STEPS: Record<string, (typeof SETUP_STEPS)[number]> = {
  welcome: 'meet',
  pet: 'meet',
  microphone: 'voice',
  voice: 'voice',
  assistant: 'chatgpt',
  'interactive-gpt': 'chatgpt',
  shortcuts: 'try',
  'show-hide': 'try',
  drag: 'try',
  command: 'try'
}

function stepFrom(value: unknown): (typeof SETUP_STEPS)[number] | null {
  if (typeof value !== 'string') return null
  if ((SETUP_STEPS as readonly string[]).includes(value)) return value as (typeof SETUP_STEPS)[number]
  return LEGACY_STEPS[value] ?? null
}

export type SetupStepId = (typeof SETUP_STEPS)[number]
export type SetupStatus = 'pending' | 'in-progress' | 'completed' | 'skipped'

export interface SetupState {
  tutorialVersion: number
  status: SetupStatus
  currentStep: SetupStepId
  completedAt: number | null
}

export type SetupUpdate =
  | { action: 'start' }
  | { action: 'go'; step: SetupStepId }
  | { action: 'complete' }
  | { action: 'skip' }
  | { action: 'restart' }
  | { action: 'restart-tutorial' }

export type PermissionState =
  | 'not-determined'
  | 'authorized'
  | 'denied'
  | 'restricted'
  | 'unavailable'
  | 'unknown'

export interface VoicePermissionStatus {
  supported: boolean
  microphone: PermissionState
  speechRecognition: PermissionState
  canRequest: boolean
  detail: string
}

export interface SummonShortcutStatus {
  configured: string
  active: string | null
  ok: boolean
  detail: string
  /** Times the registered shortcut fired since MIKO started (setup's live test). */
  presses?: number
}

/** Shortcuts offered when the default is taken by another app. All need modifiers. */
export const SUMMON_ALTERNATIVES = [
  'CommandOrControl+Shift+R',
  'CommandOrControl+Alt+M',
  'CommandOrControl+Shift+M',
  'Alt+Shift+M'
] as const

/** Outcome of an explicit Try microphone action (native helper only). */
export type MicTestOutcome = 'not-tested' | 'transcript-confirmed' | 'denied' | 'silence' | 'unavailable' | 'cancelled'

export interface MicTestStatus {
  outcome: MicTestOutcome
  transcript: string
  detail: string
  /** Settings page that fixes a failed test (Windows). */
  help?: 'microphone-privacy' | 'sound-input' | 'speech-language'
}

export function emptyMicTestStatus(partial?: Partial<MicTestStatus>): MicTestStatus {
  return {
    outcome: 'not-tested',
    transcript: '',
    detail: 'Microphone has not been tested yet.',
    ...partial
  }
}

export function defaultSetupState(): SetupState {
  return {
    tutorialVersion: SETUP_TUTORIAL_VERSION,
    status: 'pending',
    currentStep: 'meet',
    completedAt: null
  }
}

export function parseSetupState(value: unknown): SetupState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return defaultSetupState()
  const row = value as Record<string, unknown>
  const status: SetupStatus =
    row.status === 'in-progress' || row.status === 'completed' || row.status === 'skipped'
      ? row.status
      : 'pending'
  const currentStep =
    stepFrom(row.currentStep) ?? (status === 'completed' || status === 'skipped' ? 'done' : 'meet')
  return {
    tutorialVersion:
      typeof row.tutorialVersion === 'number' && Number.isInteger(row.tutorialVersion) && row.tutorialVersion > 0
        ? row.tutorialVersion
        : SETUP_TUTORIAL_VERSION,
    status,
    currentStep,
    completedAt:
      typeof row.completedAt === 'number' && Number.isFinite(row.completedAt) && row.completedAt > 0
        ? row.completedAt
        : null
  }
}

export function parseSetupUpdate(value: unknown): SetupUpdate | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const row = value as Record<string, unknown>
  if (
    row.action === 'start' ||
    row.action === 'complete' ||
    row.action === 'skip' ||
    row.action === 'restart' ||
    row.action === 'restart-tutorial'
  ) {
    return { action: row.action }
  }
  const step = row.action === 'go' ? stepFrom(row.step) : null
  if (step) return { action: 'go', step }
  return null
}

export function applySetupUpdate(current: SetupState, update: SetupUpdate, now = Date.now()): SetupState {
  const state = parseSetupState(current)
  if (update.action === 'start') {
    return {
      tutorialVersion: SETUP_TUTORIAL_VERSION,
      status: 'in-progress',
      // Resume where the owner left off (Skip keeps the step); a finished tutorial starts over.
      currentStep: state.status === 'pending' || state.currentStep === 'done' ? 'meet' : state.currentStep,
      completedAt: null
    }
  }
  if (update.action === 'go') {
    return {
      tutorialVersion: SETUP_TUTORIAL_VERSION,
      status: update.step === 'done' ? 'completed' : 'in-progress',
      currentStep: update.step,
      completedAt: update.step === 'done' ? now : null
    }
  }
  if (update.action === 'complete') {
    return {
      tutorialVersion: SETUP_TUTORIAL_VERSION,
      status: 'completed',
      currentStep: 'done',
      completedAt: now
    }
  }
  if (update.action === 'skip') {
    // “Skip for now”: closes setup and remembers the step, so Help & Setup can resume it.
    return {
      tutorialVersion: SETUP_TUTORIAL_VERSION,
      status: 'skipped',
      currentStep: state.currentStep,
      completedAt: now
    }
  }
  return {
    tutorialVersion: SETUP_TUTORIAL_VERSION,
    status: 'in-progress',
    currentStep: update.action === 'restart-tutorial' ? 'try' : 'meet',
    completedAt: null
  }
}

/** Display an Electron accelerator using the platform's familiar key names. */
export function displayAccelerator(accelerator: string, platform: NodeJS.Platform | 'darwin' | 'win32'): string {
  const parts = accelerator.split('+').filter(Boolean)
  const labels = parts.map((part) => {
    if (part === 'CommandOrControl') return platform === 'darwin' ? 'Command' : 'Ctrl'
    if (part === 'Control' || part === 'Ctrl') return 'Ctrl'
    if (part === 'Command' || part === 'Cmd') return platform === 'darwin' ? 'Command' : 'Win'
    if (part === 'Option' || part === 'Alt') return 'Alt'
    return part
  })
  return labels.join('+')
}
