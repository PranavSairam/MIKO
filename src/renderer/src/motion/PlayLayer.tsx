import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactElement, type RefObject } from 'react'
import type { HitRect } from '../../../shared/api'
import { insideRect, TOYS, TREATS, type PlayState, type Toy, type Treat } from '../../../shared/play'

export type PlayMenu = 'closed' | 'main' | 'fetch' | 'feed'

export interface PlayEffect {
  id: number
  kind: 'heart' | 'crumb' | 'spark'
  x: number
  y: number
}

/** Inline SVG (emoji differ between Windows versions). Same art as the thrown toy window. */
const ICON: Record<Toy | Treat, ReactElement> = {
  ball: (
    <svg viewBox="0 0 34 34" width="26" height="26">
      <circle cx="17" cy="17" r="14" fill="#d9f24a" stroke="#8aa21c" strokeWidth="2" />
      <path d="M5 12c7 3 17 3 24 0M5 22c7-3 17-3 24 0" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
    </svg>
  ),
  stick: (
    <svg viewBox="0 0 34 34" width="26" height="26">
      <g transform="rotate(-25 17 17)">
        <rect x="3" y="14" width="28" height="6" rx="3" fill="#9a6a3a" stroke="#6b4423" strokeWidth="1.5" />
        <path d="M20 14l4-5" stroke="#6b4423" strokeWidth="2" strokeLinecap="round" />
      </g>
    </svg>
  ),
  bone: (
    <svg viewBox="0 0 34 34" width="26" height="26">
      <path
        d="M9 12a4 4 0 1 1 3-5l10 10a4 4 0 1 1 5 3 4 4 0 1 1-5 3L12 13a4 4 0 1 1-3-1z"
        fill="#f4ecd8"
        stroke="#b9a37a"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  ),
  biscuit: (
    <svg viewBox="0 0 34 34" width="26" height="26">
      <rect x="6" y="9" width="22" height="16" rx="4" fill="#d9a35a" stroke="#9c6a2c" strokeWidth="1.5" />
      <circle cx="12" cy="15" r="1.4" fill="#9c6a2c" />
      <circle cx="18" cy="19" r="1.4" fill="#9c6a2c" />
      <circle cx="23" cy="14" r="1.4" fill="#9c6a2c" />
    </svg>
  )
}
const TOY_PX = 30
/** Pet slot height and the ground pad under the paws (match layout PET_WINDOW / GROUND_PAD_PX). */
const PET_SLOT_H = 250
const GROUND_PX = 8

/**
 * Casual-mode Play UI, drawn inside the pet window (never a full-screen overlay).
 * Only the visible controls are click targets (data-hit); everything else stays click-through.
 * Dragging holds the pointer for this window only while a toy or treat is held.
 */
