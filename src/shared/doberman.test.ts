import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { PIXELS_PER_METRE } from './motion.ts'
import {
  DOBERMAN_CLIPS,
  GROUND_PAD_PX,
  MODEL_HEIGHT,
  SEATED_HOLD,
  STAND_HOLD,
  TURN_SECONDS,
  WALK_UNITS_PER_SECOND,
  angleDelta,
  chooseFacing,
  chooseRest,
  planOuting,
  clipDuration,
  finishOneShot,
  fitModelScale,
  planWalk,
  replanAfterDrag,
  scriptedRng,
  settleForPanel,
  settleReduced,
  silence,
  stepBehavior,
  summonActor,
  viewerYawFromCamera,
  walkDipPerSecond,
  walkDistancePx,
  walkYaw,
  type Actor,
  type BehaviorContext
} from './doberman.ts'
import {
  LOOK_DEAD_ZONE,
  LOOK_PITCH_LIMIT,
  LOOK_YAW_LIMIT,
  canvasOrigin,
  dampLook,
  lookTarget,
  pointerToViewport,
  pointerWatch
} from './look.ts'
import { PANEL } from './layout.ts'
import { placeAtWorkAreaRight, rightQuarterMin, roamFor } from './movement.ts'

function ctx(overrides: Partial<BehaviorContext> = {}): BehaviorContext {
  const span = overrides.span ?? 1600
  const home = overrides.home ?? span
  const roam = roamFor(home, span)
  return {
    dt: 0.1,
    speedPx: 100,
    viewerYaw: Math.PI / 2,
    x: home,
    cyclePx: 100,
    mode: 'live',
    rng: () => 0.5,
    ...overrides,
    span,
    home,
    roamMin: overrides.roamMin ?? roam.min,
    roamMax: overrides.roamMax ?? roam.max,
    order: overrides.order ?? { token: 0, kind: 'auto', destination: 0, commitHome: false }
  }
}

function run(actor: Actor, seconds: number, overrides: Partial<BehaviorContext> = {}): { actor: Actor; dx: number } {
  let current = actor
  let dx = 0
  let x = overrides.x ?? overrides.home ?? 1600
  let left = seconds
  while (left > 0) {
    const dt = Math.min(0.05, left)
    const stepped = stepBehavior(current, ctx({ ...overrides, dt, x }))
    current = stepped.actor
    dx += stepped.dx
    x += stepped.dx
    left -= dt
  }
  return { actor: current, dx }
}

describe('doberman clips', () => {
  it('uses the imported names and frame timings', () => {
    assert.equal(DOBERMAN_CLIPS.Idle.name, 'Idle')
    assert.equal(DOBERMAN_CLIPS.Walk.name, 'Walk')
    assert.equal(DOBERMAN_CLIPS.Sit.name, 'Sit')
    assert.equal(DOBERMAN_CLIPS.SitIdle.name, 'SitIdle')
    assert.equal(DOBERMAN_CLIPS.StandUp.name, 'StandUp')
    assert.equal(clipDuration('Idle'), 2)
    assert.equal(clipDuration('Walk'), 1)
    assert.equal(clipDuration('Sit'), 20 / 24)
    assert.equal(clipDuration('SitIdle'), 2)
    assert.equal(clipDuration('StandUp'), 20 / 24)
    assert.equal(DOBERMAN_CLIPS.Sit.loop, false)
    assert.equal(DOBERMAN_CLIPS.StandUp.loop, false)
    assert.equal(DOBERMAN_CLIPS.Walk.loop, true)
  })
})

describe('doberman scale', () => {
  it('converts the 0.9 unit cycle through the fitted scale into DIP', () => {
    const viewWidth = 220 / PIXELS_PER_METRE
    const viewHeight = (250 - GROUND_PAD_PX) / PIXELS_PER_METRE
    const scale = fitModelScale(1.27, MODEL_HEIGHT, viewWidth, viewHeight)
    const speed = walkDipPerSecond(scale)
    assert.equal(speed, WALK_UNITS_PER_SECOND * scale * PIXELS_PER_METRE)
    assert.equal(walkDistancePx(scale), speed * clipDuration('Walk') * 2)
    assert.ok(MODEL_HEIGHT * scale * PIXELS_PER_METRE < 250 - GROUND_PAD_PX)
    assert.ok(1.27 * scale * PIXELS_PER_METRE < 220)
    assert.ok(speed > 40)
  })

  it('faces the camera from the camera position and the roomier side', () => {
    assert.ok(Math.abs(viewerYawFromCamera(3.4, 0) - Math.PI / 2) < 1e-6)
    assert.equal(walkYaw(1), Math.PI)
    assert.equal(walkYaw(-1), 0)
    assert.equal(chooseFacing(100, 200), 1)
    assert.equal(chooseFacing(900, 1000), -1)
    const edge = planWalk(980, 1000, 500)
    assert.equal(edge.facing, -1)
    assert.equal(edge.distance, 500)
  })
})

