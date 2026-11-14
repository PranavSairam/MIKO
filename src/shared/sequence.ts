import { CYCLE, STRIDE, WALK_SPEED } from './gait.ts'
import { DUCK_Y, PEEK_Y, SLIDE_BACK, smoothstep, STEP_Y, TURN_CYCLES, TURN_SECONDS } from './motion.ts'

export const WALK_CYCLES = 3

export const SEGMENT = {
  peek: 0.8,
  step: 0.7,
  walk: WALK_CYCLES * CYCLE,
  look: 0.55,
  turn: TURN_SECONDS,
  walkBack: WALK_CYCLES * CYCLE,
  scratch: 1.05,
  rear: 0.55,
  climb: 0.7,
  slide: 0.6,
  land: 0.35,
  shake: 0.75,
  settle: 0.55,
  duck: 0.6
} as const

const ORDER = [
  'peek',
  'step',
  'walk',
  'look',
  'turn',
  'walkBack',
  'scratch',
  'rear',
  'climb',
  'slide',
  'land',
  'shake',
  'settle',
  'duck'
] as const

export type SegmentName = (typeof ORDER)[number]

export const SEQUENCE_SECONDS = ORDER.reduce((total, name) => total + SEGMENT[name], 0)

export interface MotionSample {
  phase: SegmentName
  /** Seconds into the current segment, 0 to 1. */
  along: number
  x: number
  y: number
  yaw: number
  pitch: number
  headYaw: number
  headPitch: number
  /** Distance walked in the current facing, used to drive the gait. */
  gaitDistance: number
  gait: boolean
  scratch: number
  climb: number
  shake: number
  duck: number
}

function at(time: number): { name: SegmentName; along: number } {
  let cursor = 0
  const last = ORDER[ORDER.length - 1] ?? 'duck'
  for (const name of ORDER) {
    const duration = SEGMENT[name]
    if (time < cursor + duration || name === last) {
      const local = Math.min(Math.max(time - cursor, 0), duration)
      return { name, along: duration === 0 ? 1 : local / duration }
    }
    cursor += duration
  }
  return { name: last, along: 1 }
}

/**
 * Preview timeline. x, y, and yaw are scene-root channels. The rig plays
 * the gait in place and does not add a second translation or yaw.
 */
export function sampleMotion(time: number): MotionSample {
  const t = Math.max(0, time)
  const { name, along } = at(t)
  const walkDistance = WALK_SPEED * SEGMENT.walk
  const base: MotionSample = {
    phase: name,
    along,
    x: 0,
    y: 0,
    yaw: 0,
    pitch: 0,
    headYaw: 0,
    headPitch: 0,
    gaitDistance: 0,
    gait: false,
    scratch: 0,
    climb: 0,
    shake: 0,
    duck: 0
  }

  if (name === 'peek') {
    const rise = smoothstep(along)
    return { ...base, y: PEEK_Y + (STEP_Y - PEEK_Y) * rise, headPitch: -0.45 * (1 - along) }
  }
  if (name === 'step') {
    return { ...base, y: STEP_Y * (1 - smoothstep(along)), gait: true, gaitDistance: along * STRIDE * 0.35 }
  }
  if (name === 'walk') {
    const distance = along * walkDistance
    return { ...base, x: distance, gait: true, gaitDistance: distance }
  }
  if (name === 'look') {
    return { ...base, x: walkDistance, headYaw: -1.05 * Math.sin(along * Math.PI) }
  }
  if (name === 'turn') {
    return {
      ...base,
      x: walkDistance,
      yaw: along * Math.PI,
      gait: true,
      gaitDistance: along * STRIDE * TURN_CYCLES
    }
  }
  if (name === 'walkBack') {
    const distance = along * walkDistance
    return { ...base, x: walkDistance - distance, yaw: Math.PI, gait: true, gaitDistance: distance }
  }
  if (name === 'scratch') {
    const swipes = Math.sin(along * Math.PI * 4)
    return { ...base, yaw: Math.PI, scratch: Math.max(0, swipes) }
  }
  if (name === 'rear') {
    const lift = smoothstep(along)
    return { ...base, yaw: Math.PI, pitch: -0.7 * lift, climb: lift }
  }
  if (name === 'climb') {
    const lift = smoothstep(along)
    return { ...base, yaw: Math.PI, pitch: -0.7 - 0.35 * lift, climb: 1 }
  }
  if (name === 'slide') {
    const slip = smoothstep(along)
    return {
      ...base,
      x: SLIDE_BACK * slip,
      yaw: Math.PI,
      pitch: -1.05 * (1 - slip),
      climb: 1 - slip
    }
  }
  if (name === 'land') {
    return { ...base, x: SLIDE_BACK, yaw: Math.PI }
  }
  if (name === 'shake') {
    const decay = 1 - along
    return {
      ...base,
      x: SLIDE_BACK,
      yaw: Math.PI,
      shake: Math.sin(along * Math.PI * 8) * 0.35 * decay
    }
  }
  if (name === 'settle') {
    return { ...base, x: SLIDE_BACK, yaw: Math.PI, headPitch: 0.15 * Math.sin(along * Math.PI) }
  }
  return {
    ...base,
    x: SLIDE_BACK,
    yaw: Math.PI,
    y: DUCK_Y * smoothstep(along),
    duck: smoothstep(along),
    pitch: 0.4 * smoothstep(along)
  }
}