export function PlayLayer({
  play,
  menu,
  hit,
  facing,
  reducedMotion,
  hint,
  effects,
  chip,
  restingToys,
  carryRef,
  onMenu,
  onChoose,
  onDone,
  onThrow,
  onFeed,
  onDropTarget
}: {
  play: PlayState
  menu: PlayMenu
  /** The pet's own hit rect (slot coordinates). */
  hit: HitRect
  facing: 1 | -1
  reducedMotion: boolean
  hint: string
  effects: PlayEffect[]
  /** Casual mode, pointer near the pet: show the small Play button. */
  chip: boolean
  /** Casual mode and nothing else going on: the ball and stick rest beside the pet, ready to grab. */
  restingToys: boolean
  carryRef: RefObject<HTMLDivElement | null>
  onMenu: (menu: PlayMenu) => void
  onChoose: (choice: { activity: 'fetch'; toy: Toy } | { activity: 'feed'; treat: Treat } | { activity: 'pet' }) => void
  onDone: () => void
  onThrow: (release: { x: number; y: number; vx: number; vy: number }, toy: Toy) => void
  onFeed: () => void
  onDropTarget: (over: boolean) => void
}) {
  const slotW = 220
  // The resting toy lies in front of the pet, on the ground.
  const restX = facing === 1 ? Math.min(hit.x + hit.width + 6, slotW - TOY_PX) : Math.max(4, hit.x - TOY_PX - 6)
  const ready = play.phase === 'ready'
  const fetchReady = ready && play.activity === 'fetch'
  // Fixed spots either side of the pet's feet (ball left, stick right), inside the pet window:
  // they never cover the pet, and they move with MIKO (so they stay on screen at display edges).
  // Anchored to the window's ground line and edges, not to the pet's box: they don't float up with
  // the flying bird or slide when the pet turns.
  const floorY = PET_SLOT_H - GROUND_PX - TOY_PX
  const spots: Record<Toy, { x: number; y: number }> = {
    ball: { x: 4, y: floorY },
    stick: { x: slotW - TOY_PX - 4, y: floorY }
  }
  const inPlay = play.phase === 'activity' || (play.phase === 'reaction' && play.activity === 'fetch') ? play.toy : null
  const restingList: Toy[] = restingToys || fetchReady ? (['ball', 'stick'] as Toy[]).filter((t) => t !== inPlay) : []
  const treat = ready && play.activity === 'feed' ? play.treat : null
  const carrying = play.phase === 'activity' && play.step === 'carrying'
  const carriedToy = play.phase === 'activity' ? play.toy : null
  const dropped = play.phase === 'reaction' && play.activity === 'fetch' && play.toy

  return (
    <div className={`play-layer${reducedMotion ? ' is-reduced' : ''}`} aria-live="polite">
      {menu !== 'closed' ? (
        <div className="play-menu" data-hit="play-menu" role="toolbar" aria-label="Play">
          {menu === 'main' ? (
            <>
              <button type="button" onClick={() => onMenu('fetch')} title="Fetch: pick a toy, then drag and let go to throw it">
                Fetch
              </button>
              <button type="button" onClick={() => onMenu('feed')} title="Feed: pick a treat and drag it onto MIKO">
                Feed
              </button>
              <button type="button" onClick={() => onChoose({ activity: 'pet' })} title="Pet: stroke MIKO with the pointer">
                Pet
              </button>
              <button type="button" className="is-done" onClick={onDone}>
                Done
              </button>
            </>
          ) : menu === 'fetch' ? (
            <>
              {TOYS.map((item) => (
                <button key={item.id} type="button" onClick={() => onChoose({ activity: 'fetch', toy: item.id })}>
                  <span aria-hidden="true">{ICON[item.id]}</span> {item.label}
                </button>
              ))}
              <button type="button" className="is-back" aria-label="Back" onClick={() => onMenu('main')}>
                ←
              </button>
            </>
          ) : (
            <>
              {TREATS.map((item) => (
                <button key={item.id} type="button" onClick={() => onChoose({ activity: 'feed', treat: item.id })}>
                  <span aria-hidden="true">{ICON[item.id]}</span> {item.label}
                </button>
              ))}
              <button type="button" className="is-back" aria-label="Back" onClick={() => onMenu('main')}>
                ←
              </button>
            </>
          )}
        </div>
      ) : chip ? (
        <button type="button" className="play-chip" data-hit="play-chip" aria-label="Play with MIKO" onClick={() => onMenu('main')}>
          Play
        </button>
      ) : null}

      {restingList.map((item) => (
        <Draggable
          key={`toy-${item}-${play.phase === 'activity' ? 'busy' : play.token}`}
          label={`${item === 'ball' ? 'Ball' : 'Stick'}: drag and let go to throw`}
          icon={ICON[item]}
          start={spots[item]}
          onRelease={(at, velocity, moved) => {
            const cx = at.x + TOY_PX / 2
            const cy = at.y + TOY_PX / 2
            // A tiny nudge isn't a throw: the toy settles back where it was.
            if (!moved && play.phase === 'activity') return 'back'
            onThrow({ x: cx, y: cy, vx: moved ? velocity.vx : 0, vy: moved ? velocity.vy : 0 }, item)
            return 'gone'
          }}
        />
      ))}

      {treat ? (
        <Draggable
          key={`treat-${play.token}`}
          label={`${treat === 'bone' ? 'Bone' : 'Biscuit'}: drag onto MIKO`}
          icon={ICON[treat]}
          start={{ x: 8, y: 44 }}
          onMove={(at) => onDropTarget(insideRect(at.x + TOY_PX / 2, at.y + TOY_PX / 2, hit, 6))}
          onRelease={(at) => {
            onDropTarget(false)
            if (insideRect(at.x + TOY_PX / 2, at.y + TOY_PX / 2, hit, 6)) {
              onFeed()
              return 'gone'
            }
            return 'back'
          }}
        />
      ) : null}

      <div ref={carryRef} className="play-carry" aria-hidden="true" style={{ display: carrying && carriedToy ? 'grid' : 'none' }}>
        {carriedToy ? ICON[carriedToy] : null}
      </div>

      {dropped ? (
        <div className="play-dropped" aria-hidden="true" style={{ left: restX, top: PET_SLOT_H - GROUND_PX - TOY_PX }}>
          {ICON[dropped]}
        </div>
      ) : null}

      {effects.map((effect) => (
        <span key={effect.id} className={`play-effect is-${effect.kind}`} aria-hidden="true" style={{ left: effect.x, top: effect.y }}>
          {effect.kind === 'heart' ? '♥' : effect.kind === 'crumb' ? '•' : '✦'}
        </span>
      ))}

      {hint ? (
        <p className="play-hint" role="status">
          {hint}
        </p>
      ) : null}
    </div>
  )
}

