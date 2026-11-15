import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { PET_WINDOW } from './layout.ts'
import { GROUND_PAD_PX } from './doberman.ts'
import {
  PETS,
  PET_IDS,
  TREE,
  flightPoint,
  parsePetCommand,
  parsePetId,
  perchOrigin,
  pickFlavor,
  planFlight,
  referenceScale,
  resolvePetClips,
  treeBounds,
  treeLayout,
  unitPx,
  usableFlavors
} from './pets.ts'

/** glTF JSON chunk of a .glb. */
function gltf(path: string): { animations?: { name: string }[]; nodes: { name?: string; translation?: number[]; mesh?: number; skin?: number }[]; meshes: { primitives: { attributes: { POSITION: number } }[] }[]; accessors: { min?: number[]; max?: number[] }[] } {
  const bytes = readFileSync(path)
  const length = bytes.readUInt32LE(12)
  return JSON.parse(bytes.subarray(20, 20 + length).toString('utf8'))
}

const assetPath = (id: string): string => (id === 'doberman' ? 'src/renderer/src/assets/doberman.glb' : `pet_animals/${PETS[id as keyof typeof PETS].file}`)

describe('pet registry against the real assets', () => {
  for (const id of PET_IDS) {
    const path = assetPath(id)
    it(`${id}: every role resolves to a clip the asset has, and flavors exist`, { skip: !existsSync(path) }, () => {
      const clips = (gltf(path).animations ?? []).map((a) => a.name)
      const resolved = resolvePetClips(PETS[id], clips)
      assert.ok(resolved, `${id} has an Idle clip`)
      for (const name of Object.values(resolved)) assert.ok(clips.includes(name), `${id}: ${name}`)
      // The preferred clip is used when present (no silent fallback on the real assets).
      for (const [role, wanted] of Object.entries(PETS[id].clips)) assert.equal(resolved[role as keyof typeof resolved], wanted[0], `${id} ${role}`)
      assert.deepEqual(usableFlavors(PETS[id], clips), PETS[id].flavors)
      const bones = gltf(path).nodes.map((n) => n.name)
      assert.ok(bones.includes(PETS[id].look.head), `${id} head bone`)
      if (PETS[id].look.neck) assert.ok(bones.includes(PETS[id].look.neck as string), `${id} neck bone`)
    })
  }

  it('bird tree constants match bird.glb', { skip: !existsSync(assetPath('bird')) }, () => {
    const j = gltf(assetPath('bird'))
    const tree = j.nodes.find((n) => n.name === 'Tree')
    const perch = j.nodes.find((n) => n.name === 'PerchPoint')
    assert.ok(tree && perch && tree.mesh !== undefined)
    const accessor = j.accessors[j.meshes[tree.mesh as number].primitives[0].attributes.POSITION]
    let minX = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const p of j.meshes[tree.mesh as number].primitives) {
      const a = j.accessors[p.attributes.POSITION]
      minX = Math.min(minX, a.min?.[0] ?? 0)
      maxX = Math.max(maxX, a.max?.[0] ?? 0)
      maxY = Math.max(maxY, a.max?.[1] ?? 0)
    }
    assert.ok(accessor)
    assert.ok(Math.abs(minX - TREE.minX) < 0.01 && Math.abs(maxX - TREE.maxX) < 0.01 && Math.abs(maxY - TREE.height) < 0.01)
    assert.ok(Math.abs((perch.translation?.[0] ?? 0) - TREE.perch.x) < 0.01 && Math.abs((perch.translation?.[1] ?? 0) - TREE.perch.y) < 0.01)
  })
})

