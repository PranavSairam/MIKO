import { useEffect, useRef, useState } from 'react'
import { SEQUENCE_SECONDS, type SegmentName } from '../../../shared/sequence'
import { createLivingStage } from './LivingDog'
import { WalkReview } from './WalkReview'

const PHASE_LABEL: Record<SegmentName, string> = {
  peek: 'Peek',
  step: 'Step on',
  walk: 'Walk',
  look: 'Look back',
  turn: 'Turn',
  walkBack: 'Walk back',
  scratch: 'Scratch',
  rear: 'Rear',
  climb: 'Climb',
  slide: 'Slide',
  land: 'Land',
  shake: 'Shake',
  settle: 'Settle',
  duck: 'Duck'
}

const SLOW_RATE = 0.25

type PreviewView = 'walk' | 'rig'

export function LivingPreview() {
  const [view, setView] = useState<PreviewView>('walk')

  return (
    <main className="living">
      <header>
        <div>
          <h1>Living MIKO preview</h1>
          <p>
            {view === 'walk'
              ? 'Photo walk review. The desktop pet is still the seated puppy.'
              : 'Temporary rig for motion review. The desktop pet is still the cream-golden puppy.'}
          </p>
        </div>
        <div className="actions">
          <button type="button" aria-pressed={view === 'walk'} onClick={() => setView('walk')}>
            Walk review
          </button>
          <button type="button" aria-pressed={view === 'rig'} onClick={() => setView('rig')}>
            Rig sequence
          </button>
        </div>
      </header>
      {view === 'walk' ? <WalkReview /> : <RigSequence />}
    </main>
  )
}

function RigSequence() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [phase, setPhase] = useState<SegmentName>('peek')
  const [playing, setPlaying] = useState(true)
  const [rate, setRate] = useState(1)
  const [planted, setPlanted] = useState(0)
  const replay = useRef<(() => void) | null>(null)
  const rateRef = useRef(1)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const stage = createLivingStage(canvas)
    stage.resize()
    let frame = 0
    let time = 0
    let last = performance.now()
    let active = true
    let shown: SegmentName | '' = ''
    let ended = false
    const tick = (now: number): void => {
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      if (active && time < SEQUENCE_SECONDS) time += dt * rateRef.current
      if (time >= SEQUENCE_SECONDS) active = false
      const pose = stage.render(Math.min(time, SEQUENCE_SECONDS))
      if (pose.phase !== shown) {
        shown = pose.phase
        setPhase(pose.phase)
      }
      setPlanted((current) => (current === pose.planted ? current : pose.planted))
      if (!active && !ended) {
        ended = true
        setPlaying(false)
      }
      frame = window.requestAnimationFrame(tick)
    }
    const onResize = (): void => stage.resize()
    const replayCurrent = replay
    replayCurrent.current = () => {
      time = 0
      active = true
      ended = false
      last = performance.now()
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.metaKey || event.ctrlKey || event.altKey) return
      const key = event.key.toLowerCase()
      if (key === 'r') {
        rateRef.current = 1
        setRate(1)
        replayCurrent.current?.()
        setPlaying(true)
      } else if (key === 's') {
        rateRef.current = SLOW_RATE
        setRate(SLOW_RATE)
        replayCurrent.current?.()
        setPlaying(true)
      }
    }
    window.addEventListener('resize', onResize)
    window.addEventListener('keydown', onKey)
    frame = window.requestAnimationFrame(tick)
    return () => {
      active = false
      window.cancelAnimationFrame(frame)
      window.removeEventListener('resize', onResize)
      window.removeEventListener('keydown', onKey)
      stage.dispose()
      replayCurrent.current = () => undefined
    }
  }, [])

  return (
    <>
      <div className="actions">
        <button
          type="button"
          onClick={() => {
            rateRef.current = 1
            setRate(1)
            setPlaying(true)
            replay.current?.()
          }}
        >
          Replay
        </button>
        <button
          type="button"
          onClick={() => {
            rateRef.current = SLOW_RATE
            setRate(SLOW_RATE)
            setPlaying(true)
            replay.current?.()
          }}
        >
          Slow replay
        </button>
      </div>
      <canvas ref={canvasRef} />
      <p className="phase">
        {PHASE_LABEL[phase]}
        {` · ${planted} paws down`}
        {rate === 1 ? '' : ' · 0.25×'}
        {playing ? '' : ' · ended'}
      </p>
    </>
  )
}
