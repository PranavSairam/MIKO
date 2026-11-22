import { useEffect, useState } from 'react'
import {
  displayAccelerator,
  SUMMON_ALTERNATIVES,
  type MicTestStatus,
  type SetupState,
  type SetupStepId,
  type SummonShortcutStatus,
  type VoicePermissionStatus
} from '../../../shared/setup'
import type { BridgeStatusInfo } from '../../../shared/api'

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
  const [devices, setDevices] = useState<string[] | null>(null)
  /** Shortcut presses seen when the shortcut step opened; a higher count means the test passed. */
  const [pressBase, setPressBase] = useState<number | null>(null)

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

  const onShortcutStep = state?.currentStep === 'shortcuts' || state?.currentStep === 'show-hide'
  useEffect(() => {
    if (!onShortcutStep || typeof window.miko === 'undefined') return
    let stop = false
    const poll = async (): Promise<void> => {
      const status = await window.miko.summonShortcutGet()
      if (stop) return
      setShortcut(status)
      setPressBase((base) => (base === null ? status.presses ?? 0 : base))
    }
    void poll()
    const id = window.setInterval(() => void poll(), 800)
    return () => {
      stop = true
      window.clearInterval(id)
    }
  }, [onShortcutStep])

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
    setMic(null)
    setNote(win ? 'Starting the microphone… then say a short phrase, like “hello MIKO”.' : 'Testing microphone…')
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

  async function chooseShortcut(accelerator: string): Promise<void> {
    if (typeof window.miko === 'undefined') return
    setBusy(true)
    try {
      const status = await window.miko.summonShortcutSet(accelerator)
      setShortcut(status)
      setPressBase(status.presses ?? 0)
      setNote(status.detail)
    } finally {
      setBusy(false)
    }
  }

  async function listMics(): Promise<void> {
    if (typeof window.miko?.voiceInputDevices !== 'function') return
    const found = await window.miko.voiceInputDevices()
    setDevices(found.devices)
    if (found.detail) setNote(found.detail)
  }

  if (!state) {
    return (
      <div className="setup">
        <p className="panel-detail">Loading setup…</p>
      </div>
    )
  }

  const step = state.currentStep === 'done' ? 'welcome' : state.currentStep
  const platformKey = win ? 'win32' : 'darwin'
  const activeLabel = shortcut?.active ? displayAccelerator(shortcut.active, platformKey) : ''
  const shortcutWorked = pressBase !== null && (shortcut?.presses ?? 0) > pressBase
  const micPassed = mic?.outcome === 'transcript-confirmed'

  return (
    <div className="setup">
      <p className="prefs-section">Setup &amp; Help</p>
      <p className="panel-detail">
        Optional walkthrough. You can skip any step — MIKO still works from the tray
        {activeLabel ? ` and ${activeLabel}` : ''}. Running setup again keeps your settings and ChatGPT login.
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
              ? 'Voice uses Windows speech recognition on this PC (System.Speech). Audio is not saved. MIKO records from the Windows default input device.'
              : 'Voice uses on-device speech recognition on this Mac. Audio is not saved. Browser getUserMedia is not used.'
          }
        >
          {!win ? <p className="panel-detail">{voice?.detail || 'Permission status comes from the native helper.'}</p> : null}
          {mic ? (
            <p className="panel-detail" role="status">
              {micPassed ? `\u2713 Microphone works \u2014 heard \u201c${mic.transcript}\u201d.` : `\u2717 Not working yet: ${mic.detail}`}
            </p>
          ) : null}
          <div className="panel-inline wrap">
            <button type="button" className="text-button" disabled={busy} onClick={() => void tryMic()}>
              {mic && !micPassed ? 'Retry microphone test' : 'Try microphone'}
            </button>
            <button
              type="button"
              className="text-button secondary"
              onClick={() => void window.miko.voiceSettingsOpen(mic?.help ?? 'microphone-privacy')}
            >
              {mic?.help === 'speech-language'
                ? 'Speech settings'
                : mic?.help === 'sound-input'
                  ? 'Sound settings'
                  : 'Microphone privacy settings'}
            </button>
            {win ? (
              <button type="button" className="text-button secondary" onClick={() => void listMics()}>
                Choose microphone
              </button>
            ) : null}
            <button type="button" className="text-button" onClick={() => void go('assistant')}>
              {micPassed ? 'Next' : 'Skip'}
            </button>
          </div>
          {win && devices ? (
            <div className="panel-detail">
              {devices.length ? (
                <>
                  Microphones Windows reports: {devices.join(', ')}. MIKO uses the Windows default input — change it in{' '}
                  <button type="button" className="text-button secondary" onClick={() => void window.miko.voiceSettingsOpen('sound-input')}>
                    Sound settings
                  </button>
                  , then Retry.
                </>
              ) : (
                <>
                  Windows reports no microphone. Plug one in, or check{' '}
                  <button type="button" className="text-button secondary" onClick={() => void window.miko.voiceSettingsOpen('sound-input')}>
                    Sound settings
                  </button>
                  .
                </>
              )}
            </div>
          ) : null}
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

      {step === 'shortcuts' || step === 'show-hide' ? (
        <Step
          title="Show &amp; hide shortcut"
          body={
            activeLabel
              ? `Test it: press ${activeLabel}. MIKO hides; press it again and MIKO comes back. The tray Show / Hide${win ? ' and Talk to MIKO' : ''} always work too.`
              : 'No keyboard shortcut is registered right now. Pick one below, or use the tray Show / Hide.'
          }
        >
          <p className="panel-detail" role="status">
            {shortcutWorked
              ? `\u2713 ${activeLabel} works.`
              : activeLabel
                ? `Registered: ${activeLabel}. Waiting for you to press it\u2026`
                : shortcut?.detail || 'Shortcut unavailable \u2014 the tray still works.'}
          </p>
          {shortcut && !shortcut.ok && shortcut.detail ? <p className="panel-detail">{shortcut.detail}</p> : null}
          <div className="panel-inline wrap">
            {SUMMON_ALTERNATIVES.map((accelerator) => (
              <button
                key={accelerator}
                type="button"
                className={shortcut?.active === accelerator ? 'text-button' : 'text-button secondary'}
                disabled={busy || shortcut?.active === accelerator}
                onClick={() => void chooseShortcut(accelerator)}
              >
                {displayAccelerator(accelerator, platformKey)}
              </button>
            ))}
          </div>
          <div className="panel-inline">
            <button type="button" className="text-button" onClick={() => void go('drag')}>
              {shortcutWorked ? 'Next' : 'Skip'}
            </button>
          </div>
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
        <Step
          title="Panel command"
          body={`Click the pet or open the panel, type a short request (for example \u201c${win ? 'open Calculator' : 'open Notes'}\u201d), and send it.`}
        >
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
              ? 'Click the mic button in the panel (or the tray\u2019s Talk to MIKO) and say a command, for example \u201copen Calculator\u201d.'
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
