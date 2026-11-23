import { useEffect, useState } from 'react'
import { displayAccelerator, SUMMON_ALTERNATIVES, type SetupState, type SetupStepId, type SummonShortcutStatus } from '../../../shared/setup'
import type { SystemOptionsInfo } from '../../../shared/api'
import { MicTestCard } from './MicTestCard'

export interface SetupTutorialProps {
  platform: string
  pets?: React.ReactNode
  onClose: () => void
  onOpenInteractiveGpt?: () => void
  /** Runs one of the Ready-step examples as if it was typed (user clicked it). */
  onRunExample?: (text: string) => void
  /** Adds the bundled sample document to Knowledge (only when clicked). */
  onAddSample?: () => Promise<boolean>
  onOpenKnowledge?: () => void
}

const ORDER: SetupStepId[] = ['meet', 'try', 'voice', 'chatgpt', 'knowledge', 'ready']
const TITLES: Record<SetupStepId, string> = {
  meet: 'Meet MIKO',
  try: 'Try MIKO',
  voice: 'Enable voice',
  chatgpt: 'Use ChatGPT',
  knowledge: 'Your documents',
  ready: 'Ready',
  done: 'Ready'
}

/**
 * First open, in five short steps with large controls. Every step can be skipped;
 * “Skip for now” remembers the step so Help & Setup can resume it. Nothing here is needed
 * for the pet or typed commands to work. Permissions are explained right before they’re used,
 * and account sign-in / Windows security choices stay with the person at the keyboard.
 */
