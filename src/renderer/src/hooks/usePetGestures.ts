import { useEffect, useRef, useState, type MouseEvent, type PointerEvent } from 'react'
import { DRAG_THRESHOLD_PX } from '../../../shared/guide'

const CLICK_DELAY_MS = 250
const REACT_MS = 400

export type GuidePhase = 'start' | 'move' | 'end' | 'cancel'

interface UsePetGesturesOptions {
  onOpenPanel: () => void
  /** Runs after the pet reaction on a confirmed single click (not a double-click). */
  onSingleClick?: () => void
  onGuide?: (phase: GuidePhase, screenX: number, screenY: number) => void
  onFreeDrag?: (phase: 'start' | 'end') => void
}

interface PetGestures {
  reacting: boolean
  armed: boolean
  dragging: boolean
  guiding: boolean
  onPointerDown: (event: PointerEvent<HTMLButtonElement>) => void
  onPointerMove: (event: PointerEvent<HTMLButtonElement>) => void
  onPointerUp: (event: PointerEvent<HTMLButtonElement>) => void
  onPointerCancel: (event: PointerEvent<HTMLButtonElement>) => void
  onClick: (event: MouseEvent<HTMLButtonElement>) => void
  onDoubleClick: (event: MouseEvent<HTMLButtonElement>) => void
  cancel: () => void
}

export function usePetGestures({ onOpenPanel, onSingleClick, onGuide, onFreeDrag }: UsePetGesturesOptions): PetGestures {
  const [reacting, setReacting] = useState(false)
  const [armed, setArmed] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [guiding, setGuiding] = useState(false)
  const mode = useRef<'idle' | 'pending' | 'guide' | 'free'>('idle')
  const movedRef = useRef(false)
  const pointerId = useRef<number | null>(null)
  const targetRef = useRef<HTMLButtonElement | null>(null)
  const start = useRef({ x: 0, y: 0 })
  const lastPoint = useRef({ x: 0, y: 0 })
  const clickTimer = useRef<number | null>(null)
  const reactTimer = useRef<number | null>(null)
  const guideRef = useRef(onGuide)
  const singleClickRef = useRef(onSingleClick)
  singleClickRef.current = onSingleClick
  const freeRef = useRef(onFreeDrag)
  const cancelRef = useRef<() => void>(() => undefined)
  guideRef.current = onGuide
  freeRef.current = onFreeDrag

  function releaseCapture(): void {
    const target = targetRef.current
    const id = pointerId.current
    if (target && id !== null && target.hasPointerCapture(id)) target.releasePointerCapture(id)
    pointerId.current = null
  }

  function clearClick(): void {
    if (clickTimer.current === null) return
    window.clearTimeout(clickTimer.current)
    clickTimer.current = null
  }

  function finish(kind: 'up' | 'cancel'): void {
    const current = mode.current
    mode.current = 'idle'
    setDragging(false)
    setGuiding(false)
    if (current === 'guide') {
      guideRef.current?.(kind === 'up' ? 'end' : 'cancel', lastPoint.current.x, lastPoint.current.y)
    } else if (current === 'free') {
      window.miko?.setDragActive(false)
      if (kind === 'cancel') freeRef.current?.('end')
    }
    window.miko?.setPointerHeld(false)
    releaseCapture()
  }

  cancelRef.current = () => finish('cancel')

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Alt') return
      setArmed(true)
      if (!(event.target instanceof HTMLTextAreaElement)) event.preventDefault()
    }
    const onKeyUp = (event: KeyboardEvent): void => {
      if (event.key === 'Alt') setArmed(false)
    }
    const stop = (): void => {
      setArmed(false)
      cancelRef.current()
    }
    const onVisibility = (): void => {
      if (!document.hidden) return
      clearClick()
      if (reactTimer.current !== null) {
        window.clearTimeout(reactTimer.current)
        reactTimer.current = null
      }
      setReacting(false)
      // Tab/window hidden mid-gesture: release pointer locks so click-through recovers.
      window.miko?.setDragActive(false)
      window.miko?.setPointerHeld(false)
    }
    const onPointerCancelGlobal = (): void => {
      cancelRef.current()
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', stop)
    window.addEventListener('pointercancel', onPointerCancelGlobal)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', stop)
      window.removeEventListener('pointercancel', onPointerCancelGlobal)
      document.removeEventListener('visibilitychange', onVisibility)
      clearClick()
      if (reactTimer.current !== null) window.clearTimeout(reactTimer.current)
      window.miko?.setDragActive(false)
      window.miko?.setPointerHeld(false)
    }
  }, [])

  function pet(): void {
    setReacting(true)
    if (reactTimer.current !== null) window.clearTimeout(reactTimer.current)
    reactTimer.current = window.setTimeout(() => {
      reactTimer.current = null
      setReacting(false)
    }, REACT_MS)
  }

  return {
    reacting,
    armed,
    dragging,
    guiding,
    cancel: () => cancelRef.current(),
    onPointerDown: (event) => {
      if (event.button !== 0) return
      lastPoint.current = { x: event.screenX, y: event.screenY }
      start.current = lastPoint.current
      if (!event.altKey && !guideRef.current) return
      targetRef.current = event.currentTarget
      pointerId.current = event.pointerId
      event.currentTarget.setPointerCapture(event.pointerId)
      window.miko?.setPointerHeld(true)
      if (event.altKey) {
        mode.current = 'free'
        movedRef.current = false
        setDragging(true)
        window.miko?.setDragActive(true)
        freeRef.current?.('start')
        event.preventDefault()
        return
      }
      mode.current = 'pending'
    },
    onPointerMove: (event) => {
      lastPoint.current = { x: event.screenX, y: event.screenY }
      if (mode.current === 'free') {
        const dx = event.screenX - start.current.x
        const dy = event.screenY - start.current.y
        start.current = lastPoint.current
        if (dx === 0 && dy === 0) return
        movedRef.current = true
        window.miko?.moveBy({ dx, dy })
        return
      }
      if (mode.current === 'pending') {
        const distance = Math.hypot(event.screenX - start.current.x, event.screenY - start.current.y)
        if (distance < DRAG_THRESHOLD_PX) return
        mode.current = 'guide'
        movedRef.current = true
        setGuiding(true)
        clearClick()
        guideRef.current?.('start', event.screenX, event.screenY)
        return
      }
      if (mode.current === 'guide') guideRef.current?.('move', event.screenX, event.screenY)
    },
    onPointerUp: () => finish('up'),
    onPointerCancel: () => finish('cancel'),
    onClick: (event) => {
      if (event.altKey || movedRef.current) {
        movedRef.current = false
        return
      }
      clearClick()
      clickTimer.current = window.setTimeout(() => {
        clickTimer.current = null
        pet()
        singleClickRef.current?.()
      }, CLICK_DELAY_MS)
    },
    onDoubleClick: (event) => {
      if (event.altKey || movedRef.current) return
      clearClick()
      onOpenPanel()
    }
  }
}
