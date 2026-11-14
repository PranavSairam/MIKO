import { ARRIVE_EPS, acceptDestination } from './guide.ts'
import { clamp } from './layout.ts'
import { PIXELS_PER_METRE, smoothstep } from './motion.ts'

/**
 * Clip timing read from doberman.glb. The source bakes these at 24 fps:
 * Idle 48, Walk 24, Sit 20, SitIdle 48, StandUp 20.
 * Sit and StandUp do not loop. The runtime still prefers the imported
 * clip duration when the GLB is loaded.
 */
export const DOBERMAN_FPS = 24

export const DOBERMAN_CLIPS = {
  Idle: { name: 'Idle', frames: 48, loop: true },
  Walk: { name: 'Walk', frames: 24, loop: true },
  Sit: { name: 'Sit', frames: 20, loop: false },
  SitIdle: { name: 'SitIdle', frames: 48, loop: true },
  StandUp: { name: 'StandUp', frames: 20, loop: false }
} as const

export type DobermanClipName = keyof typeof DOBERMAN_CLIPS

/** Standing height from the asset notes, used only when a measured box is empty. */
export const MODEL_HEIGHT = 1.45

/** Rest-pose length along Z, used only when a measured box is empty. */
export const MODEL_LENGTH = 1.27

/** In-place Walk travels about this many model units per 1-second cycle. */
export const WALK_UNITS_PER_SECOND = 0.9

/** Short stroll after the opening idle. */
export const WALK_CYCLES = 2

/** Fraction of the camera view the animated bounds may occupy. */
export const FIT_MARGIN = 0.9

/** DIP kept under the paws so the toes are not on the window edge. */
export const GROUND_PAD_PX = 10

/** Parent yaw eases across this long a turn. The short arc is used. */
export const TURN_SECONDS = 0.45

export const SEATED_HOLD = { min: 12, max: 20 }
export const STAND_HOLD = { min: 2, max: 4 }

export type Facing = 1 | -1
export type Arrival = 'sit' | 'stand'
export type RestChoice = 'sit' | 'stand' | 'stroll'
export type TurnInto = 'sit' | 'idle' | 'walk'
export type DobermanPhase = 'turn' | 'idle' | 'walk' | 'sit' | 'sitIdle' | 'standUp'
export type BehaviorMode = 'live' | 'panel' | 'drag' | 'reduced'

export interface Actor {
  phase: DobermanPhase
  age: number
  yaw: number
  yawFrom: number
  yawTarget: number
  facing: Facing
  /** DIP left in the current walk. */
  remaining: number
  hold: number
  /** Bumped when a one-shot starts or is cancelled, so a late finish is ignored. */
  token: number
  paused: boolean
  turnInto: TurnInto
  arrival: Arrival
  lastArrival: Arrival | null
  /** After StandUp: a short stand, or a stroll that returns home. */
  nextRest: RestChoice
  /** The walk in progress is heading back to home. */
  returning: boolean
  /** `auto` follows the rest schedule. Anything else is a manual command. */
  errand: Errand
  /** Roam DIP the current manual walk is aiming at. */
  destination: number
  commitHome: boolean
  orderToken: number
  settledToken: number
}

export type Errand = 'auto' | 'walk' | 'sit' | 'stand' | 'stay'

export interface BehaviorOrder {
  token: number
  kind: 'auto' | 'walk' | 'sit' | 'stand' | 'stay' | 'wander'
  destination: number
  commitHome: boolean
}

export const IDLE_ORDER: BehaviorOrder = { token: 0, kind: 'auto', destination: 0, commitHome: false }

export interface BehaviorContext {
  dt: number
  speedPx: number
  viewerYaw: number
  x: number
  span: number
  /** DIP of one in-place walk cycle at the fitted scale. */
  cyclePx: number
  mode: BehaviorMode
  rng: () => number
  /** Session home in the same DIP coordinates as `x`. */
  home: number
  roamMin: number
  roamMax: number
  /** Manual command. It wins over wandering and over the open panel. */
  order: BehaviorOrder
}

