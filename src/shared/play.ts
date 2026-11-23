/**
 * Casual-mode play: one small state machine shared by the renderer (pet controller) and tests.
 *
 *   idle → ready → activity → reaction → idle   (fetch returns to ready: the toy is back for another throw)
 *
 * Every transition bumps `token`, so a timer or callback from an earlier step can
 * check it and do nothing. Only one activity runs at a time; choosing another while
 * one is running is ignored. Cancel / pause (an assistant task, Escape, Dismiss) always
 * goes straight to idle. Nothing here is persisted: unfinished games never survive a restart.
 */

import { clamp, type Rect } from './layout.ts'

export type PlayMode = 'work' | 'casual'
export type PlayActivity = 'fetch' | 'feed' | 'pet'
export type Toy = 'ball' | 'stick'
export type Treat = 'bone' | 'biscuit'

export const TOYS: { id: Toy; label: string }[] = [
  { id: 'ball', label: 'Ball' },
  { id: 'stick', label: 'Stick' }
]
export const TREATS: { id: Treat; label: string }[] = [
  { id: 'bone', label: 'Bone' },
  { id: 'biscuit', label: 'Biscuit' }
]

/** Fetch steps inside `activity`. */
export type FetchStep = 'flying' | 'chasing' | 'carrying'

export type PlayState =
  | { phase: 'idle'; token: number }
  | { phase: 'ready'; token: number; activity: PlayActivity; toy: Toy | null; treat: Treat | null }
  | {
      phase: 'activity'
      token: number
      activity: 'fetch'
      toy: Toy
      step: FetchStep
      /** Where the pet started (placement DIP), so it brings the toy back there. */
      homeX: number
      /** Where the toy landed (placement DIP for the pet's left edge to reach it). */
      targetX: number
    }
  | { phase: 'reaction'; token: number; activity: PlayActivity; toy: Toy | null; reaction: PlayReaction }

/** What the pet does at the end: a supported clip if this pet has one, else a short hop + effect. */
export type PlayReaction = 'happy' | 'eat' | 'drop'

export type PlayEvent =
  | { type: 'choose'; activity: PlayActivity; toy?: Toy; treat?: Treat }
  | { type: 'throw'; homeX: number; targetX: number }
  | { type: 'landed' }
  | { type: 'arrived' }
  | { type: 'fed' }
  | { type: 'petted' }
  | { type: 'reaction-done' }
  | { type: 'cancel' }

export const PLAY_IDLE: PlayState = { phase: 'idle', token: 0 }

export function playReduce(state: PlayState, event: PlayEvent): PlayState {
  const token = state.token + 1
  switch (event.type) {
    case 'cancel':
      return state.phase === 'idle' ? state : { phase: 'idle', token }
    case 'choose': {
      // Never overlap: a running fetch or reaction keeps going until it ends or is cancelled.
      if (state.phase === 'activity' || state.phase === 'reaction') return state
      if (event.activity === 'fetch') return { phase: 'ready', token, activity: 'fetch', toy: event.toy ?? 'ball', treat: null }
      if (event.activity === 'feed') return { phase: 'ready', token, activity: 'feed', toy: null, treat: event.treat ?? 'bone' }
      return { phase: 'ready', token, activity: 'pet', toy: null, treat: null }
    }
    case 'throw':
      if (state.phase !== 'ready' || state.activity !== 'fetch' || !state.toy) return state
      return {
        phase: 'activity',
        token,
        activity: 'fetch',
        toy: state.toy,
        step: 'flying',
        homeX: event.homeX,
        targetX: event.targetX
      }
    case 'landed':
      if (state.phase !== 'activity' || state.step !== 'flying') return state
      return { ...state, token, step: 'chasing' }
    case 'arrived':
      if (state.phase !== 'activity') return state
      if (state.step === 'chasing') return { ...state, token, step: 'carrying' }
      if (state.step === 'carrying') return { phase: 'reaction', token, activity: 'fetch', toy: state.toy, reaction: 'drop' }
      return state
    case 'fed':
      if (state.phase !== 'ready' || state.activity !== 'feed') return state
      return { phase: 'reaction', token, activity: 'feed', toy: null, reaction: 'eat' }
    case 'petted':
      // Stroking works from the Pet button or any time in Casual mode, but never interrupts a game.
      if (state.phase === 'activity' || state.phase === 'reaction') return state
      return { phase: 'reaction', token, activity: 'pet', toy: null, reaction: 'happy' }
    case 'reaction-done':
      if (state.phase !== 'reaction') return state
      if (state.activity === 'fetch' && state.toy) return { phase: 'ready', token, activity: 'fetch', toy: state.toy, treat: null }
      return { phase: 'idle', token }
    default:
      return state
  }
}

/** The pet is busy with play (its own walking orders come from play). */
export function playControlsPet(state: PlayState): boolean {
  return state.phase === 'activity'
}

// ---------------------------------------------------------------- throw

export interface ThrowInput {
  /** Toy centre at release, screen DIP. */
  x: number
  y: number
  /** Release velocity, DIP per second (screen axes: +y is down). */
  vx: number
  vy: number
  /** Work area of the pet's display (excludes the taskbar / Dock). */
  work: Rect
  /** Screen y the toy lands on (the pet's ground line). */
  groundY: number
  /** Pet centre, screen DIP: a soft throw goes toward the side with more room. */
  petCenterX: number
  /** Longest throw for this pet (a slow walker gets shorter throws). */
  maxDistance?: number
}