describe('fallbacks', () => {
  it('falls back through the list, then to Idle; no Idle means unusable', () => {
    assert.deepEqual(resolvePetClips(PETS.bird, ['Idle', 'Walk']), { idle: 'Idle', walk: 'Walk', sit: 'Idle', sitIdle: 'Idle', standUp: 'Idle' })
    assert.deepEqual(resolvePetClips(PETS.cat, ['Idle']), { idle: 'Idle', walk: 'Idle', sit: 'Idle', sitIdle: 'Idle', standUp: 'Idle' })
    assert.equal(resolvePetClips(PETS.cat, ['Walk', 'Sit']), null)
    assert.deepEqual(usableFlavors(PETS.koala, ['Idle', 'Wave']).map((f) => f.clip), ['Wave'])
    assert.equal(pickFlavor(PETS.koala.flavors, 'idle', () => 0.5), null)
    assert.equal(pickFlavor(PETS.cat.flavors, 'sitIdle', () => 0.99)?.clip, 'LickPaw')
  })
  it('reads stored ids defensively', () => {
    assert.equal(parsePetId('cat'), 'cat')
    assert.equal(parsePetId('dragon'), null)
    assert.equal(parsePetId(undefined), null)
  })
})

describe('size and the tree', () => {
  it('keeps real sizes relative to the Doberman and fits the window', () => {
    assert.ok(referenceScale() > 0)
    for (const id of ['cat', 'bird', 'koala'] as const) {
      const tall = { cat: 1.01, bird: 0.71, koala: 0.92 }[id]
      assert.ok(tall * unitPx(PETS[id]) < PET_WINDOW.height - GROUND_PAD_PX, `${id} fits`)
    }
    assert.ok(unitPx(PETS.cat) * 1.01 < unitPx(PETS.doberman) * 1.45, 'cat smaller than the dog')
  })
  it('puts the tree in the bottom-right corner and the perch on its branch', () => {
    const px = unitPx(PETS.bird)
    const work = { x: 0, y: 25, width: 1440, height: 875 }
    const tree = treeBounds(work, px)
    assert.equal(tree.x + tree.width, 1440)
    assert.equal(tree.y + tree.height, 900)
    const size = treeLayout(px)
    assert.ok(size.perchX > 0 && size.perchX < size.width / 2, 'branch reaches left (mirrored)')
    assert.ok(size.perchY > size.height / 2 && size.perchY < size.height)
    const origin = perchOrigin(tree, px)
    assert.equal(origin.x + PET_WINDOW.width / 2, tree.x + size.perchX)
    assert.equal(origin.y + PET_WINDOW.height - GROUND_PAD_PX, tree.y + size.perchY)
    assert.ok(origin.x + PET_WINDOW.width <= work.x + work.width && origin.y >= work.y, 'bird window stays on screen')
  })
  it('flies on an eased arc that starts and ends exactly', () => {
    const plan = planFlight({ x: 100, y: 600 }, { x: 900, y: 400 })
    assert.deepEqual(flightPoint(plan, 0), { x: 100, y: 600 })
    const end = flightPoint(plan, 1)
    assert.ok(Math.abs(end.x - 900) < 1e-9 && Math.abs(end.y - 400) < 1e-6)
    assert.ok(flightPoint(plan, 0.5).y < 500, 'lifted above the line')
    assert.ok(plan.seconds >= 0.8)
  })
})

describe('pet commands', () => {
  it('reads switch requests by name or alias', () => {
    for (const [text, pet] of [
      ['switch to the cat', 'cat'],
      ['Switch to cat.', 'cat'],
      ['change my pet to a bird', 'bird'],
      ['make miko a koala', 'koala'],
      ['turn into a kitty', 'cat'],
      ['be a dog again', 'doberman'],
      ['use the doberman as my pet', 'doberman'],
      ['switch pet to koala', 'koala'],
      ['I want the bird', 'bird'],
      ['become a birdie', 'bird']
    ] as const) {
      assert.deepEqual(parsePetCommand(text), { kind: 'switch', pet }, text)
    }
  })
  it('opens the chooser, and ignores everything else', () => {
    assert.deepEqual(parsePetCommand('change pet'), { kind: 'choose' })
    assert.deepEqual(parsePetCommand('choose your pet'), { kind: 'choose' })
    for (const t of ['switch to chrome', 'open cat facts', 'switch to the dragon', 'be quiet', 'make me a coffee', 'what is a koala']) {
      assert.equal(parsePetCommand(t), null, t)
    }
  })
})
