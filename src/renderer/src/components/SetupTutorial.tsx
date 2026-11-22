import { useEffect, useState } from 'react'
import {
  displayAccelerator,
  type MicTestStatus,
  type SetupState,
  type SetupStepId,
  type SummonShortcutStatus,
  type VoicePermissionStatus
} from '../../../shared/setup'
import type { BridgeStatusInfo } from '../../../shared/api'
import { DEFAULT_SUMMON_SHORTCUT } from '../../../shared/shortcut'

export interface SetupTutorialProps {
  platform: string
  pets?: React.ReactNode
  onClose: () => void
  onOpenInteractiveGpt?: () => void
}

export function SetupTutorial({ platform, pets, onClose, onOpenInteractiveGpt }: SetupTutorialProps) {
  const win = platform === 'win32'
  const [state, setState] = useState<SetupState | null>(null)
  const [voice, setVoice] = useState<VoicePermissionStatus | null>(null)
  const [mic, setMic] = useState<MicTestStatus | null>(null)
  const [assistant, setAssistant] = useState<BridgeStatusInfo | null>(null)
  const [shortcut, setShortcut] = useState<SummonShortcutStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')

  async function refresh(): Promise<void> {
    if (typeof window.miko === 'undefined') return
    const [setup, voiceStatus, bridge, summon] = await Promise.all([
      window.miko.setupGet(),
      window.miko.voicePermissionGet(),
      window.miko.bridgeStatus(),
      window.miko.summonShortcutGet()
    ])
    setState(setup)
    setVoice(voiceStatus)
    setAssistant(bridge)
    setShortcut(summon)
  }

  useEffect(() => {
    void refresh()
  }, [])

  async function apply(update: Parameters<typeof window.miko.setupUpdate>[0]): Promise<SetupState | null> {
    if (typeof window.miko === 'undefined') return null
    const next = await window.miko.setupUpdate(update)
    setState(next)
    return next
  }

  async function go(step: SetupStepId): Promise<void> {
    await apply({ action: 'go', step })
    setNote('')
  }

  async function finish(kind: 'complete' | 'skip'): Promise<void> {
    await apply({ action: kind })
    onClose()
  }

  async function tryMic(): Promise<void> {
    if (typeof window.miko === 'undefined') return
    setBusy(true)
    setNote('Testing microphone…')
    try {
      const result = await window.miko.voiceMicTest()
      setMic(result)
      setNote(result.detail)
      const voiceStatus = await window.miko.voicePermissionGet()
      setVoice(voiceStatus)
    } finally {
      setBusy(false)
    }
  }

  async function retryShortcut(): Promise<void> {
    if (typeof window.miko === 'undefined') return
    setBusy(true)
    try {
      const status = await window.miko.summonShortcutSet(DEFAULT_SUMMON_SHORTCUT)
      setShortcut(status)
      setNote(status.detail)
    } finally {
      setBusy(false)
    }
  }

  if (!state) {
    return (
      <div className="setup">
        <p className="panel-detail">Loading setup…</p>
      </div>
    )
  }

  const step = state.currentStep === 'done' ? 'welcome' : state.currentStep
  const summonLabel = displayAccelerator(shortcut?.active || shortcut?.configured || DEFAULT_SUMMON_SHORTCUT, win ? 'win32' : 'darwin')

  return (
    <div className="setup">
      <p className="prefs-section">Setup &amp; Help</p>
      <p className="panel-detail">
        Optional walkthrough. You can skip any step — MIKO still works from the tray
        {win ? ' and Ctrl+Shift+R' : ' and Command+Shift+R'}.
      </p>

      {step === 'welcome' ? (
        <Step
          title="Welcome"
          body={`MIKO is a small desktop companion on ${win ? 'this PC' : 'this Mac'}. Pick a pet, then try the mic, assistant, and summon shortcut. Nothing here blocks the core pet or tray.`}
        >
          <button type="button" className="text-button" onClick={() => void go('pet')}>
            Continue
          </button>
          <button type="button" className="text-button secondary" onClick={() => void finish('skip')}>
            Skip setup
          </button>
        </Step>
      ) : null}

      {step === 'pet' ? (
        <Step title="Choose your pet" body="You can change this later from Preferences or the tray.">
          {pets}
          <button type="button" className="text-button" onClick={() => void go('microphone')}>
            Next
          </button>
        </Step>
      ) : null}

      {step === 'microphone' ? (
        <Step
          title="Microphone"
          body={
            win
              ? 'Voice uses Windows System.Speech on this PC. Audio is not saved. Browser getUserMedia is not used.'
              : 'Voice uses on-device speech recognition on this Mac. Audio is not saved. Browser getUserMedia is not used.'
          }
        >
          <p className="panel-detail">{voice?.detail || 'Permission status comes from the native helper.'}</p>
          {mic ? <p className="panel-detail">Last test: {mic.outcome}{mic.transcript ? ` — “${mic.transcript}”` : ''}</p> : null}
          <div className="panel-inline">
            <button type="button" className="text-button" disabled={busy} onClick={() => void tryMic()}>
              Try microphone
            </button>
            <button type="button" className="text-button secondary" onClick={() => void window.miko.voiceSettingsOpen()}>
              Open privacy settings
            </button>
            <button type="button" className="text-button" onClick={() => void go('assistant')}>
              Next
            </button>
          </div>
        </Step>
      ) : null}

      {step === 'assistant' ? (
        <Step
          title="Assistant (Codex)"
          body="MIKO’s typed assistant uses the Codex CLI with your ChatGPT sign-in. Interactive GPT is a separate floating browser — logging into the web UI does not sign Codex in."
        >
          <p className="panel-detail">
            {!assistant
              ? 'Checking…'
              : !assistant.available
                ? assistant.reason || (win ? 'Codex CLI not found on PATH.' : 'Bundled Codex not found.')
                : !assistant.signedIn
                  ? 'Codex found but not signed in. Run “codex login”, or skip and use Interactive GPT.'
                  : 'Codex is available and signed in.'}
          </p>
          <div className="panel-inline">
            <button
              type="button"
              className="text-button secondary"
              onClick={() => {
                void window.miko.bridgeStatus().then(setAssistant)
              }}
            >
              Recheck
            </button>
            {onOpenInteractiveGpt ? (
              <button type="button" className="text-button secondary" onClick={onOpenInteractiveGpt}>
                Open Interactive GPT
              </button>
            ) : null}
            <button type="button" className="text-button" onClick={() => void go('shortcuts')}>
              Next
            </button>
            <button type="button" className="text-button secondary" onClick={() => void go('shortcuts')}>
              Skip
            </button>
          </div>
        </Step>
      ) : null}

      {step === 'shortcuts' ? (
        <Step
          title="Summon shortcut"
          body={`Show or hide MIKO with ${summonLabel}. If registration fails, use the tray Show / Hide. Caps Lock+A voice hold remains macOS-only.`}
        >
          <p className="panel-detail">
            {shortcut?.ok
              ? `Active: ${summonLabel}`
              : shortcut?.detail || 'Shortcut unavailable — tray still works.'}
          </p>
          <div className="panel-inline">
            <button type="button" className="text-button secondary" disabled={busy} onClick={() => void retryShortcut()}>
              Retry default shortcut
            </button>
            <button type="button" className="text-button" onClick={() => void go('show-hide')}>
              Start interactive tutorial
            </button>
          </div>
        </Step>
      ) : null}

      {step === 'show-hide' ? (
        <Step title="Show &amp; hide" body={`Press ${summonLabel} or use the tray. Try hiding, then showing MIKO again.`}>
          <button type="button" className="text-button" onClick={() => void go('drag')}>
            Done — next
          </button>
        </Step>
      ) : null}

      {step === 'drag' ? (
        <Step title="Drag" body="Drag the pet around the screen. It stays on top while you work.">
          <button type="button" className="text-button" onClick={() => void go('command')}>
            Done — next
          </button>
        </Step>
      ) : null}

      {step === 'command' ? (
        <Step title="Panel command" body="Click the pet or open the panel, type a short request (for example “open Notes”), and send it.">
          <button type="button" className="text-button" onClick={() => void go('voice')}>
            Done — next
          </button>
        </Step>
      ) : null}

      {step === 'voice' ? (
        <Step
          title="Optional voice"
          body={
            win
              ? 'Use the mic button in the panel for button-driven System.Speech. Caps Lock+A is not available on Windows yet.'
              : 'Hold Caps Lock+A to talk, or use the mic button. Recognition stays on this Mac.'
          }
        >
          <button type="button" className="text-button" onClick={() => void go('interactive-gpt')}>
            Done — next
          </button>
          <button type="button" className="text-button secondary" onClick={() => void go('interactive-gpt')}>
            Skip voice
          </button>
        </Step>
      ) : null}

      {step === 'interactive-gpt' ? (
        <Step
          title="Interactive GPT vs local commands"
          body="Local commands open apps and type when supported. Interactive GPT is a separate floating ChatGPT window. Codex assistant replies stay in the panel — web login ≠ Codex sign-in."
        >
          {onOpenInteractiveGpt ? (
            <button type="button" className="text-button secondary" onClick={onOpenInteractiveGpt}>
              Open Interactive GPT
            </button>
          ) : null}
          <button type="button" className="text-button" onClick={() => void finish('complete')}>
            Finish
          </button>
        </Step>
      ) : null}

      {note ? (
        <p className="panel-detail" role="status">
          {note}
        </p>
      ) : null}

      <div className="panel-inline">
        <button type="button" className="text-button secondary" onClick={() => void finish('skip')}>
          Close setup
        </button>
      </div>
    </div>
  )
}

function Step({ title, body, children }: { title: string; body: string; children?: React.ReactNode }) {
  return (
    <div className="setup-step">
      <p className="prefs-section">{title}</p>
      <p className="panel-detail">{body}</p>
      <div className="panel-inline wrap">{children}</div>
    </div>
  )
}
