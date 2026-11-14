import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { HitRect, PanelLayout } from '../../shared/api'
import { EXIT_MS } from '../../shared/summon'
import { PetView } from './components/PetView'
import { TextPanel } from './components/TextPanel'
import { usePetGestures } from './hooks/usePetGestures'

const HIT_SLOP_PX = 2

export function App() {
  const [panelOpen, setPanelOpen] = useState(false)
  const [panelSide, setPanelSide] = useState<'left' | 'right'>('left')
  const [exiting, setExiting] = useState(false)
  const panelRequest = useRef(0)
  const exitTimer = useRef<number | null>(null)
  const bridgeMissing = typeof window.miko === 'undefined'

  async function applyPanel(open: boolean): Promise<void> {
    if (typeof window.miko === 'undefined') return
    const request = ++panelRequest.current
    window.miko.setHitRects([])
    const layout: PanelLayout = await window.miko.setPanelOpen(open)
    if (request !== panelRequest.current) return
    setPanelSide(layout.panelSide)
    setPanelOpen(layout.panelOpen)
  }

  const gestures = usePetGestures({
    onOpenPanel: () => {
      void applyPanel(true)
    }
  })

  useEffect(() => {
    if (typeof window.miko === 'undefined') return
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const publish = (): void => window.miko.setReducedMotion(media.matches)
    publish()
    media.addEventListener('change', publish)
    const stop = window.miko.onPresence((event) => {
      if (exitTimer.current !== null) {
        window.clearTimeout(exitTimer.current)
        exitTimer.current = null
      }
      if (event.phase === 'hidden') {
        setExiting(false)
        setPanelOpen(false)
        return
      }
      if (event.phase === 'shown') {
        setExiting(false)
        return
      }
      if (media.matches) {
        window.miko.exitFinished(event.generation)
        return
      }
      setExiting(true)
      exitTimer.current = window.setTimeout(() => {
        exitTimer.current = null
        window.miko.exitFinished(event.generation)
      }, EXIT_MS)
    })
    return () => {
      media.removeEventListener('change', publish)
      stop()
      if (exitTimer.current !== null) window.clearTimeout(exitTimer.current)
    }
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || !panelOpen) return
      event.preventDefault()
      void applyPanel(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [panelOpen])

  useLayoutEffect(() => {
    if (typeof window.miko === 'undefined') return
    let frame = 0
    const report = (): void => {
      const rects: HitRect[] = []
      document.querySelectorAll<HTMLElement>('[data-hit]').forEach((element) => {
        const rect = element.getBoundingClientRect()
        if (rect.width <= 0 || rect.height <= 0) return
        rects.push({
          x: rect.left - HIT_SLOP_PX,
          y: rect.top - HIT_SLOP_PX,
          width: rect.width + HIT_SLOP_PX * 2,
          height: rect.height + HIT_SLOP_PX * 2
        })
      })
      window.miko.setHitRects(rects)
    }
    const schedule = (): void => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(report)
    }
    schedule()
    const observer = new ResizeObserver(schedule)
    observer.observe(document.documentElement)
    document.querySelectorAll('[data-hit]').forEach((element) => observer.observe(element))
    window.addEventListener('resize', schedule)
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      window.removeEventListener('resize', schedule)
    }
  }, [panelOpen, panelSide])

  useEffect(() => {
    return () => {
      window.miko?.setHitRects([])
    }
  }, [])

  if (bridgeMissing) {
    return (
      <div className="stage">
        <p className="bridge-error" data-hit="error">
          MIKO could not reach its preload bridge.
        </p>
      </div>
    )
  }

  const stageClass = panelOpen ? `stage is-open panel-${panelSide}` : 'stage'
  const petClass = [
    'pet-hit',
    gestures.armed ? 'is-armed' : '',
    gestures.dragging ? 'is-dragging' : ''
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div className={stageClass}>
      {panelOpen ? (
        <TextPanel
          onClose={() => {
            void applyPanel(false)
          }}
        />
      ) : null}
      <div className="pet-slot">
        <button
          type="button"
          className={petClass}
          data-hit="pet"
          aria-label="MIKO. Click to pet. Double-click to write a note. Hold Alt or Option and drag to move."
          onPointerDown={gestures.onPointerDown}
          onPointerMove={gestures.onPointerMove}
          onPointerUp={gestures.onPointerUp}
          onPointerCancel={gestures.onPointerUp}
          onClick={gestures.onClick}
          onDoubleClick={gestures.onDoubleClick}
          onContextMenu={(event) => event.preventDefault()}
        >
          <PetView reacting={gestures.reacting} exiting={exiting} />
        </button>
      </div>
    </div>
  )
}