export interface ThrowPlan {
  from: { x: number; y: number }
  to: { x: number; y: number }
  /** Highest point (smallest y) of the arc. */
  apexY: number
  seconds: number
  /** Bounce after landing (DIP). */
  bounce: number
}

export const TOY_SIZE = 34
const EDGE = 24
const MIN_THROW = 140
const MAX_THROW = 560

export function planThrow(input: ThrowInput, toy: Toy): ThrowPlan {
  const { work } = input
  const minX = work.x + EDGE + TOY_SIZE / 2
  const maxX = work.x + work.width - EDGE - TOY_SIZE / 2
  const roomLeft = input.petCenterX - minX
  const roomRight = maxX - input.petCenterX
  const soft = Math.abs(input.vx) < 120
  const dir = soft ? (roomRight >= roomLeft ? 1 : -1) : Math.sign(input.vx) || 1
  const longest = clamp(input.maxDistance ?? MAX_THROW, MIN_THROW, MAX_THROW)
  const distance = clamp(Math.abs(input.vx) * 0.55, MIN_THROW, longest)
  const toX = clamp(input.x + dir * distance, minX, maxX)
  const groundY = clamp(input.groundY, work.y + TOY_SIZE, work.y + work.height - TOY_SIZE / 2)
  const fromY = clamp(input.y, work.y + TOY_SIZE / 2, work.y + work.height - TOY_SIZE / 2)
  const lift = clamp(110 + Math.max(0, -input.vy) * 0.18, 80, 260)
  const apexY = Math.max(work.y + TOY_SIZE / 2, Math.min(fromY, groundY) - lift)
  const travelled = Math.abs(toX - input.x)
  return {
    from: { x: input.x, y: fromY },
    to: { x: toX, y: groundY },
    apexY,
    seconds: clamp(0.4 + travelled / 900, 0.5, 1.1),
    bounce: toy === 'ball' ? 22 : 6
  }
}

/** Point on the arc, t in [0, 1]: x moves steadily, y is a quadratic through the apex. */
export function throwPoint(plan: ThrowPlan, t: number): { x: number; y: number } {
  const u = clamp(t, 0, 1)
  // Constant horizontal speed, like a real throw.
  const x = plan.from.x + (plan.to.x - plan.from.x) * u
  // Control point chosen so the curve's highest point is the apex.
  const cy = 2 * plan.apexY - (plan.from.y + plan.to.y) / 2
  const y = (1 - u) * (1 - u) * plan.from.y + 2 * (1 - u) * u * cy + u * u * plan.to.y
  return { x, y }
}

/**
 * Placement DIP the pet walks to so it ends up beside the toy: the pet window's
 * left edge, with the toy under the pet's mouth side.
 */
export function petTargetFor(toyScreenX: number, work: Rect, petWidth: number, edgeMargin: number, span: number): number {
  const local = toyScreenX - (work.x + edgeMargin)
  return clamp(local - petWidth / 2, 0, span)
}

// ---------------------------------------------------------------- petting

/**
 * Petting is a stroke: move the pointer back and forth over the pet a few times
 * with no button pressed. It never conflicts with click, double-click or drag,
 * which all need a press, and passing over the pet once doesn't count.
 */
export class StrokeDetector {
  private lastX: number | null = null
  private dir = 0
  private travel = 0
  private turns: number[] = []
  private cooldownUntil = 0

  static readonly TURNS = 4
  static readonly MIN_TRAVEL = 14
  static readonly WINDOW_MS = 1800
  static readonly COOLDOWN_MS = 3500

  reset(): void {
    this.lastX = null
    this.dir = 0
    this.travel = 0
    this.turns = []
  }

  /** Feed one pointer sample. `over` = the pointer is over the pet; returns true once per stroke. */
  sample(x: number, over: boolean, now: number): boolean {
    if (!over || now < this.cooldownUntil) {
      this.reset()
      return false
    }
    if (this.lastX === null) {
      this.lastX = x
      return false
    }
    const dx = x - this.lastX
    this.lastX = x
    if (Math.abs(dx) < 0.5) return false
    const dir = Math.sign(dx)
    if (dir === this.dir || this.dir === 0) {
      this.dir = dir
      this.travel += Math.abs(dx)
      return false
    }
    // Direction changed: it counts only after a real stroke, not a jitter.
    if (this.travel >= StrokeDetector.MIN_TRAVEL) this.turns.push(now)
    this.dir = dir
    this.travel = Math.abs(dx)
    this.turns = this.turns.filter((at) => now - at <= StrokeDetector.WINDOW_MS)
    if (this.turns.length >= StrokeDetector.TURNS) {
      this.reset()
      this.cooldownUntil = now + StrokeDetector.COOLDOWN_MS
      return true
    }
    return false
  }
}

// ---------------------------------------------------------------- treats / drop target

export function insideRect(x: number, y: number, rect: { x: number; y: number; width: number; height: number }, slop = 0): boolean {
  return x >= rect.x - slop && y >= rect.y - slop && x <= rect.x + rect.width + slop && y <= rect.y + rect.height + slop
}

export function parsePlayMode(value: unknown): PlayMode {
  return value === 'casual' ? 'casual' : 'work'
}