export function clipDuration(name: DobermanClipName): number {
  return DOBERMAN_CLIPS[name].frames / DOBERMAN_FPS
}

export function clipName(phase: DobermanPhase): DobermanClipName {
  if (phase === 'walk') return 'Walk'
  if (phase === 'sit') return 'Sit'
  if (phase === 'sitIdle') return 'SitIdle'
  if (phase === 'standUp') return 'StandUp'
  return 'Idle'
}

export function isOneShot(phase: DobermanPhase): boolean {
  return phase === 'sit' || phase === 'standUp'
}

export function fitModelScale(
  modelWidth: number,
  modelHeight: number,
  viewWidth: number,
  viewHeight: number
): number {
  if (modelWidth <= 0 || modelHeight <= 0 || viewWidth <= 0 || viewHeight <= 0) return 1
  return FIT_MARGIN * Math.min(viewWidth / modelWidth, viewHeight / modelHeight)
}

/** Desktop DIP per second for an in-place Walk at the fitted scene scale. */
export function walkDipPerSecond(modelScale: number): number {
  return WALK_UNITS_PER_SECOND * modelScale * PIXELS_PER_METRE
}

export function cycleDip(modelScale: number, cycleSeconds = clipDuration('Walk')): number {
  return walkDipPerSecond(modelScale) * cycleSeconds
}

export function walkDistancePx(modelScale: number, cycleSeconds = clipDuration('Walk')): number {
  return cycleDip(modelScale, cycleSeconds) * WALK_CYCLES
}

/**
 * The model faces +Z at yaw 0. Yaw rotates that forward to (sin yaw, cos yaw).
 * A camera on +X, looking toward the origin, is therefore yaw π/2.
 */
export function viewerYawFromCamera(cameraX: number, cameraZ: number, dogX = 0, dogZ = 0): number {
  return Math.atan2(cameraX - dogX, cameraZ - dogZ)
}

/** Screen-right travel faces world -Z. Screen-left travel faces world +Z. */
export function walkYaw(facing: Facing): number {
  return facing > 0 ? Math.PI : 0
}

export function angleDelta(from: number, to: number): number {
  let delta = (to - from) % (Math.PI * 2)
  if (delta > Math.PI) delta -= Math.PI * 2
  if (delta < -Math.PI) delta += Math.PI * 2
  return delta
}

export function lerpAngle(from: number, to: number, t: number): number {
  return from + angleDelta(from, to) * t
}

export function roomInDirection(x: number, span: number, facing: Facing): number {
  return facing > 0 ? Math.max(0, span - x) : Math.max(0, x)
}

/** Face the side with more room so the short walk is not jammed against the edge. */
export function chooseFacing(x: number, span: number): Facing {
  const right = Math.max(0, span - x)
  const left = Math.max(0, x)
  if (right === left) return 1
  return right > left ? 1 : -1
}

export function planWalk(
  x: number,
  span: number,
  distance: number
): { facing: Facing; distance: number } {
  const facing = chooseFacing(x, span)
  return { facing, distance: Math.max(0, Math.min(distance, roomInDirection(x, span, facing))) }
}

/**
 * Sitting is the usual rest. A short stand or a stroll happens less often,
 * and not on a fixed beat.
 */
export function chooseRest(rng: () => number): RestChoice {
  const roll = rng()
  if (roll < 0.62) return 'sit'
  if (roll < 0.82) return 'stand'
  return 'stroll'
}

/** A short walk that stays inside the roam range and can still turn around. */
export function planOuting(
  x: number,
  roamMin: number,
  roamMax: number,
  cyclePx: number,
  cycles: number
): { facing: Facing; distance: number } {
  const desired = Math.max(0, cyclePx) * Math.max(1, cycles)
  const left = Math.max(0, x - roamMin)
  const right = Math.max(0, roamMax - x)
  let facing: Facing = right > left ? 1 : -1
  let room = facing > 0 ? right : left
  const minimum = Math.min(desired, Math.max(8, cyclePx * 0.85))
  const otherRoom = facing > 0 ? left : right
  if (room < minimum && otherRoom > room) {
    facing = facing > 0 ? -1 : 1
    room = otherRoom
  }
  return { facing, distance: Math.max(0, Math.min(desired, room)) }
}

