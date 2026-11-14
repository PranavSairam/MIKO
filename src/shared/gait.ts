/** Stride length in metres. One walk cycle moves the body exactly this far. */
export const STRIDE = 0.28

/** Seconds for one relaxed four-beat cycle. */
export const CYCLE = 1

/** Fraction of the cycle a paw stays down. One paw is in the air at a time. */
export const DUTY = 0.75

export const WALK_SPEED = STRIDE / CYCLE

/** Hip to knee, and knee to paw, in metres. */
export const LEG_UPPER = 0.19
export const LEG_LOWER = 0.17
export const HIP_Y = 0.28

export interface Hip {
  x: number
  z: number
  /** Phase offset. Plant order is back-left, front-left, back-right, front-right. */
  beat: number
  front: boolean
  bow: number
}

export const HIPS: readonly Hip[] = [
  { x: 0.16, z: 0.09, beat: 0.5, front: true, bow: 1 },
  { x: 0.16, z: -0.09, beat: 0, front: true, bow: -1 },
  { x: -0.18, z: 0.1, beat: 0.75, front: false, bow: 1 },
  { x: -0.18, z: -0.1, beat: 0.25, front: false, bow: -1 }
]

export interface FootStep {
  /** Metres ahead of the hip, along the dog's forward axis. */
  x: number
  y: number
  planted: boolean
}

export interface ScenePose {
  x: number
  z: number
  yaw: number
}

export interface FootLock {
  step: number
  x: number
  z: number
}

export interface ResolvedFoot {
  x: number
  y: number
  z: number
  planted: boolean
}

/**
 * Foot position relative to the hip. During stance the paw travels backward
 * at the same speed the body advances, so a planted paw does not skate.
 */
export function footStep(distance: number, offset: number): FootStep {
  const span = distance / STRIDE + offset
  const cycle = span - Math.floor(span)
  const reach = (STRIDE * DUTY) / 2
  if (cycle < DUTY) {
    const along = cycle / DUTY
    return {
      x: reach - along * STRIDE * DUTY,
      y: 0,
      planted: true
    }
  }
  const along = (cycle - DUTY) / (1 - DUTY)
  return {
    x: -reach + along * STRIDE * DUTY,
    y: Math.sin(along * Math.PI) * 0.05,
    planted: false
  }
}

/** World position along a straight walk. `hipX` is the hip's offset from the root. */
export function plantedWorldX(distance: number, offset: number, hipX: number): number {
  return distance + hipX + footStep(distance, offset).x
}

export function toWorld(localX: number, localZ: number, pose: ScenePose): { x: number; z: number } {
  const c = Math.cos(pose.yaw)
  const s = Math.sin(pose.yaw)
  return {
    x: pose.x + c * localX + s * localZ,
    z: pose.z - s * localX + c * localZ
  }
}

export function toActor(worldX: number, worldZ: number, pose: ScenePose): { x: number; z: number } {
  const dx = worldX - pose.x
  const dz = worldZ - pose.z
  const c = Math.cos(pose.yaw)
  const s = Math.sin(pose.yaw)
  return { x: c * dx - s * dz, z: s * dx + c * dz }
}

export function createFootLocks(count: number): Array<FootLock | null> {
  return Array.from({ length: count }, () => null)
}

/**
 * Holds a stance paw at the world point where it touched down, including
 * while the root yaws. Swing paws follow the body.
 */
export function resolveFoot(
  locks: Array<FootLock | null>,
  index: number,
  distance: number,
  offset: number,
  hipX: number,
  hipZ: number,
  pose: ScenePose,
  active: boolean
): ResolvedFoot {
  const step = footStep(distance, offset)
  const kinematic = toWorld(hipX + step.x, hipZ, pose)
  if (!active || !step.planted) {
    locks[index] = null
    return { x: kinematic.x, y: step.y, z: kinematic.z, planted: false }
  }
  const stepIndex = Math.floor(distance / STRIDE + offset)
  const held = locks[index]
  if (!held || held.step !== stepIndex) {
    locks[index] = { step: stepIndex, x: kinematic.x, z: kinematic.z }
  }
  const lock = locks[index]
  return { x: lock?.x ?? kinematic.x, y: 0, z: lock?.z ?? kinematic.z, planted: true }
}
