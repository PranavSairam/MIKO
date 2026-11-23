import { useEffect, useRef, useState } from 'react'
import type { MicTestPhase } from '../../../shared/mic-session'
import type { MicTestStatus } from '../../../shared/setup'

type Help = 'microphone-privacy' | 'sound-input' | 'speech-language'

const HELP_LABEL: Record<Help, string> = {
  'microphone-privacy': 'Microphone privacy settings',
  'sound-input': 'Sound settings',
  'speech-language': 'Speech settings'
}

/**
 * Microphone test: see which microphone MIKO listens to → Test → speak → see the words → Retry.
 * The words are only shown here; they are never run as a command or saved.
 * Closing the card (or Cancel) stops the test and releases the microphone.
 */
export function MicTestCard({ platform, large = false }: { platform: string; large?: boolean }) {
  const win = platform === 'win32'
  const [phase, setPhase] = useState<MicTestPhase | 'idle'>('idle')
  const [line, setLine] = useState('')
  const [result, setResult] = useState<MicTestStatus | null>(null)
  const [devices, setDevices] = useState<{ devices: string[]; defaultDevice: string; recognizers: string[]; detail: string } | null>(null)
  const [picked, setPicked] = useState('')
  const [loadingDevices, setLoadingDevices] = useState(false)
  const running = phase === 'starting' || phase === 'listening' || phase === 'hearing' || phase === 'processing'
  const runningRef = useRef(false)
  runningRef.current = running

  useEffect(() => {
    if (typeof window.miko?.onMicTestPhase !== 'function') return
    return window.miko.onMicTestPhase((event) => {
      setPhase(event.phase)
      if (event.detail) setLine(event.detail)
    })
  }, [])

  // Leaving the card never leaves the microphone open.
  useEffect(
    () => () => {
      if (runningRef.current) window.miko?.voiceMicTestCancel?.()
    },
    []
  )

  async function loadDevices(): Promise<void> {
    if (!win || typeof window.miko?.voiceInputDevices !== 'function') return
    setLoadingDevices(true)
    try {
      const found = await window.miko.voiceInputDevices()
      setDevices(found)
      setPicked(found.defaultDevice || found.devices[0] || '')
    } finally {
      setLoadingDevices(false)
    }
  }

  useEffect(() => {
    void loadDevices()
  }, [])

  async function start(): Promise<void> {
    if (typeof window.miko?.voiceMicTest !== 'function' || running) return
    setResult(null)
    setPhase('starting')
    setLine('Starting the microphone…')
    const status = await window.miko.voiceMicTest()
    setResult(status)
    setPhase(status.outcome === 'transcript-confirmed' ? 'done' : status.outcome === 'cancelled' ? 'cancelled' : 'error')
    setLine(status.detail)
  }

  const passed = result?.outcome === 'transcript-confirmed'
  const help = result?.help
  const notDefault = win && devices && picked && devices.defaultDevice && picked !== devices.defaultDevice

  return (
    <section className={`mic-card${large ? ' is-large' : ''}`} aria-label="Microphone test">
      <p className="prefs-section">Microphone test</p>
      {win ? (
        <div className="mic-device">
          {devices === null ? (
            <p className="panel-detail">{loadingDevices ? 'Looking for microphones…' : 'Microphones not checked yet.'}</p>
          ) : devices.devices.length || devices.defaultDevice ? (
            <label className="prefs-field">
              Microphone
              <select value={picked} onChange={(event) => setPicked(event.target.value)} aria-label="Microphone">
                {(devices.defaultDevice && !devices.devices.includes(devices.defaultDevice)
                  ? [devices.defaultDevice, ...devices.devices]
                  : devices.devices
                ).map((name) => (
                  <option key={name} value={name}>
                    {name}
                    {name === devices.defaultDevice ? ' (Windows default)' : ''}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <p className="panel-detail">Windows reports no microphone. Plug one in, then press Refresh.</p>
          )}
          {notDefault ? (
            <p className="panel-detail" role="note">
              Windows speech listens to the Windows default microphone. To use “{picked}”, make it the default in Sound
              settings (Input → Choose your device), then press Refresh.
            </p>
          ) : devices?.defaultDevice ? (
            <p className="panel-detail">MIKO listens to the Windows default microphone: “{devices.defaultDevice}”.</p>
          ) : null}
          {devices && !devices.recognizers.length && devices.detail ? <p className="panel-detail">{devices.detail}</p> : null}
          <div className="panel-inline wrap">
            <button type="button" className="text-button secondary" onClick={() => void window.miko.voiceSettingsOpen('sound-input')}>
              Change microphone…
            </button>
            <button type="button" className="text-button secondary" disabled={loadingDevices || running} onClick={() => void loadDevices()}>
              Refresh
            </button>
          </div>
        </div>
      ) : (
        <p className="panel-detail">MIKO listens to the Mac’s input device (System Settings → Sound → Input).</p>
      )}

      <div className={`mic-status phase-${phase}`} role="status" aria-live="polite">
        {phase === 'idle' ? (
          <span>Press Test, then say a short phrase like “hello MIKO”. The words are only shown here — nothing is run or saved.</span>
        ) : passed ? (
          <span>
            <strong>✓ Microphone works.</strong> Heard: “{result?.transcript}”
          </span>
        ) : (
          <span>{line}</span>
        )}
      </div>

      <div className="panel-inline wrap">
        {running ? (
          <button type="button" className="text-button secondary" onClick={() => window.miko.voiceMicTestCancel()}>
            Cancel
          </button>
        ) : (
          <button type="button" className="text-button" onClick={() => void start()}>
            {phase === 'idle' ? 'Test microphone' : 'Retry'}
          </button>
        )}
        {!running && help ? (
          <button type="button" className="text-button secondary" onClick={() => void window.miko.voiceSettingsOpen(help)}>
            {HELP_LABEL[help]}
          </button>
        ) : null}
        {!running && !help && result && !passed && result.outcome === 'denied' ? (
          <button type="button" className="text-button secondary" onClick={() => void window.miko.voiceSettingsOpen('microphone-privacy')}>
            {HELP_LABEL['microphone-privacy']}
          </button>
        ) : null}
      </div>
    </section>
  )
}