function holdFor(kind: 'seated' | 'stand', rng: () => number): number {
  const band = kind === 'seated' ? SEATED_HOLD : STAND_HOLD
  return band.min + rng() * (band.max - band.min)
}

function strollCycles(rng: () => number): number {
  return 1 + Math.floor(rng() * 3)
}

function blank(yaw: number, arrival: Arrival, last: Arrival | null): Actor {
  return {
    phase: 'idle',
    age: 0,
    yaw,
    yawFrom: yaw,
    yawTarget: yaw,
    facing: 1,
    remaining: 0,
    hold: 0,
    token: 1,
    paused: false,
    turnInto: 'idle',
    arrival,
    lastArrival: last,
    nextRest: 'sit',
    returning: false,
    errand: 'auto',
    destination: 0,
    commitHome: false,
    orderToken: 0,
    settledToken: 0
  }
}

function startTurn(actor: Actor, target: number, into: TurnInto): Actor {
  const leavingShot = actor.phase === 'sit' || actor.phase === 'standUp'
  return {
    ...actor,
    phase: 'turn',
    age: 0,
    yawFrom: actor.yaw,
    yawTarget: target,
    turnInto: into,
    paused: false,
    token: leavingShot ? actor.token + 1 : actor.token
  }
}

function enterIdle(actor: Actor, rng: () => number): Actor {
  return {
    ...actor,
    phase: 'idle',
    age: 0,
    hold: holdFor('stand', rng),
    paused: false,
    lastArrival: 'stand'
  }
}

function enterSit(actor: Actor): Actor {
  return {
    ...actor,
    phase: 'sit',
    age: 0,
    hold: 0,
    paused: false,
    token: actor.token + 1,
    lastArrival: 'sit',
    nextRest: 'sit',
    returning: false
  }
}

function enterWalk(actor: Actor): Actor {
  const yaw = walkYaw(actor.facing)
  return {
    ...actor,
    phase: 'walk',
    age: 0,
    yaw,
    yawFrom: yaw,
    yawTarget: yaw,
    paused: false
  }
}

function enterStandUp(actor: Actor): Actor {
  return { ...actor, phase: 'standUp', age: 0, token: actor.token + 1, paused: false }
}

export function summonActor(
  x: number,
  span: number,
  cyclePx: number,
  viewerYaw: number,
  rng: () => number
): Actor {
  void x
  void span
  void cyclePx
  const sitting = enterSit(blank(viewerYaw, 'sit', null))
  return { ...sitting, hold: holdFor('seated', rng) }
}

export function settleReduced(actor: Actor, viewerYaw: number): Actor {
  if (actor.paused && actor.phase === 'idle' && Math.abs(angleDelta(actor.yaw, viewerYaw)) < 0.01) return actor
  return {
    ...actor,
    phase: 'idle',
    age: 0,
    yaw: viewerYaw,
    yawFrom: viewerYaw,
    yawTarget: viewerYaw,
    remaining: 0,
    hold: (STAND_HOLD.min + STAND_HOLD.max) / 2,
    paused: true,
    token: actor.token + 1
  }
}

/** Opening the note keeps MIKO seated and turned toward the viewer. */
export function settleForPanel(actor: Actor, viewerYaw: number): Actor {
  if (actor.phase === 'sit' && Math.abs(angleDelta(actor.yaw, viewerYaw)) < 0.08) return actor
  if (actor.phase === 'sitIdle' && Math.abs(angleDelta(actor.yaw, viewerYaw)) < 0.08) {
    return actor.age === 0 ? actor : { ...actor, age: 0 }
  }
  if (actor.phase === 'turn' && actor.turnInto === 'sit' && Math.abs(angleDelta(actor.yawTarget, viewerYaw)) < 0.08) {
    return actor
  }
  return startTurn(actor, viewerYaw, 'sit')
}

