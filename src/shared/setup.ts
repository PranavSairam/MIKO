/** Versioned first-run setup + tutorial state. Stored locally in miko-settings.json. */

export const SETUP_TUTORIAL_VERSION = 1

export const SETUP_STEPS = [
  'welcome',
  'pet',
  'microphone',
  'assistant',
  'shortcuts',
  'show-hide',
  'drag',
  'command',
  'voice',
  'interactive-gpt',
  'done'
] as const

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
}

/** Outcome of an explicit Try microphone action (native helper only). */
export type MicTestOutcome = 'not-tested' | 'transcript-confirmed' | 'denied' | 'silence' | 'unavailable'

export interface MicTestStatus {
  outcome: MicTestOutcome
  transcript: string
  detail: string
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
    currentStep: 'welcome',
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
  const currentStep = SETUP_STEPS.includes(row.currentStep as SetupStepId)
    ? (row.currentStep as SetupStepId)
    : status === 'completed' || status === 'skipped'
      ? 'done'
      : 'welcome'
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
  if (row.action === 'go' && SETUP_STEPS.includes(row.step as SetupStepId)) {
    return { action: 'go', step: row.step as SetupStepId }
  }
  return null
}

export function applySetupUpdate(current: SetupState, update: SetupUpdate, now = Date.now()): SetupState {
  const state = parseSetupState(current)
  if (update.action === 'start') {
    return {
      tutorialVersion: SETUP_TUTORIAL_VERSION,
      status: 'in-progress',
      currentStep: state.status === 'pending' ? 'welcome' : state.currentStep,
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
    return {
      tutorialVersion: SETUP_TUTORIAL_VERSION,
      status: 'skipped',
      currentStep: 'done',
      completedAt: now
    }
  }
  return {
    tutorialVersion: SETUP_TUTORIAL_VERSION,
    status: 'in-progress',
    currentStep: update.action === 'restart-tutorial' ? 'show-hide' : 'welcome',
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
