import { useEffect, useRef, useState } from 'react'
import restUrl from '../assets/miko-phase2-cleaned/rest.png'
import blinkUrl from '../assets/miko-phase2-cleaned/blink.png'
import petUrl from '../assets/miko-phase2-cleaned/pet.png'
import puppyUrl from '../assets/puppy.svg'

const BLINK_MS = 120
const BLINK_GAP_MS = 5200

interface PetViewProps {
  reacting: boolean
  exiting: boolean
}

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches)

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const onChange = (): void => setReduced(media.matches)
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [])

  return reduced
}

/**
 * Cleaned puppy in the same 168×200 box as the placeholder.
 * Curious stays in the Phase 2 preview. The resting SVG is only a load fallback.
 */
export function PetView({ reacting, exiting }: PetViewProps) {
  const reducedMotion = usePrefersReducedMotion()
  const [restFailed, setRestFailed] = useState(false)
  const [blinkReady, setBlinkReady] = useState(false)
  const [petReady, setPetReady] = useState(false)
  const [blinking, setBlinking] = useState(false)
  const timers = useRef<number[]>([])

  useEffect(() => {
    let cancelled = false
    const preload = (url: string, mark: (ready: boolean) => void): void => {
      const image = new Image()
      image.onload = () => {
        if (!cancelled) mark(true)
      }
      image.onerror = () => {
        if (!cancelled) mark(false)
      }
      image.src = url
    }
    preload(blinkUrl, setBlinkReady)
    preload(petUrl, setPetReady)
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const pending = timers.current
    const clearTimers = (): void => {
      for (const id of pending) window.clearTimeout(id)
      pending.length = 0
    }
    const stopBlink = (): void => {
      clearTimers()
      setBlinking(false)
    }

    if (reducedMotion || restFailed || reacting || exiting || !blinkReady) {
      stopBlink()
      return
    }

    let alive = true
    const later = (fn: () => void, ms: number): void => {
      const id = window.setTimeout(() => {
        const index = pending.indexOf(id)
        if (index >= 0) pending.splice(index, 1)
        if (alive) fn()
      }, ms)
      pending.push(id)
    }
    const schedule = (): void => {
      later(() => {
        if (document.hidden) return
        setBlinking(true)
        later(() => {
          setBlinking(false)
          if (!document.hidden) schedule()
        }, BLINK_MS)
      }, BLINK_GAP_MS)
    }
    const onVisibility = (): void => {
      stopBlink()
      if (!document.hidden) schedule()
    }

    document.addEventListener('visibilitychange', onVisibility)
    if (!document.hidden) schedule()
    return () => {
      alive = false
      clearTimers()
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [reducedMotion, restFailed, reacting, exiting, blinkReady])

  const pose = restFailed ? 'fallback' : reacting && petReady ? 'pet' : blinking && blinkReady ? 'blink' : 'rest'
  const src = pose === 'fallback' ? puppyUrl : pose === 'pet' ? petUrl : pose === 'blink' ? blinkUrl : restUrl

  return (
    <span className={exiting ? 'pet-art is-exiting' : reducedMotion ? 'pet-art' : 'pet-art is-idle'}>
      <img
        src={src}
        alt=""
        draggable={false}
        onError={() => {
          if (pose === 'rest' || pose === 'fallback') setRestFailed(true)
        }}
      />
    </span>
  )
}
