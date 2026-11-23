import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { routeCommand, type CatalogApp } from './commands.ts'
import { PETS } from './pets.ts'
import {
  PLAY_IDLE,
  insideRect,
  parsePlayMode,
  petTargetFor,
  planThrow,
  playControlsPet,
  playReduce,
  StrokeDetector,
  throwPoint,
  TOY_SIZE,
  type PlayEvent,
  type PlayState
} from './play.ts'

const run = (events: PlayEvent[], from: PlayState = PLAY_IDLE): PlayState => events.reduce(playReduce, from)

describe('play state machine', () => {
  it('fetch: idle → ready → flying → chasing → carrying → reaction → ready (toy back for another throw)', () => {
    let s = run([{ type: 'choose', activity: 'fetch', toy: 'stick' }])
    assert.equal(s.phase, 'ready')
    s = playReduce(s, { type: 'throw', homeX: 900, targetX: 400 })
    assert.equal(s.phase === 'activity' && s.step, 'flying')
    assert.ok(playControlsPet(s))
    s = run([{ type: 'landed' }, { type: 'arrived' }], s)
    assert.equal(s.phase === 'activity' && s.step, 'carrying')
    if (s.phase === 'activity') assert.equal(s.homeX, 900)
    s = playReduce(s, { type: 'arrived' })
    assert.equal(s.phase, 'reaction')
    s = playReduce(s, { type: 'reaction-done' })
    assert.deepEqual(s.phase === 'ready' && [s.activity, s.toy], ['fetch', 'stick'])
  })

  it('feed and pet end in a reaction, then idle', () => {
    let s = run([{ type: 'choose', activity: 'feed', treat: 'biscuit' }, { type: 'fed' }])
    assert.equal(s.phase === 'reaction' && s.reaction, 'eat')
    assert.equal(playReduce(s, { type: 'reaction-done' }).phase, 'idle')
    s = run([{ type: 'petted' }])
    assert.equal(s.phase === 'reaction' && s.reaction, 'happy')
  })

  it('never overlaps: choosing or petting during a game is ignored; out-of-order events do nothing', () => {
    const flying = run([{ type: 'choose', activity: 'fetch' }, { type: 'throw', homeX: 0, targetX: 100 }])
    assert.equal(playReduce(flying, { type: 'choose', activity: 'feed' }), flying)
    assert.equal(playReduce(flying, { type: 'petted' }), flying)
    assert.equal(playReduce(flying, { type: 'arrived' }), flying, 'cannot arrive before the toy lands')
    assert.equal(playReduce(PLAY_IDLE, { type: 'landed' }), PLAY_IDLE)
    assert.equal(playReduce(PLAY_IDLE, { type: 'fed' }), PLAY_IDLE)
  })

  it('cancel goes to idle from anywhere, and every transition changes the token (stale timers do nothing)', () => {
    const states = [
      run([{ type: 'choose', activity: 'fetch' }]),
      run([{ type: 'choose', activity: 'fetch' }, { type: 'throw', homeX: 0, targetX: 1 }]),
      run([{ type: 'petted' }])
    ]
    for (const s of states) {
      const cancelled = playReduce(s, { type: 'cancel' })
      assert.equal(cancelled.phase, 'idle')
      assert.notEqual(cancelled.token, s.token)
    }
    // Repeated fetch + cancel cycles keep working.
    let s: PlayState = PLAY_IDLE
    for (let i = 0; i < 5; i += 1) {
      s = run([{ type: 'choose', activity: 'fetch' }, { type: 'throw', homeX: 0, targetX: 50 }, { type: 'cancel' }], s)
      assert.equal(s.phase, 'idle')
    }
    assert.equal(playReduce(PLAY_IDLE, { type: 'cancel' }), PLAY_IDLE)
  })

  it('mode defaults to Work', () => {
    assert.equal(parsePlayMode(undefined), 'work')
    assert.equal(parsePlayMode('casual'), 'casual')
    assert.equal(parsePlayMode('party'), 'work')
  })
})