describe('doberman sequence', () => {
  it('appears seated, facing the viewer, on the right', () => {
    const work = { x: 100, y: 40, width: 1800, height: 1000 }
    const home = placeAtWorkAreaRight(work)
    assert.equal(home.x, 100 + 1800 - 220 - 16)
    assert.equal(home.y, 40 + 1000 - 250 - 16)
    const quarter = rightQuarterMin(1600)
    assert.ok(quarter > 1000)
    assert.ok(quarter < 1600)
    const actor = summonActor(1600, 1600, 100, Math.PI / 2, () => 0)
    assert.equal(actor.phase, 'sit')
    assert.equal(actor.hold, SEATED_HOLD.min)
    assert.ok(Math.abs(angleDelta(actor.yaw, Math.PI / 2)) < 1e-6)
    const seated = finishOneShot(actor, actor.token, ctx({ rng: () => 0 }))
    assert.equal(seated.phase, 'sitIdle')
    assert.equal(seated.hold, SEATED_HOLD.min)
    const held = stepBehavior(seated, ctx({ dt: SEATED_HOLD.min - 0.05, rng: () => 0.9 }))
    assert.equal(held.actor.phase, 'sitIdle')
    assert.equal(held.dx, 0)
  })

  it('usually keeps sitting, and sometimes stands before sitting again', () => {
    assert.equal(chooseRest(() => 0.1), 'sit')
    assert.equal(chooseRest(() => 0.7), 'stand')
    assert.equal(chooseRest(() => 0.9), 'stroll')
    const seated = finishOneShot(
      summonActor(1600, 1600, 100, Math.PI / 2, () => 0),
      summonActor(1600, 1600, 100, Math.PI / 2, () => 0).token,
      ctx()
    )
    const renewed = stepBehavior(seated, ctx({ dt: SEATED_HOLD.min, rng: scriptedRng([0.1, 0]) }))
    assert.equal(renewed.actor.phase, 'sitIdle')
    assert.ok(renewed.actor.hold >= SEATED_HOLD.min && renewed.actor.hold <= SEATED_HOLD.max)
    const rising = stepBehavior(seated, ctx({ dt: SEATED_HOLD.min, rng: () => 0.7 }))
    assert.equal(rising.actor.phase, 'standUp')
    const standing = finishOneShot(rising.actor, rising.actor.token, ctx({ rng: () => 0 }))
    assert.equal(standing.phase, 'idle')
    assert.ok(standing.hold >= STAND_HOLD.min && standing.hold <= STAND_HOLD.max)
    assert.ok(Math.abs(angleDelta(standing.yaw, Math.PI / 2)) < 1e-6)
    const early = stepBehavior(standing, ctx({ dt: standing.hold - 0.05 }))
    assert.equal(early.actor.phase, 'idle')
    const again = stepBehavior(early.actor, ctx({ dt: 0.1 }))
    assert.equal(again.actor.phase, 'sit')
  })

  it('stands up, strolls inside the right quarter, then returns home and sits', () => {
    const home = 1500
    const seated = finishOneShot(summonActor(home, 1600, 100, Math.PI / 2, () => 0), summonActor(home, 1600, 100, Math.PI / 2, () => 0).token, ctx({ home, x: home }))
    const rising = stepBehavior(seated, ctx({ dt: SEATED_HOLD.min, rng: () => 0.9, home, x: home }))
    assert.equal(rising.actor.phase, 'standUp')
    const turned = finishOneShot(rising.actor, rising.actor.token, ctx({ rng: () => 0, home, x: home }))
    assert.equal(turned.phase, 'turn')
    assert.equal(turned.turnInto, 'walk')
    assert.equal(turned.returning, false)
    const outing = planOuting(home, turned.yaw === 0 ? 0 : roamFor(home, 1600).min, roamFor(home, 1600).max, 100, 1)
    assert.ok(outing.distance <= 1600 - rightQuarterMin(1600))
    const walking = run({ ...turned, age: 0 }, TURN_SECONDS + 0.05, { home, x: home, rng: () => 0 })
    assert.equal(walking.actor.phase, 'walk')
    const away = run(walking.actor, 1.2, { home, x: home, rng: () => 0 })
    assert.equal(away.actor.returning, true)
    assert.equal(away.actor.turnInto, 'walk')
    const back = run(away.actor, TURN_SECONDS + 1.2, { home, x: home + away.dx, rng: () => 0 })
    assert.equal(back.actor.phase, 'turn')
    assert.equal(back.actor.turnInto, 'sit')
    const seatedAgain = run(back.actor, TURN_SECONDS + 0.05, { home, x: home })
    assert.equal(seatedAgain.actor.phase, 'sit')
    assert.ok(Math.abs(angleDelta(seatedAgain.actor.yaw, Math.PI / 2)) < 1e-3)
  })

  it('keeps a seated pause while the note is open and stays facing the viewer', () => {
    const actor = summonActor(1600, 1600, 100, Math.PI / 2, () => 0)
    const opened = stepBehavior(actor, ctx({ mode: 'panel', dt: 0.05 }))
    assert.equal(opened.dx, 0)
    assert.equal(opened.actor.phase, 'sit')
    const seated = finishOneShot(opened.actor, opened.actor.token, ctx())
    const stayed = run(seated, 30, { mode: 'panel' })
    assert.equal(stayed.actor.phase, 'sitIdle')
    assert.equal(stayed.dx, 0)
    assert.equal(stayed.actor.age, 0)
    assert.equal(settleForPanel(stayed.actor, Math.PI / 2), stayed.actor)
    const resumed = stepBehavior(stayed.actor, ctx({ dt: SEATED_HOLD.min - 0.1, rng: () => 0.9 }))
    assert.equal(resumed.actor.phase, 'sitIdle')
  })

  it('pauses travel while dragging and replans from the new home', () => {
    const actor = {
      ...summonActor(1000, 1000, 100, Math.PI, () => 0),
      phase: 'walk' as const,
      facing: 1 as const,
      yaw: Math.PI,
      remaining: 200,
      returning: false
    }
    const dragged = stepBehavior(actor, ctx({ mode: 'drag', dt: 0.5, x: 1000, home: 1000, span: 1000 }))
    assert.equal(dragged.dx, 0)
    assert.equal(dragged.actor.remaining, actor.remaining)
    const replanned = replanAfterDrag(actor, 1000, 1000, 100, Math.PI / 2, () => 0, roamFor(1000, 1000))
    assert.equal(replanned.facing, -1)
    assert.equal(replanned.phase, 'turn')
    assert.equal(replanned.turnInto, 'walk')
  })

  it('faces the viewer and does not roam when motion is reduced', () => {
    const actor = summonActor(400, 1600, 100, Math.PI / 2, scriptedRng([0.1, 0]))
    const stilled = stepBehavior(actor, ctx({ mode: 'reduced', dt: 5 }))
    assert.equal(stilled.dx, 0)
    assert.equal(stilled.actor.phase, 'idle')
    assert.equal(stilled.actor.paused, true)
    assert.ok(Math.abs(angleDelta(stilled.actor.yaw, Math.PI / 2)) < 1e-6)
    const again = settleReduced(stilled.actor, Math.PI / 2)
    assert.equal(again, stilled.actor)
  })

  it('ignores a Sit finish after dismiss', () => {
    const sitting = {
      ...summonActor(400, 1600, 100, Math.PI / 2, scriptedRng([0.1, 0])),
      phase: 'sit' as const,
      token: 4
    }
    assert.equal(finishOneShot(sitting, 3, ctx()).phase, 'sit')
    const hidden = silence(sitting)
    assert.equal(finishOneShot(hidden, sitting.token, ctx()).phase, 'sit')
  })

  it('stands up before a guided walk, then follows a clear reversal', () => {
    const seated = finishOneShot(
      summonActor(800, 1600, 100, Math.PI / 2, () => 0),
      summonActor(800, 1600, 100, Math.PI / 2, () => 0).token,
      ctx({ x: 800 })
    )
    const order = { token: 2, kind: 'walk' as const, destination: 1100, commitHome: true }
    const rising = stepBehavior(seated, ctx({ order, x: 800, dt: 0.05, mode: 'panel' }))
    assert.equal(rising.actor.phase, 'standUp')
    assert.equal(rising.actor.errand, 'walk')
    assert.equal(rising.dx, 0)
    const risen = run(rising.actor, 1.2, { order, x: 800 })
    assert.equal(risen.actor.phase === 'walk' || risen.actor.phase === 'turn', true)
    const walking = risen.actor.phase === 'walk' ? risen.actor : run(risen.actor, 0.5, { order, x: 800 + risen.dx }).actor
    assert.equal(walking.phase, 'walk')
    assert.equal(walking.facing, 1)
    const nudged = stepBehavior(walking, ctx({ order: { ...order, destination: 1110 }, x: 900 }))
    assert.equal(nudged.actor.facing, 1)
    const reversed = stepBehavior(walking, ctx({ order: { ...order, destination: 200 }, x: 900 }))
    assert.equal(reversed.actor.phase === 'turn' || reversed.actor.facing === -1, true)
    assert.notEqual(reversed.actor.facing, 1)
  })

  it('stops a manual walk at the work-area edge and lets a pose hold', () => {
    const order = { token: 3, kind: 'walk' as const, destination: 5000, commitHome: false }
    const standing = {
      ...summonActor(1500, 1600, 100, Math.PI / 2, () => 0),
      phase: 'idle' as const,
      yaw: Math.PI / 2
    }
    const started = run(standing, 0.6, { order, x: 1500, span: 1600 })
    const away = run(started.actor, 3, { order, x: 1500 + started.dx, span: 1600 })
    assert.ok(1500 + started.dx + away.dx <= 1600.01)
    const stayed = finishOneShot(
      summonActor(400, 1600, 100, Math.PI / 2, () => 0),
      summonActor(400, 1600, 100, Math.PI / 2, () => 0).token,
      ctx()
    )
    const held = run(stayed, 30, { order: { token: 4, kind: 'stay', destination: 400, commitHome: false }, x: 400 })
    assert.equal(held.dx, 0)
    assert.equal(held.actor.phase === 'sit' || held.actor.phase === 'sitIdle' || held.actor.phase === 'turn', true)
  })
})