export function SetupTutorial({ platform, pets, onClose, onOpenInteractiveGpt, onRunExample, onAddSample, onOpenKnowledge }: SetupTutorialProps) {
  const win = platform === 'win32'
  const platformKey = win ? 'win32' : 'darwin'
  const [state, setState] = useState<SetupState | null>(null)
  const [shortcut, setShortcut] = useState<SummonShortcutStatus | null>(null)
  const [pressBase, setPressBase] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const [system, setSystem] = useState<SystemOptionsInfo | null>(null)
  const [sample, setSample] = useState<'idle' | 'adding' | 'added' | 'failed'>('idle')

  useEffect(() => {
    if (typeof window.miko === 'undefined') return
    void window.miko.setupGet().then(setState)
    void window.miko.summonShortcutGet().then(setShortcut)
    if (typeof window.miko.systemOptionsGet === 'function') void window.miko.systemOptionsGet().then(setSystem)
  }, [])

  const step: SetupStepId = !state || state.currentStep === 'done' ? 'meet' : state.currentStep
  const onTry = step === 'try'

  // Live check that the show / hide shortcut really fires.
  useEffect(() => {
    if (!onTry || typeof window.miko === 'undefined') return
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
  }, [onTry])

  async function apply(update: Parameters<typeof window.miko.setupUpdate>[0]): Promise<void> {
    if (typeof window.miko === 'undefined') return
    setState(await window.miko.setupUpdate(update))
    setNote('')
  }

  async function finish(kind: 'complete' | 'skip'): Promise<void> {
    await apply({ action: kind })
    onClose()
  }

  async function chooseShortcut(accelerator: string): Promise<void> {
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

  async function setOption(next: { launchAtLogin?: boolean; desktopShortcut?: boolean }): Promise<void> {
    const result = await window.miko.systemOptionsSet(next)
    setSystem(result)
    if (result.reason) setNote(result.reason)
  }

  if (!state) {
    return (
      <div className="setup is-large">
        <p className="panel-detail">Loading…</p>
      </div>
    )
  }

  const index = ORDER.indexOf(step)
  const next = ORDER[index + 1] ?? 'ready'
  const activeLabel = shortcut?.active ? displayAccelerator(shortcut.active, platformKey) : ''
  const shortcutWorked = pressBase !== null && (shortcut?.presses ?? 0) > pressBase
  const go = (to: SetupStepId): void => void apply({ action: 'go', step: to })

  return (
    <div className="setup is-large">
      <div className="setup-steps">
        <p className="setup-step-count">
          Step {index + 1} of {ORDER.length}
        </p>
        <ol className="setup-dots" aria-label="Setup steps">
          {ORDER.map((id, i) => (
            <li
              key={id}
              className={i < index ? 'is-done' : i === index ? 'is-now' : ''}
              aria-current={i === index ? 'step' : undefined}
              title={TITLES[id]}
            >
              <span className="visually-hidden">{TITLES[id]}</span>
            </li>
          ))}
        </ol>
      </div>

      {step === 'meet' ? (
        <Step title="Meet MIKO" body={`MIKO is a small companion that lives on your ${win ? 'PC' : 'Mac'}. Pick the pet you like. You can change it later.`}>
          {pets}
          <Actions>
            <button type="button" className="text-button" onClick={() => go('try')}>
              Next
            </button>
          </Actions>
        </Step>
      ) : null}

      {step === 'try' ? (
        <Step title="Try MIKO" body="Three things to try. Nothing can break.">
          <ul className="setup-tries">
            <li>
              <strong>Click</strong> MIKO once to see your open apps. <strong>Double-click</strong> to open this panel.
            </li>
            <li>
              <strong>Drag</strong> MIKO and it walks where you point.
            </li>
            <li>
              <strong>Hide and show:</strong>{' '}
              {activeLabel ? (
                <>
                  press <kbd>{activeLabel}</kbd>, then press it again. {shortcutWorked ? <span className="setup-ok">✓ That works.</span> : null}
                </>
              ) : (
                'use the MIKO icon near the clock (Show / Hide).'
              )}
            </li>
          </ul>
          {shortcut && !shortcut.ok ? (
            <>
              <p className="panel-detail">That shortcut is taken by another app. Pick another:</p>
              <div className="panel-inline wrap">
                {SUMMON_ALTERNATIVES.map((accelerator) => (
                  <button
                    key={accelerator}
                    type="button"
                    className={shortcut.active === accelerator ? 'text-button' : 'text-button secondary'}
                    disabled={busy || shortcut.active === accelerator}
                    onClick={() => void chooseShortcut(accelerator)}
                  >
                    {displayAccelerator(accelerator, platformKey)}
                  </button>
                ))}
              </div>
            </>
          ) : null}
          <Actions>
            <button type="button" className="text-button" onClick={() => go(next)}>
              Next
            </button>
          </Actions>
        </Step>
      ) : null}

      {step === 'voice' ? (
        <Step
          title="Enable voice (optional)"
          body={
            win
              ? 'You can talk to MIKO instead of typing. When you press Test, Windows may ask whether desktop apps can use the microphone. Choose Allow if you want voice. Speech is turned into text on this PC and is not saved.'
              : 'You can talk to MIKO instead of typing. When you press Test, macOS may ask to allow the microphone and speech recognition. Speech stays on this Mac and is not saved.'
          }
        >
          <MicTestCard platform={platform} large />
          {win ? <p className="panel-detail">To talk later: hold Shift + A, speak, then let go.</p> : null}
          <Actions>
            <button type="button" className="text-button" onClick={() => go(next)}>
              Next
            </button>
            <button type="button" className="text-button secondary" onClick={() => go(next)}>
              Skip voice
            </button>
          </Actions>
        </Step>
      ) : null}

      {step === 'chatgpt' ? (
        <Step
          title="Use ChatGPT (optional)"
          body="Interactive GPT opens the real ChatGPT website inside MIKO. You sign in on ChatGPT’s own page with your own account — MIKO never sees your password. You can skip this and do it any time."
        >
          <Actions>
            {onOpenInteractiveGpt ? (
              <button type="button" className="text-button" onClick={onOpenInteractiveGpt}>
                Open Interactive GPT
              </button>
            ) : null}
            <button type="button" className="text-button secondary" onClick={() => go(next)}>
              {onOpenInteractiveGpt ? 'Next' : 'Skip'}
            </button>
          </Actions>
        </Step>
      ) : null}

      {step === 'knowledge' ? (
        <Step
          title="Your documents (optional)"
          body="Add notes, PDFs or Word files in the Knowledge tab, then ask things like “According to my documents, when is the deadline?”. MIKO searches them on this computer and shows which file each answer came from. Only the matching excerpts are sent to the MIKO assistant when you ask."
        >
          {sample === 'added' ? <p className="panel-detail" role="status">Sample added. Try: “According to my documents, when does the garden club meet?”</p> : null}
          {sample === 'failed' ? <p className="panel-detail" role="status">The sample couldn’t be added. You can add your own files in Knowledge later.</p> : null}
          <Actions>
            {onAddSample && sample !== 'added' ? (
              <button
                type="button"
                className="text-button"
                disabled={sample === 'adding'}
                onClick={() => {
                  setSample('adding')
                  void onAddSample().then((ok) => setSample(ok ? 'added' : 'failed'))
                }}
              >
                {sample === 'adding' ? 'Adding…' : 'Add a sample document'}
              </button>
            ) : null}
            {onOpenKnowledge ? (
              <button type="button" className="text-button secondary" onClick={onOpenKnowledge}>
                Open Knowledge
              </button>
            ) : null}
            <button type="button" className="text-button secondary" onClick={() => go(next)}>
              Next
            </button>
          </Actions>
        </Step>
      ) : null}

      {step === 'ready' ? (
        <Step title="Ready" body="Type one of these in the box (or click it to try it now):">
          <div className="setup-examples">
            {[win ? 'open Calculator' : 'open Notes', 'search Chrome for weather in Chennai', 'sit'].map((example) => (
              <button key={example} type="button" className="setup-example" onClick={() => onRunExample?.(example)}>
                “{example}”
              </button>
            ))}
          </div>
          {win && system && (system.canLaunchAtLogin || system.canDesktopShortcut) ? (
            <div className="setup-options">
              {system.canDesktopShortcut ? (
                <label className="prefs-check">
                  <input type="checkbox" checked={system.desktopShortcut} onChange={(event) => void setOption({ desktopShortcut: event.target.checked })} /> Put
                  a MIKO shortcut on the desktop
                </label>
              ) : null}
              {system.canLaunchAtLogin ? (
                <label className="prefs-check">
                  <input type="checkbox" checked={system.launchAtLogin} onChange={(event) => void setOption({ launchAtLogin: event.target.checked })} /> Start
                  MIKO when I sign in to Windows
                </label>
              ) : null}
            </div>
          ) : null}
          <p className="panel-detail">Help &amp; Setup (in the MIKO icon menu near the clock) has the microphone test, the tutorial and more.</p>
          <Actions>
            <button type="button" className="text-button" onClick={() => void finish('complete')}>
              Finish
            </button>
          </Actions>
        </Step>
      ) : null}

      {note ? (
        <p className="panel-detail" role="status">
          {note}
        </p>
      ) : null}

      <div className="panel-inline">
        <button type="button" className="text-button secondary" onClick={() => void finish('skip')}>
          Skip for now
        </button>
      </div>
    </div>
  )
}

function Step({ title, body, children }: { title: string; body: string; children?: React.ReactNode }) {
  return (
    <section className="setup-step">
      <h2 className="setup-title">{title}</h2>
      <p className="setup-body">{body}</p>
      {children}
    </section>
  )
}

function Actions({ children }: { children: React.ReactNode }) {
  return <div className="panel-inline wrap setup-actions">{children}</div>
}