/** A drag ends at a new home. An in-progress stroll starts again from there. */
export function replanAfterDrag(
  actor: Actor,
  x: number,
  span: number,
  cyclePx: number,
  viewerYaw: number,
  rng: () => number,
  roam: { min: number; max: number }
): Actor {
  const headingOut = actor.phase === 'walk' || (actor.phase === 'turn' && actor.turnInto === 'walk')
  if (!headingOut) return actor
  const min = clamp(roam.min, 0, span)
  const max = clamp(roam.max, min, span)
  const stroll = planOuting(x, min, max, cyclePx, strollCycles(rng))
  if (stroll.distance < 8) {
    return { ...startTurn(actor, viewerYaw, 'sit'), remaining: 0, returning: false, nextRest: 'sit' }
  }
  const target = walkYaw(stroll.facing)
  if (actor.phase === 'walk' && Math.abs(angleDelta(actor.yaw, target)) < 0.2) {
    return {
      ...actor,
      facing: stroll.facing,
      remaining: stroll.distance,
      returning: false,
      nextRest: 'stroll',
      yaw: target,
      yawTarget: target
    }
  }
  return {
    ...startTurn(actor, target, 'walk'),
    facing: stroll.facing,
    remaining: stroll.distance,
    returning: false,
    nextRest: 'stroll'
  }
}

export function stepBehavior(actor: Actor, ctx: BehaviorContext): { actor: Actor; dx: number } {
  if (ctx.mode === 'reduced') return { actor: settleReduced(actor, ctx.viewerYaw), dx: 0 }
  if (ctx.mode === 'drag') return { actor, dx: 0 }
  let next = actor.paused ? { ...actor, paused: false } : actor
  if (ctx.order.kind === 'wander' && next.errand !== 'auto') next = resumeSchedule(next, ctx)
  if (ctx.order.kind === 'walk') return stepErrandWalk(next, ctx)
  if (ctx.order.kind === 'sit' || ctx.order.kind === 'stand' || ctx.order.kind === 'stay') {
    return stepPose(next, ctx, ctx.order.kind)
  }
  if (next.errand === 'walk' && next.orderToken !== ctx.order.token) {
    next = { ...next, errand: 'auto', remaining: 0 }
  }
  if (ctx.mode === 'panel') next = settleForPanel(next, ctx.viewerYaw)
  if (ctx.dt <= 0) return { actor: next, dx: 0 }
  if (next.phase === 'turn') return stepTurn(next, ctx)
  if (next.phase === 'walk') return stepWalk(next, ctx)
  if (next.phase === 'idle') return stepIdle(next, ctx)
  if (next.phase === 'sitIdle') return stepSitIdle(next, ctx)
  if (next.phase === 'sit' || next.phase === 'standUp') {
    const limit = clipDuration(clipName(next.phase)) + 0.2
    const age = next.age + ctx.dt
    if (age < limit) return { actor: { ...next, age }, dx: 0 }
    return { actor: finishOneShot(next, next.token, ctx), dx: 0 }
  }
  return { actor: next, dx: 0 }
}

function stepTurn(actor: Actor, ctx: BehaviorContext): { actor: Actor; dx: number } {
  const age = actor.age + ctx.dt
  if (age < TURN_SECONDS) {
    return {
      actor: { ...actor, age, yaw: lerpAngle(actor.yawFrom, actor.yawTarget, smoothstep(age / TURN_SECONDS)) },
      dx: 0
    }
  }
  const arrived = { ...actor, age: 0, yaw: actor.yawTarget, yawFrom: actor.yawTarget }
  if (actor.turnInto === 'sit') return { actor: enterSit(arrived), dx: 0 }
  if (actor.turnInto === 'walk') return { actor: enterWalk(arrived), dx: 0 }
  return { actor: enterIdle(arrived, ctx.rng), dx: 0 }
}

