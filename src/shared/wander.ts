import { WALK_SPEED } from './gait.ts'
import { PIXELS_PER_METRE, SLIDE_BACK, smoothstep, TURN_SECONDS } from './motion.ts'
import type { MotionSample } from './sequence.ts'

export const PAUSE_SECONDS = [0.55, 1.4, 2.6, 0.9, 3.3] as const
export const WALK_SECONDS = [0.8, 1.5, 1.1, 2.2] as const

const ANTIC = ['scratch', 'rear', 'climb', 'slide', 'land', 'shake', 'settle'] as const

const ANTIC_SECONDS: Record<(typeof ANTIC)[number], number> = {
  scratch: 1.05,
  rear: 0.55,
  climb: 0.7,
  slide: 0.6,
  land: 0.3,
  shake: 0.75,
  settle: 0.45
}

export type WanderPhase =
  | 'peek'
  | 'step'
  | 'walk'
  | 'pause'
  | 'turn'
  | (typeof ANTIC)[number]

export interface WanderState {
  phase: WanderPhase
  age: number
  duration: number
  /** DIP from the left inset of the work area. */
  x: number
  yaw: number
  facing: 1 | -1
  gait: number
  pauses: number
  walks: number
  /** 1-based count of side arrivals. Every third one plays the antic. */
  edges: number
  /** After a pause, walk onward or turn away from a side. */
  then: 'walk' | 'turn'
  mark: number
  yaw0: number
}

/** True on every third arrival at a side. The others only turn around. */
export function edgeAntic(arrival: number): boolean {
  return arrival > 0 && arrival % 3 === 0
}

export function createWander(x: number): WanderState {
  return {
    phase: 'peek',
    age: 0,
    duration: 0.8,
    x,
    yaw: 0,
    facing: 1,
    gait: 0,
    pauses: 0,
    walks: 0,
    edges: 0,
    then: 'walk',
    mark: x,
    yaw0: 0
  }
}

/** Reduced motion: stay in the current spot and do not advance. */
export function holdInPlace(state: WanderState): WanderState {
  return { ...state, phase: 'pause', age: 0, duration: Number.POSITIVE_INFINITY, then: 'walk' }
}

export function stepWander(state: WanderState, dt: number, span: number): WanderState {
  if (state.duration === Number.POSITIVE_INFINITY) return state
  const step = Math.min(Math.max(dt, 0), 0.05)
  if (step === 0) return state
  const limit = Math.max(0, span)
  let next: WanderState = { ...state, age: state.age + step }

  if (next.phase === 'walk') {
    const metres = WALK_SPEED * step
    next.gait += metres
    next.x += next.facing * metres * PIXELS_PER_METRE
    if (next.facing > 0 && next.x >= limit) {
      next.x = limit
      return arrive(next, limit)
    }
    if (next.facing < 0 && next.x <= 0) {
      next.x = 0
      return arrive(next, limit)
    }
  } else if (next.phase === 'turn') {
    next.gait += WALK_SPEED * step
    const along = Math.min(1, next.age / next.duration)
    next.yaw = next.yaw0 + along * Math.PI
  } else if (next.phase === 'slide') {
    const along = smoothstep(Math.min(1, next.age / next.duration))
    const moved = next.facing * SLIDE_BACK * PIXELS_PER_METRE * along
    next.x = clamp(next.mark - moved, 0, limit)
  } else if (next.phase === 'step') {
    next.gait = smoothstep(Math.min(1, next.age / next.duration)) * 0.12
  }

  if (next.age < next.duration) return next
  return finish(next, limit)
}

