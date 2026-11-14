import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  DUTY,
  HIPS,
  HIP_Y,
  LEG_LOWER,
  LEG_UPPER,
  STRIDE,
  createFootLocks,
  footStep,
  plantedWorldX,
  resolveFoot,
  toWorld
} from './gait.ts'
import { DUCK_Y, PEEK_Y, SLIDE_BACK } from './motion.ts'
import { movementBlocked, placeAtWorkAreaBottom } from './movement.ts'
import { chooseSummonShortcut, DEFAULT_SUMMON_SHORTCUT, isSummonAccelerator } from './shortcut.ts'
import { SEGMENT, WALK_CYCLES, sampleMotion } from './sequence.ts'
import { finishExit, initialSummon, requestHide, requestShow, toggleSummon } from './summon.ts'
import {
  PAUSE_SECONDS,
  createWander,
  edgeAntic,
  holdInPlace,
  stepWander,
  wanderSample
} from './wander.ts'

describe('summon', () => {
  it('starts hidden and treats a second press during the exit as a fresh summon', () => {
    const hidden = initialSummon()
    const shown = toggleSummon(hidden, false)
    assert.equal(shown.effect, 'show')
    const exiting = toggleSummon(shown.state, false)
    assert.equal(exiting.effect, 'play-exit')
    const cancelled = toggleSummon(exiting.state, false)
    assert.equal(cancelled.effect, 'cancel-exit')
    assert.equal(cancelled.state.presence, 'visible')
    const stale = finishExit(cancelled.state, exiting.state.generation)
    assert.equal(stale.effect, 'none')
    assert.equal(stale.state.presence, 'visible')
  })

  it('hides immediately when reduced motion is on', () => {
    const shown = requestShow(initialSummon())
    const hidden = requestHide(shown.state, true)
    assert.equal(hidden.effect, 'hide-now')
    assert.equal(hidden.state.presence, 'hidden')
  })

  it('ignores an exit that finished after a newer toggle', () => {
    const exiting = toggleSummon(toggleSummon(initialSummon(), false).state, false)
    const again = toggleSummon(exiting.state, false)
    const late = finishExit(again.state, exiting.state.generation)
    assert.equal(late.effect, 'none')
  })
})

describe('shortcut', () => {
  it('accepts the default and rejects an empty override', () => {
    assert.equal(isSummonAccelerator(DEFAULT_SUMMON_SHORTCUT), true)
    assert.equal(chooseSummonShortcut(undefined).shortcut, DEFAULT_SUMMON_SHORTCUT)
    assert.equal(chooseSummonShortcut('nope').shortcut, DEFAULT_SUMMON_SHORTCUT)
    assert.equal(chooseSummonShortcut('Control+Alt+M').shortcut, 'Control+Alt+M')
  })
})

describe('work area', () => {
  it('sits on the bottom of the usable display and clamps a tiny one', () => {
    const placed = placeAtWorkAreaBottom({ x: 100, y: 40, width: 1800, height: 1000 })
    assert.equal(placed.x, 100 + (1800 - 220) / 2)
    assert.equal(placed.y, 40 + 1000 - 250 - 16)
    const tiny = placeAtWorkAreaBottom({ x: 0, y: 0, width: 100, height: 80 })
    assert.ok(tiny.x >= 0)
    assert.ok(tiny.y >= 0)
  })

  it('blocks autonomous movement while hidden, dragged, noted, or reduced', () => {
    assert.equal(
      movementBlocked({ hidden: false, dragging: false, panelOpen: false, reducedMotion: false }),
      false
    )
    assert.equal(movementBlocked({ hidden: true, dragging: false, panelOpen: false, reducedMotion: false }), true)
    assert.equal(movementBlocked({ hidden: false, dragging: true, panelOpen: false, reducedMotion: false }), true)
    assert.equal(movementBlocked({ hidden: false, dragging: false, panelOpen: true, reducedMotion: false }), true)
    assert.equal(movementBlocked({ hidden: false, dragging: false, panelOpen: false, reducedMotion: true }), true)
  })
})

describe('gait', () => {
  it('keeps a planted paw fixed while the body advances through stance', () => {
    const hip = HIPS.find((item) => item.beat === 0)
    assert.ok(hip)
    const start = plantedWorldX(0, hip.beat, hip.x)
    const end = plantedWorldX(STRIDE * DUTY - 0.0001, hip.beat, hip.x)
    assert.ok(Math.abs(start - end) < 0.002)
    assert.equal(footStep(0, 0).planted, true)
    assert.equal(footStep(STRIDE * 0.8, 0).planted, false)
  })

  it('lifts one paw at a time in back-left, front-left, back-right, front-right order', () => {
    const order: number[] = []
    let previous = -1
    for (let step = 0; step < 80; step += 1) {
      const distance = (step / 80) * STRIDE
      const swinging = HIPS.map((hip, index) => (!footStep(distance, hip.beat).planted ? index : -1)).filter(
        (index) => index >= 0
      )
      assert.equal(swinging.length, 1)
      const index = swinging[0] ?? -1
      if (index !== previous) {
        order.push(index)
        previous = index
      }
    }
    assert.deepEqual(order, [2, 0, 3, 1])
  })

  it('holds stance paws in place through the turn and keeps them in reach', () => {
    const turnStart = SEGMENT.peek + SEGMENT.step + SEGMENT.walk + SEGMENT.look
    const locks = createFootLocks(HIPS.length)
    const held: Array<{ step: number; x: number; z: number } | null> = HIPS.map(() => null)
    for (let time = turnStart; time < turnStart + SEGMENT.turn - 0.02; time += 1 / 60) {
      const sample = sampleMotion(time)
      assert.equal(sample.phase, 'turn')
      assert.equal(sample.y, 0)
      const pose = { x: sample.x, z: 0, yaw: sample.yaw }
      HIPS.forEach((hip, index) => {
        const foot = resolveFoot(
          locks,
          index,
          sample.gaitDistance,
          hip.beat,
          hip.x,
          hip.z,
          pose,
          sample.gait
        )
        const prior = held[index]
        const lock = locks[index]
        if (foot.planted && prior && lock && prior.step === lock.step) {
          assert.ok(Math.abs(foot.x - prior.x) < 1e-6)
          assert.ok(Math.abs(foot.z - prior.z) < 1e-6)
        }
        if (foot.planted && lock) {
          const hipWorld = toWorld(hip.x, hip.z, pose)
          const reach = Math.hypot(foot.x - hipWorld.x, foot.y - HIP_Y, foot.z - hipWorld.z)
          assert.ok(reach <= LEG_UPPER + LEG_LOWER + 0.001)
          held[index] = { step: lock.step, x: foot.x, z: foot.z }
        } else {
          held[index] = null
        }
      })
    }
  })
})

