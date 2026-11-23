import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { PETS } from './pets.ts'
import {
  cropStyle,
  frameHealth,
  FULL_FRAME,
  likelyProtected,
  matchProjectVideo,
  normaliseCrop,
  overlaps,
  placeProjector,
  projectorBounds
} from './projector.ts'
import { routeCommand } from './commands.ts'

const read = (p: string): string => readFileSync(new URL(p, import.meta.url), 'utf8')

describe('Chrome profiles: one launch per choice (static)', () => {
  const app = read('../renderer/src/motion/MotionApp.tsx')
  const main = read('../main/chrome-profiles.ts')
  it('a double click can’t launch twice; failures are reported with the real reason', () => {
    assert.match(app, /if \(chromeLaunchToken\.current === token\) return\s*\n\s*chromeLaunchToken\.current = token/)
    assert.match(main, /const running = inflight\.get\(key\)\s*\n\s*if \(running\) return running/)
    assert.match(main, /reason: `I couldn’t launch Chrome as “\$\{live\.displayName\}”\$\{detail \? ` \(\$\{detail\}\)` : ''\}/)
    assert.match(main, /I can’t see which profile’s window is in front/)
  })
  it('“cancel” also cancels a pending Chrome choice while GPT Mode is paused', () => {
    assert.match(app, /if \(localPending\) \{\s*cancelWorkflow\(chromePending \? 'Okay\. Cancelled — Chrome wasn\\u2019t opened\.'/)
  })
})

describe('app fan (static)', () => {
  const main = read('../main/switcher-window.ts')
  const fan = read('../renderer/src/switcher/Switcher.tsx')
  it('the closing click on MIKO doesn’t reopen the fan, and a second open doesn’t restart it', () => {
    assert.match(main, /export function toggleSwitcherFromPet/)
    assert.match(main, /if \(Date\.now\(\) - lastBlurHideAt < REOPEN_GUARD_MS \+ 300\) return/)
    assert.match(main, /if \(current\.isVisible\(\)\) \{\s*\/\/ Already open/)
    assert.match(fan, /if \(isOpen\.current\) return/)
    assert.match(fan, /if \(document\.hidden\) reset\(\)/)
  })
  it('a drag swallows only its own click', () => {
    assert.match(fan, /if \(current\?\.active\) window\.setTimeout\(\(\) => \(suppressClick\.current = false\), 0\)/)
  })
})

describe('bird, toys, readable controls', () => {
  it('the bird travels by flying and carries in its feet; other pets keep their walk', () => {
    assert.deepEqual(PETS.bird.clips.walk, ['Fly'])
    assert.equal(PETS.bird.carry, 'talons')
    assert.deepEqual(PETS.doberman.clips.walk, ['Walk'])
    assert.equal(PETS.cat.carry, undefined)
  })
  it('resting toys sit on the window’s ground line, not on the (flying) pet’s box', () => {
    const layer = read('../renderer/src/motion/PlayLayer.tsx')
    assert.match(layer, /const floorY = PET_SLOT_H - GROUND_PX - TOY_PX/)
    assert.match(layer, /ball: \{ x: 4, y: floorY \}/)
  })
  it('controls are ~40 px by default; compact is opt-in; headers never shrink', () => {
    const css = read('../renderer/src/styles.css')
    assert.match(css, /html:not\(\.is-compact\) \.text-button,[\s\S]*?min-height: 40px/)
    assert.match(css, /\.panel-bar,\s*\n\.gpt-mode-banner \{\s*flex-shrink: 0;/)
  })
})

describe('video projector', () => {
  const work = { x: 0, y: 25, width: 1440, height: 875 }
  it('sits above MIKO inside the work area and never covers it', () => {
    const pet = { x: 1180, y: 640, width: 220, height: 250 }
    const size = projectorBounds(520, 16 / 9)
    const r = placeProjector(size, pet, work)
    assert.ok(r.y + r.height <= pet.y)
    assert.ok(r.x >= work.x && r.x + r.width <= work.x + work.width)
    assert.equal(overlaps(r, pet), false)
    // No room above (pet near the top): beside it instead.
    const high = { x: 600, y: 40, width: 220, height: 250 }
    const side = placeProjector(size, high, work)
    assert.equal(overlaps(side, high), false)
    assert.ok(side.y >= work.y)
  })
  it('keeps the aspect ratio with controls outside the video', () => {
    const b = projectorBounds(520, 16 / 9, 88)
    assert.equal(b.width, 536)
    assert.equal(b.height, Math.round(520 / (16 / 9) + 88 + 16))
  })
  it('crop maps a region into the box keeping its shape', () => {
    assert.equal(normaliseCrop({ x: 0.1, y: 0.1 }, { x: 0.12, y: 0.5 }), null)
    const crop = normaliseCrop({ x: 0.5, y: 0.5 }, { x: 0.25, y: 0.25 })!
    assert.deepEqual(crop, { x: 0.25, y: 0.25, width: 0.25, height: 0.25 })
    const s = cropStyle({ width: 400, height: 225 }, 1600, 900, crop)
    assert.ok(Math.abs(s.width - 1600) < 1)
    assert.ok(Math.abs(s.left + 400) < 1)
    const full = cropStyle({ width: 400, height: 400 }, 1600, 900, FULL_FRAME)
    assert.ok(Math.abs(full.top - (400 - 225) / 2) < 1, 'letterboxed, not stretched')
  })
  it('black for 3 s while frames arrive = probably protected; no frames = frozen', () => {
    const black = [0, 1000, 2000, 3100].map((at) => ({ at, luma: 2, lastFrameAt: at }))
    assert.equal(frameHealth(black, 3200), 'black')
    const lit = black.map((s) => ({ ...s, luma: 80 }))
    assert.equal(frameHealth(lit, 3200), 'live')
    assert.equal(frameHealth([{ at: 0, luma: 80, lastFrameAt: 0 }], 4000), 'frozen')
    assert.equal(likelyProtected('Stranger Things | Netflix'), true)
    assert.equal(likelyProtected('Big Buck Bunny - YouTube'), false)
  })
  it('opens from plain phrases and captures exactly the chosen window, no audio', () => {
    assert.equal(matchProjectVideo('project video'), true)
    assert.equal(matchProjectVideo('Project a video above MIKO.'), true)
    assert.equal(matchProjectVideo('play a video'), false)
    assert.deepEqual(routeCommand('project video', 'voice', [], []), { type: 'project-video' })
    const main = read('../main/projector.ts')
    const page = read('../renderer/src/projector/Projector.tsx')
    assert.match(main, /if \(!match\) \{[\s\S]{0,120}callback\(\{\}\)/)
    assert.match(main, /callback\(\{ video: match \}\)/)
    assert.doesNotMatch(main, /audio: ['"]loopback/)
    assert.match(page, /audio: false/)
    assert.match(page, /stream\?\.getTracks\(\)\.forEach\(\(track\) => track\.stop\(\)\)/)
  })
})
