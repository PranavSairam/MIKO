export const EXIT_MS = 420

export type Presence = 'hidden' | 'visible' | 'exiting'

export interface SummonState {
  presence: Presence
  generation: number
}

export type SummonEffect = 'show' | 'hide-now' | 'play-exit' | 'cancel-exit' | 'none'

export interface SummonStep {
  state: SummonState
  effect: SummonEffect
}

export function initialSummon(): SummonState {
  return { presence: 'hidden', generation: 0 }
}

export function toggleSummon(state: SummonState, reducedMotion: boolean): SummonStep {
  if (state.presence === 'hidden') {
    return { state: { presence: 'visible', generation: state.generation + 1 }, effect: 'show' }
  }
  if (state.presence === 'exiting') {
    return { state: { presence: 'visible', generation: state.generation + 1 }, effect: 'cancel-exit' }
  }
  if (reducedMotion) {
    return { state: { presence: 'hidden', generation: state.generation + 1 }, effect: 'hide-now' }
  }
  return { state: { presence: 'exiting', generation: state.generation + 1 }, effect: 'play-exit' }
}

export function requestShow(state: SummonState): SummonStep {
  if (state.presence === 'visible') return { state, effect: 'none' }
  if (state.presence === 'exiting') {
    return { state: { presence: 'visible', generation: state.generation + 1 }, effect: 'cancel-exit' }
  }
  return { state: { presence: 'visible', generation: state.generation + 1 }, effect: 'show' }
}

export function requestHide(state: SummonState, reducedMotion: boolean): SummonStep {
  if (state.presence !== 'visible') return { state, effect: 'none' }
  if (reducedMotion) {
    return { state: { presence: 'hidden', generation: state.generation + 1 }, effect: 'hide-now' }
  }
  return { state: { presence: 'exiting', generation: state.generation + 1 }, effect: 'play-exit' }
}

/** A late exit callback must not hide a newer summon. */
export function finishExit(state: SummonState, generation: number): SummonStep {
  if (state.presence !== 'exiting' || state.generation !== generation) {
    return { state, effect: 'none' }
  }
  return { state: { presence: 'hidden', generation: state.generation }, effect: 'hide-now' }
}