function stepWalk(actor: Actor, ctx: BehaviorContext): { actor: Actor; dx: number } {
  const room = roomInDirection(ctx.x - ctx.roamMin, ctx.roamMax - ctx.roamMin, actor.facing)
  const budget = Math.min(actor.remaining, room)
  const step = Math.min(budget, Math.max(0, ctx.speedPx) * ctx.dt)
  const remaining = budget - step
  const dx = actor.facing * step
  if (remaining > 0.5) return { actor: { ...actor, age: actor.age + ctx.dt, remaining }, dx }
  const nextX = ctx.x + dx
  const away = Math.abs(ctx.home - nextX)
  if (!actor.returning && away > 8) {
    const facing: Facing = ctx.home >= nextX ? 1 : -1
    const back = Math.min(away, roomInDirection(nextX - ctx.roamMin, ctx.roamMax - ctx.roamMin, facing))
    if (back >= 8) {
      return {
        actor: {
          ...startTurn(
            { ...actor, remaining: back, facing, returning: true, nextRest: 'sit', arrival: 'sit' },
            walkYaw(facing),
            'walk'
          )
        },
        dx
      }
    }
  }
  return {
    actor: startTurn(
      { ...actor, remaining: 0, returning: false, yaw: walkYaw(actor.facing) },
      ctx.viewerYaw,
      'sit'
    ),
    dx
  }
}

function stepIdle(actor: Actor, ctx: BehaviorContext): { actor: Actor; dx: number } {
  if (actor.errand === 'stand' || actor.errand === 'stay') return { actor, dx: 0 }
  const age = actor.age + ctx.dt
  if (age < actor.hold) return { actor: { ...actor, age }, dx: 0 }
  if (Math.abs(angleDelta(actor.yaw, ctx.viewerYaw)) < 0.08) return { actor: enterSit(actor), dx: 0 }
  return { actor: startTurn(actor, ctx.viewerYaw, 'sit'), dx: 0 }
}

function stepSitIdle(actor: Actor, ctx: BehaviorContext): { actor: Actor; dx: number } {
  if (ctx.mode === 'panel') return { actor, dx: 0 }
  if (actor.errand === 'sit' || actor.errand === 'stay') return { actor, dx: 0 }
  const age = actor.age + ctx.dt
  if (age < actor.hold) return { actor: { ...actor, age }, dx: 0 }
  const choice = chooseRest(ctx.rng)
  if (choice === 'sit') {
    return { actor: { ...actor, age: 0, hold: holdFor('seated', ctx.rng), nextRest: 'sit' }, dx: 0 }
  }
  return { actor: enterStandUp({ ...actor, nextRest: choice }), dx: 0 }
}

function depart(actor: Actor, ctx: BehaviorContext): Actor {
  const stroll = planOuting(ctx.x, ctx.roamMin, ctx.roamMax, ctx.cyclePx, strollCycles(ctx.rng))
  if (stroll.distance < 8) {
    const leaving = actor.phase === 'standUp' || actor.phase === 'sit'
    return enterIdle(
      {
        ...actor,
        yaw: ctx.viewerYaw,
        yawFrom: ctx.viewerYaw,
        yawTarget: ctx.viewerYaw,
        returning: false,
        nextRest: 'stand',
        token: leaving ? actor.token + 1 : actor.token
      },
      ctx.rng
    )
  }
  return {
    ...startTurn(
      { ...actor, facing: stroll.facing, remaining: stroll.distance, returning: false, nextRest: 'stroll' },
      walkYaw(stroll.facing),
      'walk'
    )
  }
}

export function finishOneShot(actor: Actor, token: number, ctx: BehaviorContext): Actor {
  if (token !== actor.token) return actor
  if (actor.phase === 'sit') {
    return {
      ...actor,
      phase: 'sitIdle',
      age: 0,
      hold: actor.hold > 0 ? actor.hold : holdFor('seated', ctx.rng),
      token: actor.token + 1,
      returning: false
    }
  }
  if (actor.phase === 'standUp') {
    if (actor.errand === 'walk') return faceDestination(actor, ctx)
    if (actor.errand === 'stand') return enterIdle({ ...actor, returning: false }, ctx.rng)
    if (actor.nextRest === 'stroll') return depart(actor, ctx)
    return enterIdle({ ...actor, returning: false }, ctx.rng)
  }
  return actor
}

