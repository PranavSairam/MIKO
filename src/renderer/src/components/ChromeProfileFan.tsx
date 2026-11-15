/**
 * Glass-style Chrome profile fan above MIKO.
 * Uses data-hit so the pet window accepts clicks on the cards.
 */
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode
} from 'react'
import type { ChromeProfileView } from '../../../shared/chrome-profiles'

const GRID_THRESHOLD = 6

export function ChromeProfileFan({
  profiles,
  pendingLabel,
  reducedMotion,
  onChoose,
  onCancel
}: {
  profiles: ChromeProfileView[]
  pendingLabel?: string | null
  reducedMotion: boolean
  onChoose: (directoryId: string, opts?: { always?: boolean }) => void
  onCancel: () => void
}): ReactNode {
  const [active, setActive] = useState(0)
  const [alwaysId, setAlwaysId] = useState<string | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const useGrid = profiles.length >= GRID_THRESHOLD

  useEffect(() => {
    setActive(0)
    setAlwaysId(null)
    rootRef.current?.focus()
  }, [profiles])

  useEffect(() => {
    if (active < 0 || active >= profiles.length) setActive(0)
  }, [active, profiles.length])

  function onKeyDown(event: ReactKeyboardEvent<HTMLDivElement>): void {
    if (profiles.length === 0) return
    if (event.key === 'Escape') {
      event.preventDefault()
      onCancel()
      return
    }
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      event.preventDefault()
      setActive((i) => (i + 1) % profiles.length)
      return
    }
    if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      event.preventDefault()
      setActive((i) => (i - 1 + profiles.length) % profiles.length)
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      const p = profiles[active]
      if (p) onChoose(p.directoryId, { always: alwaysId === p.directoryId })
      return
    }
    const digit = event.key >= '1' && event.key <= '9' ? Number(event.key) : 0
    if (digit >= 1 && digit <= profiles.length) {
      event.preventDefault()
      const p = profiles[digit - 1]
      if (p) onChoose(p.directoryId, { always: alwaysId === p.directoryId })
    }
  }

  const fanClass = [
    'chrome-profile-fan',
    useGrid ? 'is-grid' : 'is-fan',
    reducedMotion ? 'is-reduced' : ''
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div
      ref={rootRef}
      className={fanClass}
      data-hit="chrome-profiles"
      role="listbox"
      tabIndex={0}
      aria-label="Chrome profiles"
      onKeyDown={onKeyDown}
    >
      <p className="chrome-profile-fan-title">
        Which Chrome profile?
        {pendingLabel ? <span className="chrome-profile-fan-pending"> · {pendingLabel}</span> : null}
      </p>
      <div className="chrome-profile-fan-cards">
        {profiles.map((profile, index) => {
          const selected = index === active
          const angle = useGrid || profiles.length <= 1 ? 0 : (index - (profiles.length - 1) / 2) * 9
          return (
            <button
              type="button"
              role="option"
              key={profile.directoryId}
              aria-selected={selected}
              className={selected ? 'chrome-profile-card is-active' : 'chrome-profile-card'}
              style={
                useGrid
                  ? undefined
                  : ({
                      ['--fan-angle' as string]: `${angle}deg`,
                      ['--fan-z' as string]: String(10 + index),
                      ['--fan-accent' as string]: profile.accent || 'rgba(255, 196, 120, 0.55)'
                    } as CSSProperties)
              }
              onMouseEnter={() => setActive(index)}
              onClick={() => onChoose(profile.directoryId, { always: alwaysId === profile.directoryId })}
            >
              <span className="chrome-profile-index">{index + 1}</span>
              <span className="chrome-profile-avatar" aria-hidden="true">
                {profile.avatarDataUrl ? (
                  <img src={profile.avatarDataUrl} alt="" />
                ) : (
                  <span className="chrome-profile-initials">{profile.initials}</span>
                )}
              </span>
              <span className="chrome-profile-meta">
                <span className="chrome-profile-name">{profile.displayName}</span>
                {profile.secondaryLabel ? (
                  <span className="chrome-profile-secondary">{profile.secondaryLabel}</span>
                ) : null}
                {profile.isSavedDefault ? <span className="chrome-profile-badge">Default</span> : null}
              </span>
            </button>
          )
        })}
      </div>
      {profiles[active] ? (
        <label className="chrome-profile-always">
          <input
            type="checkbox"
            checked={alwaysId === profiles[active]!.directoryId}
            onChange={(e) => {
              const id = profiles[active]!.directoryId
              setAlwaysId(e.target.checked ? id : null)
            }}
          />
          Always use “{profiles[active]!.displayName}”
        </label>
      ) : null}
      <div className="chrome-profile-fan-actions">
        <button type="button" className="glass-button" onClick={onCancel}>
          Cancel
        </button>
        <span className="chrome-profile-hint">↑↓ / numbers · Enter · Esc</span>
      </div>
    </div>
  )
}