describe('throw', () => {
  const work = { x: 0, y: 0, width: 1920, height: 1040 } // taskbar excluded

  it('stays inside the work area at both edges and lands on the ground line', () => {
    const right = planThrow({ x: 1850, y: 900, vx: 5000, vy: -800, work, groundY: 1000, petCenterX: 1800 }, 'ball')
    assert.ok(right.to.x <= work.x + work.width - TOY_SIZE / 2)
    assert.equal(right.to.y, 1000)
    const left = planThrow({ x: 40, y: 900, vx: -5000, vy: 0, work, groundY: 1000, petCenterX: 60 }, 'stick')
    assert.ok(left.to.x >= work.x + TOY_SIZE / 2)
    // A second monitor to the left (negative x) is fine too.
    const other = { x: -1280, y: 0, width: 1280, height: 984 }
    const far = planThrow({ x: -100, y: 900, vx: 4000, vy: 0, work: other, groundY: 2000, petCenterX: -150 }, 'ball')
    assert.ok(far.to.x <= -TOY_SIZE / 2 && far.to.y <= 984)
    for (let t = 0; t <= 1; t += 0.1) {
      const p = throwPoint(right, t)
      assert.ok(p.y >= work.y && p.y <= work.y + work.height, 'arc never leaves the work area vertically')
    }
  })

  it('a soft toss goes toward the side with more room; slow pets get shorter throws', () => {
    const soft = planThrow({ x: 1700, y: 900, vx: 30, vy: 0, work, groundY: 1000, petCenterX: 1700 }, 'ball')
    assert.ok(soft.to.x < 1700)
    const koala = planThrow({ x: 900, y: 900, vx: 5000, vy: 0, work, groundY: 1000, petCenterX: 900, maxDistance: 150 }, 'ball')
    assert.ok(Math.abs(koala.to.x - 900) <= 150)
  })

  it('the arc starts at the hand, peaks at the apex and ends on the landing spot', () => {
    const plan = planThrow({ x: 500, y: 950, vx: 900, vy: -600, work, groundY: 1000, petCenterX: 520 }, 'ball')
    assert.deepEqual(throwPoint(plan, 0), plan.from)
    assert.deepEqual(throwPoint(plan, 1), plan.to)
    const ys = Array.from({ length: 21 }, (_, i) => throwPoint(plan, i / 20).y)
    assert.ok(Math.min(...ys) < Math.min(plan.from.y, plan.to.y) - 40)
  })

  it('the pet walks to the toy, clamped to its roam span', () => {
    assert.equal(petTargetFor(500, work, 220, 16, 1668), 500 - 16 - 110)
    assert.equal(petTargetFor(5, work, 220, 16, 1668), 0)
    assert.equal(petTargetFor(9999, work, 220, 16, 1668), 1668)
  })
})

describe('petting stroke', () => {
  const sweep = (d: StrokeDetector, from: number, to: number, t0: number, over = true): { hit: boolean; t: number } => {
    let t = t0
    let hit = false
    const step = from < to ? 4 : -4
    for (let x = from; from < to ? x <= to : x >= to; x += step) {
      t += 16
      hit = d.sample(x, over, t) || hit
    }
    return { hit, t }
  }

  it('back-and-forth over the pet counts once, then cools down', () => {
    const d = new StrokeDetector()
    let t = 0
    let fired = 0
    for (let i = 0; i < 6; i += 1) {
      const r = sweep(d, i % 2 ? 140 : 80, i % 2 ? 80 : 140, t)
      t = r.t
      if (r.hit) fired += 1
    }
    assert.equal(fired, 1)
  })

  it('passing over once, jitter, or moving outside the pet never counts', () => {
    const d = new StrokeDetector()
    assert.equal(sweep(d, 0, 200, 0).hit, false)
    let t = 0
    let fired = false
    for (let i = 0; i < 40; i += 1) {
      t += 16
      fired = d.sample(100 + (i % 2 ? 3 : -3), true, t) || fired
    }
    assert.equal(fired, false, 'jitter')
    const out = new StrokeDetector()
    let tt = 0
    for (let i = 0; i < 6; i += 1) tt = sweep(out, i % 2 ? 140 : 80, i % 2 ? 80 : 140, tt, false).t
    assert.equal(out.sample(100, false, tt + 16), false)
  })

  it('drop target uses the pet rect with a little slop', () => {
    const rect = { x: 36, y: 24, width: 148, height: 200 }
    assert.equal(insideRect(40, 30, rect), true)
    assert.equal(insideRect(30, 30, rect, 6), true)
    assert.equal(insideRect(10, 10, rect, 6), false)
  })
})

