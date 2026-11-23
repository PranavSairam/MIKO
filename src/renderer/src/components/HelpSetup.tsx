import { useEffect, useState } from 'react'
import { displayAccelerator, SUMMON_ALTERNATIVES, type SetupState, type SummonShortcutStatus } from '../../../shared/setup'
import type { SystemOptionsInfo } from '../../../shared/api'
import type { UpdateStatus } from '../../../shared/updater'
import { MicTestCard } from './MicTestCard'

type Section = 'home' | 'mic' | 'shortcut' | 'features'

/**
 * Help & Setup: one place for the things someone (e.g. a parent using MIKO) needs without
 * knowing where files live. Every action is local. Feedback is only “sent” when a configured
 * endpoint accepts it — that screen says so itself.
 */
export function HelpSetup({
  platform,
  version,
  update,
  onOpenTutorial,
  onOpenInteractiveGpt,
  onOpenFeedback,
  onUpdateDownload,
  onClose
}: {
  platform: string
  version: string
  update: UpdateStatus | null
  onOpenTutorial: (resume: boolean) => void
  onOpenInteractiveGpt: () => void
  onOpenFeedback: () => void
  /** Existing manual update flow: opens the configured download. */
  onUpdateDownload: () => void
  onClose: () => void
}) {
  const win = platform === 'win32'
  const key = win ? 'win32' : 'darwin'
  const [section, setSection] = useState<Section>('home')
  const [shortcut, setShortcut] = useState<SummonShortcutStatus | null>(null)
  const [system, setSystem] = useState<SystemOptionsInfo | null>(null)
  const [setup, setSetup] = useState<SetupState | null>(null)
  const [note, setNote] = useState('')

  useEffect(() => {
    if (typeof window.miko === 'undefined') return
    void window.miko.summonShortcutGet().then(setShortcut)
    void window.miko.setupGet().then(setSetup)
    if (typeof window.miko.systemOptionsGet === 'function') void window.miko.systemOptionsGet().then(setSystem)
  }, [])

  const activeLabel = shortcut?.active ? displayAccelerator(shortcut.active, key) : ''
  const canResume = setup?.status === 'skipped' && setup.currentStep !== 'done'

  async function setOption(next: { launchAtLogin?: boolean; desktopShortcut?: boolean }): Promise<void> {
    const result = await window.miko.systemOptionsSet(next)
    setSystem(result)
    setNote(result.reason)
  }

  async function chooseShortcut(accelerator: string): Promise<void> {
    const status = await window.miko.summonShortcutSet(accelerator)
    setShortcut(status)
    setNote(status.detail)
  }

  const updateConfigured = Boolean(update?.downloadUrl) || update?.mode === 'auto'
  const updateLine = !update
    ? ''
    : update.phase === 'available' && update.availableVersion
      ? `Update available: MIKO ${update.availableVersion}.`
      : updateConfigured
        ? ''
        : 'Updates come as a new installer file — there’s no automatic update service set up.'

  return (
    <div className="help is-large">
      <h2 className="setup-title">Help &amp; Setup</h2>
      {section !== 'home' ? (
        <button type="button" className="text-button secondary" onClick={() => setSection('home')}>
          ← Back to Help
        </button>
      ) : null}

      {section === 'home' ? (
        <div className="help-grid">
          <button type="button" className="help-tile" onClick={() => setSection('mic')}>
            <strong>Test microphone</strong>
            <span>Speak and see the words</span>
          </button>
          <button type="button" className="help-tile" onClick={() => setSection('shortcut')}>
            <strong>Show / hide shortcut</strong>
            <span>{activeLabel || 'Not set'}</span>
          </button>
          <button type="button" className="help-tile" onClick={() => onOpenTutorial(canResume)}>
            <strong>{canResume ? 'Continue setup' : 'Show the tutorial'}</strong>
            <span>{canResume ? 'Pick up where you left off' : 'The five first steps again'}</span>
          </button>
          <button type="button" className="help-tile" onClick={onOpenInteractiveGpt}>
            <strong>Open Interactive GPT</strong>
            <span>ChatGPT inside MIKO</span>
          </button>
          <button type="button" className="help-tile" onClick={() => setSection('features')}>
            <strong>What works on {win ? 'Windows' : 'this Mac'}</strong>
            <span>And what doesn’t yet</span>
          </button>
          <button type="button" className="help-tile" onClick={onOpenFeedback}>
            <strong>Send feedback</strong>
            <span>Preview first; diagnostics optional</span>
          </button>
          <button
            type="button"
            className="help-tile"
            onClick={() => {
              void window.miko.openLogsFolder().then((ok) => setNote(ok ? 'Opened the folder with MIKO’s log.' : 'Couldn’t open the log folder.'))
            }}
          >
            <strong>Open logs folder</strong>
            <span>For troubleshooting</span>
          </button>
        </div>
      ) : null}

      {section === 'mic' ? <MicTestCard platform={platform} large /> : null}

      {section === 'shortcut' ? (
        <div className="setup-step">
          <p className="setup-body">
            {activeLabel ? (
              <>
                Press <kbd>{activeLabel}</kbd> to hide MIKO and again to bring it back.
              </>
            ) : (
              'No shortcut is working right now. Pick one below — the MIKO icon near the clock (Show / Hide) always works.'
            )}
          </p>
          {shortcut && !shortcut.ok && shortcut.detail ? <p className="panel-detail">{shortcut.detail}</p> : null}
          <div className="panel-inline wrap">
            {SUMMON_ALTERNATIVES.map((accelerator) => (
              <button
                key={accelerator}
                type="button"
                className={shortcut?.active === accelerator ? 'text-button' : 'text-button secondary'}
                disabled={shortcut?.active === accelerator}
                onClick={() => void chooseShortcut(accelerator)}
              >
                {displayAccelerator(accelerator, key)}
              </button>
            ))}
          </div>
          {win ? <p className="panel-detail">Talk: hold Shift + A. App switcher: Tab + Q.</p> : null}
        </div>
      ) : null}

      {section === 'features' ? (
        <div className="setup-step">
          {win ? (
            <>
              <p className="setup-body">
                <strong>Works on Windows:</strong> the pet (walk, sit, follow), typed commands, opening and closing apps, websites and
                Chrome searches, voice (Shift + A or the mic button), the app switcher (Tab + Q), Interactive GPT, and finding a WhatsApp
                chat by name.
              </p>
              <p className="setup-body">
                <strong>Mac only for now:</strong> reading WhatsApp messages, writing WhatsApp replies into the chat, WhatsApp files,
                editing selected text in other apps, browser tab lists and GPT Mode.
              </p>
            </>
          ) : (
            <p className="setup-body">Everything in MIKO works on the Mac. Some features need Accessibility permission the first time.</p>
          )}
        </div>
      ) : null}

      {section === 'home' ? (
        <>
          {win && system && (system.canDesktopShortcut || system.canLaunchAtLogin) ? (
            <div className="setup-options">
              {system.canDesktopShortcut ? (
                <label className="prefs-check">
                  <input type="checkbox" checked={system.desktopShortcut} onChange={(event) => void setOption({ desktopShortcut: event.target.checked })} /> MIKO
                  shortcut on the desktop
                </label>
              ) : null}
              {system.canLaunchAtLogin ? (
                <label className="prefs-check">
                  <input type="checkbox" checked={system.launchAtLogin} onChange={(event) => void setOption({ launchAtLogin: event.target.checked })} /> Start
                  MIKO when I sign in
                </label>
              ) : null}
            </div>
          ) : system?.detail ? (
            <p className="panel-detail">{system.detail}</p>
          ) : null}
          <p className="panel-detail">
            {version ? `${version}. ` : ''}
            {updateLine}
          </p>
          {update?.phase === 'available' && update.downloadUrl ? (
            <>
              <div className="panel-inline">
                <button type="button" className="text-button" onClick={onUpdateDownload}>
                  Download the update
                </button>
              </div>
              <p className="panel-detail">
                {win
                  ? 'Then open the downloaded installer. Windows may warn about an unknown app: choose “More info” → “Run anyway” only if it came from Pranav. Your settings and ChatGPT sign-in are kept.'
                  : 'Then open the download and replace MIKO. Your settings are kept.'}
              </p>
            </>
          ) : null}
        </>
      ) : null}

      {note ? (
        <p className="panel-detail" role="status">
          {note}
        </p>
      ) : null}
      <div className="panel-inline">
        <button type="button" className="text-button secondary" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  )
}