describe('cursor look', () => {
  it('keeps one pointer poll and converts desktop DIP without scaling twice', () => {
    assert.equal(pointerWatch(false, true), 'start')
    assert.equal(pointerWatch(true, true), 'keep')
    assert.equal(pointerWatch(true, false), 'stop')
    const sample = { x: 500, y: 700, windowX: 100, windowY: 200, scaleFactor: 2 }
    const local = pointerToViewport(sample, 0, 0)
    assert.deepEqual(local, { x: 400, y: 500 })
    assert.deepEqual(pointerToViewport({ ...sample, scaleFactor: 1.5 }, 0, 0), local)
    assert.deepEqual(canvasOrigin(false, 'left'), { x: 0, y: 0 })
    assert.equal(canvasOrigin(true, 'left').x, PANEL.width + PANEL.gap)
    assert.equal(canvasOrigin(true, 'right').x, 0)
    const shifted = pointerToViewport(sample, canvasOrigin(true, 'left').x, 0)
    assert.equal(shifted.x, 400 - (PANEL.width + PANEL.gap))
    assert.equal(shifted.y, 500)
  })

  it('damps a limited look and ignores a tiny pointer move', () => {
    assert.deepEqual(lookTarget(100, 100, 110, 108), { yaw: 0, pitch: 0 })
    const glance = lookTarget(100, 100, 100 + 80, 100)
    assert.ok(glance.yaw > 0 && glance.yaw < LOOK_YAW_LIMIT)
    assert.ok(Math.abs(glance.pitch) < 1e-9)
    const pinned = lookTarget(100, 100, 100 + 2000, 100 - 2000)
    assert.equal(pinned.yaw, LOOK_YAW_LIMIT)
    assert.equal(pinned.pitch, LOOK_PITCH_LIMIT)
    const below = lookTarget(100, 100, 100, 100 + 200)
    assert.ok(below.pitch < 0)
    assert.ok(Math.abs(below.pitch) <= LOOK_PITCH_LIMIT)
    const eased = dampLook(0, 1, 0.08)
    assert.ok(eased > 0.2 && eased < 0.8)
    assert.ok(Math.hypot(110 - 100, 108 - 100) < LOOK_DEAD_ZONE)
  })
})