function resumeSchedule(actor: Actor, ctx: BehaviorContext): Actor {
  const next: Actor = { ...actor, errand: 'auto', orderToken: ctx.order.token, remaining: 0, returning: false }
  if (next.phase === 'sitIdle') return { ...next, age: 0, hold: holdFor('seated', ctx.rng) }
  return next
}

function stepErrandWalk(actor: Actor, ctx: BehaviorContext): { actor: Actor; dx: number } {
  const proposed = clamp(ctx.order.destination, 0, ctx.span)
  const arrived =
    actor.orderToken === ctx.order.token && actor.settledToken === ctx.order.token && actor.errand !== 'walk'
  if (arrived && Math.abs(proposed - ctx.x) <= ARRIVE_EPS) {
    if (actor.phase === 'turn') return stepTurn(actor, ctx)
    if (actor.phase === 'sit' || actor.phase === 'standUp') return ageOneShot(actor, ctx)
    return { actor, dx: 0 }
  }
  let next = actor
  if (arrived || actor.orderToken !== ctx.order.token) next = armWalk(actor, ctx)
  else next = retargetWalk(actor, ctx)
  if (next.settledToken === ctx.order.token && next.errand !== 'walk') return { actor: next, dx: 0 }
  if (next.phase === 'turn') return stepTurn(next, ctx)
  if (next.phase === 'walk') return stepDirected(next, ctx)
  if (next.phase === 'sit' || next.phase === 'standUp') return ageOneShot(next, ctx)
  return { actor: faceDestination(next, ctx), dx: 0 }
}

function armWalk(actor: Actor, ctx: BehaviorContext): Actor {
  const dest = clamp(ctx.order.destination, 0, ctx.span)
  const armed: Actor = {
    ...actor,
    errand: 'walk',
    destination: dest,
    commitHome: ctx.order.commitHome,
    orderToken: ctx.order.token,
    settledToken: -1,
    returning: false
  }
  if (Math.abs(dest - ctx.x) <= ARRIVE_EPS) return markArrived(armed, ctx)
  if (actor.phase === 'standUp') return armed
  if (
    actor.phase === 'sit' ||
    actor.phase === 'sitIdle' ||
    (actor.phase === 'turn' && actor.turnInto === 'sit')
  ) {
    return enterStandUp(armed)
  }
  return faceDestination(armed, ctx)
}

function retargetWalk(actor: Actor, ctx: BehaviorContext): Actor {
  const proposed = clamp(ctx.order.destination, 0, ctx.span)
  const moving = actor.phase === 'walk' || (actor.phase === 'turn' && actor.turnInto === 'walk')
  const dest = acceptDestination(actor.destination, proposed, ctx.x)
  const updated: Actor = { ...actor, destination: dest, commitHome: ctx.order.commitHome }
  if (Math.abs(dest - actor.destination) < 0.5) return updated
  if (!moving) return updated
  return faceDestination(updated, ctx)
}

function faceDestination(actor: Actor, ctx: BehaviorContext): Actor {
  const delta = actor.destination - ctx.x
  if (Math.abs(delta) <= ARRIVE_EPS) return markArrived({ ...actor, remaining: 0 }, ctx)
  const facing: Facing = delta > 0 ? 1 : -1
  const distance = Math.min(Math.abs(delta), roomInDirection(ctx.x, ctx.span, facing))
  if (distance <= ARRIVE_EPS) return markArrived({ ...actor, remaining: 0, facing }, ctx)
  const target = walkYaw(facing)
  if (actor.phase === 'walk' && actor.facing === facing) {
    return { ...actor, facing, remaining: distance, yaw: target, yawTarget: target }
  }
  return {
    ...startTurn({ ...actor, facing, remaining: distance, returning: false }, target, 'walk')
  }
}

