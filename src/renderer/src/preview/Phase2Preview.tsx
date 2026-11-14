import { useEffect, useRef, useState } from 'react'
import blinkUrl from '../assets/miko-phase2-frames/blink.png'
import curiousUrl from '../assets/miko-phase2-frames/curious.png'
import petUrl from '../assets/miko-phase2-frames/pet.png'
import restUrl from '../assets/miko-phase2-frames/rest.png'
import blinkCleanUrl from '../assets/miko-phase2-cleaned/blink.png'
import curiousCleanUrl from '../assets/miko-phase2-cleaned/curious.png'
import petCleanUrl from '../assets/miko-phase2-cleaned/pet.png'
import restCleanUrl from '../assets/miko-phase2-cleaned/rest.png'

const POSE_WIDTH = 168
const POSE_HEIGHT = 200
const BLEND_MS = 80

const SETS = {
  original: {
    rest: restUrl,
    blink: blinkUrl,
    pet: petUrl,
    curious: curiousUrl
  },
  cleaned: {
    rest: restCleanUrl,
    blink: blinkCleanUrl,
    pet: petCleanUrl,
    curious: curiousCleanUrl
  }
} as const

type FrameSet = keyof typeof SETS
type FrameName = keyof (typeof SETS)['original']
type HeldFrame = Exclude<FrameName, 'rest'>

const HOLD_MS: Record<HeldFrame, number> = {
  blink: 120,
  pet: 400,
  curious: 500
}

const FRAME_FILE: Record<FrameName, string> = {
  rest: 'rest.png',
  blink: 'blink.png',
  pet: 'pet.png',
  curious: 'curious.png'
}

export function Phase2Preview() {
  const [theme, setTheme] = useState<'light' | 'dark'>('light')
  const [source, setSource] = useState<FrameSet>('cleaned')
  const [breathing, setBreathing] = useState(true)
  const [change, setChange] = useState<'snap' | 'blend'>('snap')
  const [frame, setFrame] = useState<FrameName>('rest')
  const [overlay, setOverlay] = useState<HeldFrame | null>(null)
  const [overlayVisible, setOverlayVisible] = useState(false)
  const [ready, setReady] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const timers = useRef<number[]>([])
  const playId = useRef(0)
  const frames = SETS[source]

  useEffect(() => {
    let cancelled = false
    const sources = Object.entries(SETS).flatMap(([setName, set]) =>
      Object.entries(set).map(([name, src]) => ({ name: `${setName}/${name}`, src }))
    )
    Promise.all(
      sources.map(
        ({ name, src }) =>
          new Promise<void>((resolve, reject) => {
            const image = new Image()
            image.onload = () => resolve()
            image.onerror = () => reject(new Error(name))
            image.src = src
          })
      )
    )
      .then(() => {
        if (!cancelled) setReady(true)
      })
      .catch((error: unknown) => {
        if (cancelled) return
        const name = error instanceof Error ? error.message : 'frame'
        setLoadError(name)
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const pending = timers.current
    return () => {
      for (const id of pending) window.clearTimeout(id)
    }
  }, [])

  function clearTimers(): void {
    for (const id of timers.current) window.clearTimeout(id)
    timers.current = []
  }

  function later(fn: () => void, ms: number, id: number): void {
    const timer = window.setTimeout(() => {
      timers.current = timers.current.filter((item) => item !== timer)
      if (playId.current === id) fn()
    }, ms)
    timers.current.push(timer)
  }

  function play(next: HeldFrame): void {
    const id = playId.current + 1
    playId.current = id
    clearTimers()
    if (change === 'blend' && next !== 'blink') {
      setFrame('rest')
      setOverlay(next)
      setOverlayVisible(false)
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          if (playId.current === id) setOverlayVisible(true)
        })
      })
      later(
        () => {
          setOverlayVisible(false)
          later(() => setOverlay(null), BLEND_MS, id)
        },
        HOLD_MS[next],
        id
      )
      return
    }
    setOverlay(null)
    setOverlayVisible(false)
    setFrame(next)
    later(() => setFrame('rest'), HOLD_MS[next], id)
  }

  function selectChange(next: 'snap' | 'blend'): void {
    playId.current += 1
    clearTimers()
    setOverlay(null)
    setOverlayVisible(false)
    setFrame('rest')
    setChange(next)
  }

  const showing = overlay ?? frame

  return (
    <main className="preview">
      <header className="preview-bar">
        <div>
          <h1>MIKO Phase 2 preview</h1>
          <p>Separate from the desktop pet. The live puppy is still puppy.svg.</p>
        </div>
      </header>
      <div className="toggles">
        <button
          type="button"
          className="toggle"
          aria-pressed={theme === 'dark'}
          onClick={() => setTheme((current) => (current === 'light' ? 'dark' : 'light'))}
        >
          {theme === 'light' ? 'Dark background' : 'Light background'}
        </button>
        <button
          type="button"
          className="toggle"
          aria-pressed={source === 'cleaned'}
          onClick={() => setSource((current) => (current === 'original' ? 'cleaned' : 'original'))}
        >
          {source === 'cleaned' ? 'Cleaned' : 'Original'}
        </button>
        <button
          type="button"
          className="toggle"
          aria-pressed={breathing}
          onClick={() => setBreathing((current) => !current)}
        >
          {breathing ? 'Breathing on' : 'Breathing off'}
        </button>
        <button
          type="button"
          className="toggle"
          aria-pressed={change === 'blend'}
          onClick={() => selectChange(change === 'snap' ? 'blend' : 'snap')}
        >
          {change === 'snap' ? 'Snap' : 'Blend'}
        </button>
      </div>
      <section className={theme === 'dark' ? 'stage is-dark' : 'stage is-light'} aria-label="Puppy silhouette">
        <figure className="pose">
          <div className="pose-box">
            <div className={breathing ? 'pose-sprite is-breathing' : 'pose-sprite'}>
              <img
                src={frames[frame]}
                width={POSE_WIDTH}
                height={POSE_HEIGHT}
                alt=""
                draggable={false}
              />
              {overlay ? (
                <img
                  className={overlayVisible ? 'overlay is-on' : 'overlay'}
                  src={frames[overlay]}
                  width={POSE_WIDTH}
                  height={POSE_HEIGHT}
                  alt=""
                  draggable={false}
                />
              ) : null}
            </div>
          </div>
          <figcaption>
            {source} / {FRAME_FILE[showing]}
          </figcaption>
        </figure>
      </section>
      <div className="controls">
        <button type="button" disabled={!ready} onClick={() => play('blink')}>
          Idle blink
          <span>120 ms</span>
        </button>
        <button type="button" disabled={!ready} onClick={() => play('pet')}>
          Petting
          <span>400 ms</span>
        </button>
        <button type="button" disabled={!ready} onClick={() => play('curious')}>
          Curious
          <span>500 ms</span>
        </button>
      </div>
      <p className="status">
        {loadError
          ? `Could not preload ${loadError}.png.`
          : ready
            ? 'Eight frames preloaded. No position offsets. Snap is the preview.'
            : 'Preloading eight frames…'}
      </p>
      <p className="alignment">
        curious.png still moves only the head, about 4 CSS pixels left of rest.png, with the paws
        planted. Breathing scales from the paw baseline and can be switched off. A blend of pet or
        curious against rest draws a second outline on the face or tail, so those poses stay a snap.
        Blink timing is unchanged.
      </p>
    </main>
  )
}