/** A toy or treat the user drags with the pointer. Never leaves the pet window. */
function Draggable({
  label,
  icon,
  start,
  onMove,
  onRelease
}: {
  label: string
  icon: ReactElement
  start: { x: number; y: number }
  onMove?: (at: { x: number; y: number }) => void
  onRelease: (at: { x: number; y: number }, velocity: { vx: number; vy: number }, moved: boolean) => 'gone' | 'back'
}) {
  const [at, setAt] = useState(start)
  const [gone, setGone] = useState(false)
  const [held, setHeld] = useState(false)
  const grab = useRef({ dx: 0, dy: 0, sx: 0, sy: 0, id: -1 })
  const samples = useRef<{ t: number; x: number; y: number }[]>([])

  useEffect(() => {
    setAt(start)
    // Only when the resting spot itself changes (pet turned / moved), not on every render.
  }, [start.x, start.y])

  useEffect(
    () => () => {
      // Unmounted mid-drag (cancel, Escape, Dismiss): never leave the window holding the pointer.
      if (grab.current.id >= 0) window.miko?.setPointerHeld(false)
    },
    []
  )

  if (gone) return null

  const clampTo = (x: number, y: number): { x: number; y: number } => ({
    x: Math.max(0, Math.min(window.innerWidth - TOY_PX, x)),
    y: Math.max(0, Math.min(window.innerHeight - TOY_PX, y))
  })

  const finish = (event: ReactPointerEvent<HTMLButtonElement>, cancelled: boolean): void => {
    if (grab.current.id !== event.pointerId) return
    const target = event.currentTarget
    if (target.hasPointerCapture(event.pointerId)) target.releasePointerCapture(event.pointerId)
    grab.current.id = -1
    setHeld(false)
    window.miko?.setPointerHeld(false)
    if (cancelled) {
      setAt(start)
      return
    }
    const list = samples.current
    const now = performance.now()
    const recent = list.filter((s) => now - s.t <= 100)
    const first = recent[0] ?? list[0]
    const last = list[list.length - 1]
    let vx = 0
    let vy = 0
    if (first && last && last.t > first.t) {
      const seconds = (last.t - first.t) / 1000
      vx = (last.x - first.x) / seconds
      vy = (last.y - first.y) / seconds
    }
    const moved = Math.hypot(event.clientX - grab.current.sx, event.clientY - grab.current.sy) >= 10
    const result = onRelease(at, { vx, vy }, moved)
    if (result === 'gone') setGone(true)
    else setAt(start)
  }

  return (
    <button
      type="button"
      className={`play-item${held ? ' is-held' : ''}`}
      data-hit="play-item"
      aria-label={label}
      title={label}
      style={{ left: at.x, top: at.y }}
      onPointerDown={(event) => {
        if (event.button !== 0) return
        event.stopPropagation()
        event.currentTarget.setPointerCapture(event.pointerId)
        grab.current = { dx: event.clientX - at.x, dy: event.clientY - at.y, sx: event.clientX, sy: event.clientY, id: event.pointerId }
        samples.current = [{ t: performance.now(), x: event.clientX, y: event.clientY }]
        setHeld(true)
        window.miko?.setPointerHeld(true)
      }}
      onPointerMove={(event) => {
        if (grab.current.id !== event.pointerId) return
        const next = clampTo(event.clientX - grab.current.dx, event.clientY - grab.current.dy)
        setAt(next)
        samples.current = [...samples.current.slice(-12), { t: performance.now(), x: event.clientX, y: event.clientY }]
        onMove?.(next)
      }}
      onPointerUp={(event) => finish(event, false)}
      onPointerCancel={(event) => finish(event, true)}
      onKeyDown={(event) => {
        // Keyboard: Enter / Space gives a gentle toss or offer.
        if (event.key !== 'Enter' && event.key !== ' ') return
        event.preventDefault()
        const result = onRelease(at, { vx: 0, vy: 0 }, false)
        if (result === 'gone') setGone(true)
      }}
    >
      <span aria-hidden="true">{icon}</span>
    </button>
  )
}