describe('sequence', () => {
  it('walks one stride per cycle, turns halfway around, then slides back to a stand', () => {
    assert.equal(sampleMotion(0).y, PEEK_Y)
    const climbed = sampleMotion(
      SEGMENT.peek +
        SEGMENT.step +
        SEGMENT.walk +
        SEGMENT.look +
        SEGMENT.turn +
        SEGMENT.walkBack +
        SEGMENT.scratch +
        SEGMENT.rear +
        SEGMENT.climb * 0.5
    )
    assert.equal(climbed.phase, 'climb')
    assert.equal(climbed.y, 0)

    const walked = sampleMotion(SEGMENT.peek + SEGMENT.step + SEGMENT.walk)
    assert.equal(walked.phase, 'look')
    assert.ok(Math.abs(walked.x - STRIDE * WALK_CYCLES) < 0.001)

    const turned = sampleMotion(SEGMENT.peek + SEGMENT.step + SEGMENT.walk + SEGMENT.look + SEGMENT.turn)
    assert.equal(turned.phase, 'walkBack')
    assert.ok(Math.abs(turned.yaw - Math.PI) < 0.001)
    assert.ok(Math.abs(turned.x - walked.x) < 0.001)

    const climb = sampleMotion(
      SEGMENT.peek +
        SEGMENT.step +
        SEGMENT.walk +
        SEGMENT.look +
        SEGMENT.turn +
        SEGMENT.walkBack +
        SEGMENT.scratch +
        SEGMENT.rear +
        SEGMENT.climb
    )
    const landed = sampleMotion(
      SEGMENT.peek +
        SEGMENT.step +
        SEGMENT.walk +
        SEGMENT.look +
        SEGMENT.turn +
        SEGMENT.walkBack +
        SEGMENT.scratch +
        SEGMENT.rear +
        SEGMENT.climb +
        SEGMENT.slide +
        SEGMENT.land
    )
    assert.ok(Math.abs(landed.x - climb.x - SLIDE_BACK) < 0.001)
    assert.equal(landed.pitch, 0)
    assert.equal(landed.y, 0)
    assert.ok(Math.abs(landed.yaw - Math.PI) < 0.001)
    assert.equal(sampleMotion(SEGMENT.peek + SEGMENT.step + SEGMENT.walk + SEGMENT.look + SEGMENT.turn + SEGMENT.walkBack + SEGMENT.scratch + SEGMENT.rear + SEGMENT.climb + SEGMENT.slide + SEGMENT.land + SEGMENT.shake + SEGMENT.settle + SEGMENT.duck).y, DUCK_Y)

    const scratch = sampleMotion(
      SEGMENT.peek +
        SEGMENT.step +
        SEGMENT.walk +
        SEGMENT.look +
        SEGMENT.turn +
        SEGMENT.walkBack +
        SEGMENT.scratch * 0.125
    )
    assert.ok(scratch.scratch > 0.5)
  })
})

describe('wander', () => {
  it('varies pauses and plays the antic only on every third side', () => {
    assert.equal(edgeAntic(1), false)
    assert.equal(edgeAntic(2), false)
    assert.equal(edgeAntic(3), true)
    assert.notEqual(Number(PAUSE_SECONDS[0]), Number(PAUSE_SECONDS[1]))

    let state = createWander(0)
    const span = 360
    const phases: string[] = []
    const pauses: number[] = []
    let slideStart = 0
    let landedX = 0
    let sawScratch = false
    for (let frame = 0; frame < 8000 && landedX === 0; frame += 1) {
      const before = state.phase
      state = stepWander(state, 1 / 30, span)
      if (state.phase === before) continue
      phases.push(state.phase)
      if (state.phase === 'pause') pauses.push(state.duration)
      if (state.phase === 'scratch') sawScratch = true
      if (state.phase === 'slide') slideStart = state.x
      if (sawScratch && before === 'slide' && state.phase === 'land') landedX = state.x
    }

    assert.equal(phases[0], 'step')
    assert.equal(phases.includes('peek'), false)
    assert.ok(pauses.length >= 2)
    assert.notEqual(pauses[0], pauses[1])
    assert.ok(phases.indexOf('turn') < phases.indexOf('scratch'))
    assert.ok(slideStart - landedX > 30)
    const stand = wanderSample({ ...state, phase: 'land', age: 0.3, duration: 0.3, yaw: Math.PI })
    assert.equal(stand.pitch, 0)
    assert.equal(stand.y, 0)

    const held = holdInPlace(createWander(40))
    assert.equal(stepWander(held, 1, span).x, 40)
    assert.equal(stepWander(held, 1, span).phase, 'pause')
  })
})
