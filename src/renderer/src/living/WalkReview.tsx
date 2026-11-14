import { useEffect, useRef, useState } from 'react'
import {
  WALK_BOX_WIDTH,
  WALK_CYCLE_SECONDS,
  WALK_FRAME_COUNT,
  WALK_SLOW_RATE,
  WALK_TOE,
  WALK_TORSO_TRAVEL_SOURCE,
  stepWalkFrame,
  travelPxPerCycle,
  walkDisplayHeight,
  walkFrameIndex,
  walkImageTop,
  walkPawLine,
  walkTravelX
} from '../../../shared/walk-review'
import { WALK_FRAME_URLS, WALK_STANCE_CHECKS } from './walk-frames'

const BOX_TOP = 28

type Placement = 'still' | 'travel'
type Playback = 'play' | 'step'

export function WalkReview() {
  const [placement, setPlacement] = useState<Placement>('still')
  const [playback, setPlayback] = useState<Playback>('play')
  const [rate, setRate] = useState<number>(1)
  const [frame, setFrame] = useState(0)
  const elapsedRef = useRef(0)
  const placementRef = useRef<Placement>('still')
  const playbackRef = useRef<Playback>('play')
  const rateRef = useRef(1)
  const frameRef = useRef(0)
  const trackRef = useRef<HTMLDivElement>(null)
  const boxesRef = useRef<Array<HTMLDivElement | null>>([])

  const place = (elapsed: number): void => {
    const width = trackRef.current?.clientWidth ?? 0
    const span = Math.max(1, width - WALK_BOX_WIDTH - 32)
    const left =
      placementRef.current === 'still' ? Math.max(0, (width - WALK_BOX_WIDTH) / 2) : 16 + positiveMod(walkTravelX(elapsed), span)
    for (const box of boxesRef.current) {
      if (box) box.style.left = `${left}px`
    }
  }

  const showFrame = (index: number, elapsed: number): void => {
    elapsedRef.current = elapsed
    frameRef.current = index
    setFrame(index)
    place(elapsed)
  }

  useEffect(() => {
    placementRef.current = placement
    place(elapsedRef.current)
  }, [placement])

  useEffect(() => {
    playbackRef.current = playback
    rateRef.current = rate
    if (playback !== 'play') return
    let raf = 0
    let last = performance.now()
    const tick = (now: number): void => {
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      if (playbackRef.current !== 'play') return
      const elapsed = elapsedRef.current + dt * rateRef.current
      elapsedRef.current = elapsed
      const next = walkFrameIndex(elapsed)
      if (next !== frameRef.current) {
        frameRef.current = next
        setFrame(next)
      }
      place(elapsed)
      raf = window.requestAnimationFrame(tick)
    }
    raf = window.requestAnimationFrame(tick)
    return () => window.cancelAnimationFrame(raf)
  }, [playback, rate])

  useEffect(() => {
    const track = trackRef.current
    if (!track) return
    const observer = new ResizeObserver(() => place(elapsedRef.current))
    observer.observe(track)
    place(elapsedRef.current)
    const onKey = (event: KeyboardEvent): void => {
      if (event.metaKey || event.ctrlKey || event.altKey) return
      if (event.key === 'ArrowRight') {
        event.preventDefault()
        nudge(1)
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault()
        nudge(-1)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      observer.disconnect()
      window.removeEventListener('keydown', onKey)
    }
  }, [])

  const nudge = (direction: -1 | 1): void => {
    const shown = frameRef.current
    const next = stepWalkFrame(shown, direction)
    const cycle = Math.floor(elapsedRef.current / WALK_CYCLE_SECONDS)
    const nextCycle = direction === 1 && shown === WALK_FRAME_COUNT - 1 ? cycle + 1 : direction === -1 && shown === 0 ? Math.max(0, cycle - 1) : cycle
    const elapsed = nextCycle * WALK_CYCLE_SECONDS + (next / WALK_FRAME_COUNT) * WALK_CYCLE_SECONDS
    playbackRef.current = 'step'
    setPlayback('step')
    showFrame(next, elapsed)
  }

  const playAt = (nextRate: number): void => {
    rateRef.current = nextRate
    playbackRef.current = 'play'
    setRate(nextRate)
    setPlayback('play')
  }

  const pxPerCycle = travelPxPerCycle()
  const pxPerSecond = (pxPerCycle / WALK_CYCLE_SECONDS) * (playback === 'step' ? 0 : rate)
  const speed =
    playback === 'step'
      ? 'held frame'
      : rate === 1
        ? `${WALK_CYCLE_SECONDS} s per stride`
        : `0.25× · ${(WALK_CYCLE_SECONDS / WALK_SLOW_RATE).toFixed(0)} s per stride`
  const motion =
    placement === 'still' ? 'in place' : playback === 'step' ? 'travel held' : `traveling · ${pxPerSecond.toFixed(1)} px/s`

  return (
    <section className="walk-review">
      <div className="actions">
        <button type="button" aria-pressed={placement === 'still'} onClick={() => setPlacement('still')}>
          In place
        </button>
        <button type="button" aria-pressed={placement === 'travel'} onClick={() => setPlacement('travel')}>
          Travel right
        </button>
        <button type="button" aria-pressed={playback === 'play' && rate === 1} onClick={() => playAt(1)}>
          Original
        </button>
        <button type="button" aria-pressed={playback === 'play' && rate === WALK_SLOW_RATE} onClick={() => playAt(WALK_SLOW_RATE)}>
          0.25×
        </button>
        <button type="button" onClick={() => nudge(-1)}>
          Previous frame
        </button>
        <button type="button" onClick={() => nudge(1)}>
          Next frame
        </button>
      </div>
      <div className="walk-stages">
        {(['light', 'dark'] as const).map((theme, index) => (
          <div
            key={theme}
            className={`walk-stage is-${theme}`}
            ref={index === 0 ? trackRef : undefined}
          >
            <span className="walk-tag">{theme === 'light' ? 'Light' : 'Dark'}</span>
            <div className="walk-ground" style={{ top: BOX_TOP + walkPawLine() }} />
            <div
              className="walk-box"
              ref={(element) => {
                boxesRef.current[index] = element
              }}
              style={{ top: BOX_TOP }}
            >
              <img
                src={WALK_FRAME_URLS[frame]}
                alt={`walk-${String(frame).padStart(2, '0')}`}
                draggable={false}
                style={{ top: walkImageTop(), height: walkDisplayHeight() }}
              />
            </div>
          </div>
        ))}
      </div>
      <p className="phase">
        {`walk-${String(frame).padStart(2, '0')}`}
        {` · ${motion}`}
        {` · ${speed}`}
      </p>
      <p className="walk-note">
        One stride, from one landing of the front paw to the next, kept at the clip’s 24 fps timing. The torso moves
        forward {WALK_TORSO_TRAVEL_SOURCE} pixels in the original frame, which is {pxPerCycle.toFixed(1)} CSS pixels
        per stride in this box.
      </p>
      <div className="walk-findings">
        <article>
          <h2>Frames 119 and 143 · paw check, before the background was removed</h2>
          <p>
            These two frames are one second apart on the locked camera. The front paw’s toe moves from x{' '}
            {WALK_TOE.atFrame119} to x {WALK_TOE.atFrame143}. It does not stay on one spot of the floor.
          </p>
          <div className="walk-pair">
            {WALK_STANCE_CHECKS.map((check) => (
              <figure className="walk-check" key={check.label}>
                <img src={check.src} alt={check.label} draggable={false} />
                <figcaption>{check.label}</figcaption>
              </figure>
            ))}
          </div>
        </article>
      </div>
    </section>
  )
}

function positiveMod(value: number, span: number): number {
  if (span <= 0) return 0
  return ((value % span) + span) % span
}