export function wanderSample(state: WanderState): MotionSample {
  const along = state.duration === 0 || !Number.isFinite(state.duration) ? 0 : Math.min(1, state.age / state.duration)
  const eased = smoothstep(along)
  const base: MotionSample = {
    phase: state.phase === 'pause' ? 'settle' : state.phase,
    along,
    x: state.x / PIXELS_PER_METRE,
    y: 0,
    yaw: normalizeYaw(state.yaw),
    pitch: 0,
    headYaw: 0,
    headPitch: 0,
    gaitDistance: state.gait,
    gait: false,
    scratch: 0,
    climb: 0,
    shake: 0,
    duck: 0
  }

  if (state.phase === 'peek') {
    return { ...base, y: -0.34 + 0.12 * eased, headPitch: -0.45 * (1 - along), phase: 'peek' }
  }
  if (state.phase === 'step') {
    return { ...base, y: -0.22 * (1 - eased), gait: true, phase: 'step' }
  }
  if (state.phase === 'walk' || state.phase === 'turn') {
    return { ...base, gait: true, phase: state.phase === 'turn' ? 'turn' : 'walk' }
  }
  if (state.phase === 'scratch') {
    return { ...base, scratch: Math.max(0, Math.sin(along * Math.PI * 4)), phase: 'scratch' }
  }
  if (state.phase === 'rear') {
    return { ...base, pitch: -0.7 * eased, climb: eased, phase: 'rear' }
  }
  if (state.phase === 'climb') {
    return { ...base, pitch: -0.7 - 0.35 * eased, climb: 1, phase: 'climb' }
  }
  if (state.phase === 'slide') {
    const slip = eased
    return { ...base, pitch: -1.05 * (1 - slip), climb: 1 - slip, phase: 'slide' }
  }
  if (state.phase === 'shake') {
    const decay = 1 - along
    return { ...base, shake: Math.sin(along * Math.PI * 8) * 0.35 * decay, phase: 'shake' }
  }
  return base
}

function arrive(state: WanderState, span: number): WanderState {
  const edges = state.edges + 1
  const atSide: WanderState = { ...state, edges, age: 0 }
  if (edgeAntic(edges)) return enter(atSide, 'scratch', span)
  return enter({ ...atSide, then: 'turn' }, 'pause', span)
}

function finish(state: WanderState, span: number): WanderState {
  if (state.phase === 'peek') return enter(state, 'step', span)
  if (state.phase === 'step') return enter(state, 'walk', span)
  if (state.phase === 'walk') return enter({ ...state, then: 'walk' }, 'pause', span)
  if (state.phase === 'pause') return enter(state, state.then, span)
  if (state.phase === 'scratch') return enter(state, 'rear', span)
  if (state.phase === 'rear') return enter(state, 'climb', span)
  if (state.phase === 'climb') return enter(state, 'slide', span)
  if (state.phase === 'slide') return enter(state, 'land', span)
  if (state.phase === 'land') return enter(state, 'shake', span)
  if (state.phase === 'shake') return enter(state, 'settle', span)
  if (state.phase === 'settle') return enter(state, 'turn', span)
  if (state.phase === 'turn') {
    const facing: 1 | -1 = state.yaw0 < Math.PI / 2 ? -1 : 1
    return enter({ ...state, facing, yaw: facing === 1 ? 0 : Math.PI }, 'walk', span)
  }
  return enter(state, 'pause', span)
}

function enter(state: WanderState, phase: WanderPhase, span: number): WanderState {
  const next: WanderState = {
    ...state,
    phase,
    age: 0,
    duration: durationFor(phase, state),
    x: clamp(state.x, 0, Math.max(0, span)),
    mark: state.x,
    yaw0: state.yaw
  }
  if (phase === 'pause') next.pauses = state.pauses + 1
  if (phase === 'walk') next.walks = state.walks + 1
  if (phase === 'turn') {
    next.duration = TURN_SECONDS
    next.yaw0 = normalizeYaw(state.yaw)
    next.yaw = next.yaw0
  }
  return next
}

function durationFor(phase: WanderPhase, state: WanderState): number {
  if (phase === 'pause') return PAUSE_SECONDS[state.pauses % PAUSE_SECONDS.length] ?? 1
  if (phase === 'walk') return WALK_SECONDS[state.walks % WALK_SECONDS.length] ?? 1
  if (phase === 'peek') return 0.8
  if (phase === 'step') return 0.7
  if (phase === 'turn') return TURN_SECONDS
  if (phase in ANTIC_SECONDS) return ANTIC_SECONDS[phase as (typeof ANTIC)[number]]
  return 0.5
}

function normalizeYaw(yaw: number): number {
  const turns = yaw / (Math.PI * 2)
  const wrapped = (turns - Math.floor(turns)) * Math.PI * 2
  return wrapped > Math.PI ? wrapped - Math.PI * 2 : wrapped
}

function clamp(value: number, min: number, max: number): number {
  if (max < min) return min
  return Math.min(max, Math.max(min, value))
}
