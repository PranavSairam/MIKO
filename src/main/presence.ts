import {
  finishExit,
  initialSummon,
  requestHide,
  requestShow,
  toggleSummon,
  type SummonEffect,
  type SummonState
} from '../shared/summon'
import { watchPointer } from './pointer'
import { concealPet, revealWithoutMoving, sendPresence, summonAtPointer } from './pet-window'

const EXIT_FALLBACK_MS = 800

export function createPresence(onVisibility: () => void): {
  toggle: () => void
  show: () => void
  hide: () => void
  markReady: () => void
  setReducedMotion: (reduced: boolean) => void
  exitFinished: (generation: number) => void
} {
  let state: SummonState = initialSummon()
  let ready = false
  let showWhenReady = false
  let reducedMotion = false
  let exitTimer: NodeJS.Timeout | null = null

  function clearExit(): void {
    if (exitTimer) clearTimeout(exitTimer)
    exitTimer = null
  }

  function completeExit(generation: number): void {
    const step = finishExit(state, generation)
    if (step.effect === 'none') return
    clearExit()
    state = step.state
    concealPet()
    sendPresence({ phase: 'hidden', generation: state.generation })
    onVisibility()
  }

  function apply(effect: SummonEffect, generation: number): void {
    if (effect === 'show') {
      clearExit()
      if (!ready) {
        showWhenReady = true
        return
      }
      showWhenReady = false
      summonAtPointer()
      sendPresence({ phase: 'shown', generation })
      watchPointer(true)
      onVisibility()
      return
    }
    if (effect === 'cancel-exit') {
      clearExit()
      revealWithoutMoving()
      sendPresence({ phase: 'shown', generation })
      watchPointer(true)
      onVisibility()
      return
    }
    if (effect === 'play-exit') {
      watchPointer(false)
      sendPresence({ phase: 'exit', generation })
      clearExit()
      exitTimer = setTimeout(() => completeExit(generation), EXIT_FALLBACK_MS)
      return
    }
    if (effect === 'hide-now') {
      clearExit()
      watchPointer(false)
      concealPet()
      sendPresence({ phase: 'hidden', generation })
      onVisibility()
    }
  }

  function commit(step: { state: SummonState; effect: SummonEffect }): void {
    state = step.state
    apply(step.effect, state.generation)
  }

  return {
    toggle: () => {
      if (!ready) {
        showWhenReady = !showWhenReady
        return
      }
      commit(toggleSummon(state, reducedMotion))
    },
    show: () => {
      if (!ready) {
        showWhenReady = true
        return
      }
      commit(requestShow(state))
    },
    hide: () => {
      if (!ready) {
        showWhenReady = false
        return
      }
      commit(requestHide(state, reducedMotion))
    },
    markReady: () => {
      ready = true
      if (!showWhenReady) return
      showWhenReady = false
      commit(requestShow(state))
    },
    setReducedMotion: (reduced) => {
      reducedMotion = reduced
    },
    exitFinished: (generation) => {
      completeExit(generation)
    }
  }
}