function markArrived(actor: Actor, ctx: BehaviorContext): Actor {
  const settled: Actor = {
    ...actor,
    errand: 'auto',
    remaining: 0,
    settledToken: actor.orderToken,
    returning: false
  }
  if (
    (settled.phase === 'sit' || settled.phase === 'sitIdle') &&
    Math.abs(angleDelta(settled.yaw, ctx.viewerYaw)) < 0.08
  ) {
    return settled.phase === 'sitIdle' ? settled : { ...settled, phase: 'sitIdle', age: 0 }
  }
  if (settled.phase === 'turn' && settled.turnInto === 'sit' && Math.abs(angleDelta(settled.yawTarget, ctx.viewerYaw)) < 0.08) {
    return settled
  }
  return startTurn(settled, ctx.viewerYaw, 'sit')
}

function ageOneShot(actor: Actor, ctx: BehaviorContext): { actor: Actor; dx: number } {
  const limit = clipDuration(clipName(actor.phase)) + 0.2
  const age = actor.age + ctx.dt
  if (age < limit) return { actor: { ...actor, age }, dx: 0 }
  return { actor: finishOneShot(actor, actor.token, ctx), dx: 0 }
}

function stepDirected(actor: Actor, ctx: BehaviorContext): { actor: Actor; dx: number } {
  const room = roomInDirection(ctx.x, ctx.span, actor.facing)
  const step = Math.min(actor.remaining, room, Math.max(0, ctx.speedPx) * ctx.dt)
  const dx = actor.facing * step
  const remaining = actor.remaining - step
  if (remaining > 0.5 && room - step > 0.5) {
    return { actor: { ...actor, age: actor.age + ctx.dt, remaining }, dx }
  }
  return { actor: markArrived({ ...actor, remaining: 0, yaw: walkYaw(actor.facing) }, ctx), dx }
}

function stepPose(actor: Actor, ctx: BehaviorContext, pose: 'sit' | 'stand' | 'stay'): { actor: Actor; dx: number } {
  if (actor.orderToken === ctx.order.token && actor.errand === pose) return holdPose(actor, ctx)
  const armed: Actor = {
    ...actor,
    errand: pose,
    orderToken: ctx.order.token,
    settledToken: ctx.order.token,
    remaining: 0,
    returning: false
  }
  if (pose === 'stand') {
    if (actor.phase === 'standUp') return { actor: armed, dx: 0 }
    if (actor.phase === 'idle' && Math.abs(angleDelta(actor.yaw, ctx.viewerYaw)) < 0.08) {
      return { actor: { ...armed, age: 0 }, dx: 0 }
    }
    if (actor.phase === 'sit' || actor.phase === 'sitIdle' || (actor.phase === 'turn' && actor.turnInto === 'sit')) {
      return { actor: enterStandUp(armed), dx: 0 }
    }
    return { actor: startTurn(armed, ctx.viewerYaw, 'idle'), dx: 0 }
  }
  if (
    (actor.phase === 'sitIdle' || actor.phase === 'sit') &&
    Math.abs(angleDelta(actor.yaw, ctx.viewerYaw)) < 0.08
  ) {
    return { actor: { ...armed, phase: actor.phase === 'sit' ? 'sit' : 'sitIdle', age: 0 }, dx: 0 }
  }
  if (actor.phase === 'turn' && actor.turnInto === 'sit' && Math.abs(angleDelta(actor.yawTarget, ctx.viewerYaw)) < 0.08) {
    return { actor: armed, dx: 0 }
  }
  return { actor: startTurn(armed, ctx.viewerYaw, 'sit'), dx: 0 }
}

function holdPose(actor: Actor, ctx: BehaviorContext): { actor: Actor; dx: number } {
  if (actor.phase === 'turn') return stepTurn(actor, ctx)
  if (actor.phase === 'sit' || actor.phase === 'standUp') return ageOneShot(actor, ctx)
  return { actor, dx: 0 }
}

/** Invalidate an in-flight Sit or StandUp finish. */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

export function scriptedRng(values: number[]): () => number {
  let index = 0
  return () => {
    const value = values[Math.min(index, values.length - 1)] ?? 0
    index += 1
    return value
  }
}

export function silence(actor: Actor): Actor {
  return { ...actor, token: actor.token + 1, paused: true }
}