describe('play routing and pets', () => {
  const catalog: CatalogApp[] = [{ id: 'spotify', name: 'Spotify', installed: true, familiar: true, aliases: ['spotify'] }]
  it('exact phrases open Play; music requests are untouched', () => {
    assert.deepEqual(routeCommand("let's play", 'voice', catalog, []), { type: 'play', activity: null })
    assert.deepEqual(routeCommand('Play fetch.', 'typed', catalog, []), { type: 'play', activity: 'fetch' })
    assert.deepEqual(routeCommand('throw the ball', 'voice', catalog, []), { type: 'play', activity: 'fetch' })
    assert.notEqual(routeCommand('play music', 'typed', catalog, []).type, 'play')
    // A bare “fetch” stays with WhatsApp attachments.
    assert.notEqual(routeCommand('fetch', 'typed', catalog, []).type, 'play')
    assert.notEqual(routeCommand('play despacito on spotify', 'typed', catalog, []).type, 'play')
  })

  it('every pet declares its happy clips (empty = short hop fallback, never an invented clip)', () => {
    for (const pet of Object.values(PETS)) assert.ok(Array.isArray(pet.happyClips), pet.id)
    assert.deepEqual(PETS.doberman.happyClips, [])
  })
})

describe('play wiring (static)', () => {
  const main = readFileSync(new URL('../main/play.ts', import.meta.url), 'utf8')
  const app = readFileSync(new URL('../renderer/src/motion/MotionApp.tsx', import.meta.url), 'utf8')
  const layer = readFileSync(new URL('../renderer/src/motion/PlayLayer.tsx', import.meta.url), 'utf8')

  it('the thrown toy window never takes clicks or focus and stays in the work area', () => {
    assert.match(main, /focusable: false/)
    assert.match(main, /win\.setIgnoreMouseEvents\(true\)/)
    assert.match(main, /getDisplayMatching\(petBounds\)\.workArea/)
    assert.match(main, /display-removed', onChange/)
    assert.match(main, /display-metrics-changed', onChange/)
  })

  it('commands, the panel, Escape, Dismiss and pet switches stop play', () => {
    assert.match(app, /Any other command gets the pet's full attention: play stops first\.\n\s*if \(playRef\.current\.phase !== 'idle' \|\| playMenuRef\.current !== 'closed'\) stopPlay\('task'\)/)
    assert.match(app, /if \(open && \(playRef\.current\.phase !== 'idle' \|\| playMenuRef\.current !== 'closed'\)\) stopPlay\('panel'\)/)
    assert.match(app, /stopPlay\('escape'\)/)
    assert.match(app, /stopPlay\('dismiss'\)/)
    assert.match(app, /stopPlay\('pet'\)/)
  })

  it('play walks with the existing controller (no second renderer or router)', () => {
    assert.doesNotMatch(layer, /new PetRig|THREE\./)
    assert.match(app, /order = \{ kind: 'walk', destination, commitHome: false, token: order\.token \+ 1 \}/)
  })

  it('a held toy or treat always releases the pointer (drop, cancel or unmount)', () => {
    assert.match(layer, /window\.miko\?\.setPointerHeld\(true\)/)
    assert.equal((layer.match(/setPointerHeld\(false\)/g) ?? []).length, 2)
  })

  it('sounds are opt-in', () => {
    assert.match(main, /readSetting\('playSound'\) === true/)
    assert.match(app, /if \(!playSettingsRef\.current\.sound\) return/)
  })
})
