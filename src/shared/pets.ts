/**
 * Pet characters. Pure: used by main (asset discovery, tree window), the
 * renderer (rig, chooser) and tests. Every pet reuses the Doberman's shared
 * behavior controller (src/shared/doberman.ts): the controller speaks in
 * roles (idle, walk, sit, sitIdle, standUp) and each pet maps those roles to
 * its own clips, with fallbacks when a clip is missing.
 *
 * All the blocky pets share one convention (pet_animals/README.md): glTF Y up,
 * the animal faces +Z, feet on y = 0, 24 fps, locomotion clips in place.
 */
import { MODEL_HEIGHT, MODEL_LENGTH, GROUND_PAD_PX, fitModelScale } from './doberman.ts'
import { PET_WINDOW } from './layout.ts'
import { PIXELS_PER_METRE } from './motion.ts'

export type PetId = 'doberman' | 'cat' | 'bird' | 'koala'
export const PET_IDS: PetId[] = ['doberman', 'cat', 'bird', 'koala']
export const DEFAULT_PET: PetId = 'doberman'

/** Roles the shared behavior controller asks for. */
export type PetRole = 'idle' | 'walk' | 'sit' | 'sitIdle' | 'standUp'

/** An extra clip played now and then without changing the controller's phase. */
export interface PetFlavor {
  clip: string
  /** Phase it may play in. Seated flavors start and end in the sit pose. */
  during: 'idle' | 'sitIdle'
  /** Loop the clip this many times (1 = once). */
  loops: number
  /** Relative chance when several flavors fit. */
  weight: number
}

export interface PetLook {
  /** Bone that takes part of the turn (the Doberman and the cat have one). */
  neck: string | null
  head: string
  /** Share of the turn on the neck; the head takes the rest. */
  neckShare: number
}

export interface PetSpec {
  id: PetId
  name: string
  blurb: string
  /** Asset file: bundled for the Doberman, under pet_animals/ for the rest. */
  file: string
  /** Preferred clip per role, then fallbacks in order. Idle must exist. */
  clips: Record<PetRole, string[]>
  /** In-place Walk travel, model units per second (from the asset notes). */
  walkUnitsPerSecond: number
  /** Doberman: fit the measured animated box to the window (unchanged). Others: Doberman's scale times `size`. */
  fit: 'measured' | 'reference'
  size: number
  look: PetLook
  flavors: PetFlavor[]
  /** Bird: flies to a tree in the screen corner and perches there. */
  flies: boolean
  /**
   * Tab+Q “feed to close” drop zone in switcher-local DIP, relative to the fan’s
   * bottom-center (0,0). Negative Y is upward into the fan (toward the pet head).
   * Missing mouth bones → body-centered fallback via these offsets.
   */
  feedDrop: { offsetX: number; offsetY: number; radius: number }
  /** Preferred reaction clip names when an app/tab is fed (first that exists wins). */
  feedClips: string[]
  /**
   * Casual-mode happy reaction (petting, a returned toy): first clip that exists wins.
   * Empty: the pet does a short hop instead (no invented animation).
   */
  happyClips: string[]
  /** How a fetched toy is carried: in the mouth (head anchor) or, for the bird, in its feet. */
  carry?: 'mouth' | 'talons'
  /** Names used in typed or spoken commands. */
  aliases: string[]
}

export const PETS: Record<PetId, PetSpec> = {
  doberman: {
    id: 'doberman',
    name: 'Doberman',
    blurb: 'The original MIKO. Walks, sits and watches your cursor.',
    file: 'doberman.glb',
    clips: { idle: ['Idle'], walk: ['Walk'], sit: ['Sit'], sitIdle: ['SitIdle'], standUp: ['StandUp'] },
    walkUnitsPerSecond: 0.9,
    fit: 'measured',
    size: 1,
    look: { neck: 'neck', head: 'head', neckShare: 0.4 },
    flavors: [],
    flies: false,
    feedDrop: { offsetX: 0, offsetY: -52, radius: 78 },
    feedClips: [],
    happyClips: [],
    aliases: ['doberman', 'dog', 'doggo', 'puppy', 'pup', 'miko']
  },
  cat: {
    id: 'cat',
    name: 'Cat',
    blurb: 'A ginger tabby. Stretches, sits and licks its paw.',
    file: 'cat/cat.glb',
    clips: { idle: ['Idle'], walk: ['Walk'], sit: ['Sit'], sitIdle: ['SitIdle'], standUp: ['StandUp'] },
    walkUnitsPerSecond: 0.55,
    fit: 'reference',
    size: 1,
    look: { neck: 'neck', head: 'head', neckShare: 0.4 },
    flavors: [
      { clip: 'LickPaw', during: 'sitIdle', loops: 1, weight: 3 },
      { clip: 'Stretch', during: 'idle', loops: 1, weight: 2 }
    ],
    flies: false,
    feedDrop: { offsetX: 0, offsetY: -48, radius: 74 },
    feedClips: ['LickPaw'],
    happyClips: ['Stretch'],
    aliases: ['cat', 'kitty', 'kitten', 'tabby', 'ginger cat']
  },
  bird: {
    id: 'bird',
    name: 'Bird',
    blurb: 'A little blue bird with its own tree. Flies about, chirps and perches.',
    file: 'bird/bird.glb',
    // No sitting clips: resting is a peck, then standing, then a chirp to get going.
    // Travelling is flight (wing-flap Fly loop, lifted off the ground), never the quadruped-style hop.
    clips: { idle: ['Idle'], walk: ['Fly'], sit: ['Peck', 'Idle'], sitIdle: ['Idle'], standUp: ['Chirp', 'Idle'] },
    walkUnitsPerSecond: 0.7,
    fit: 'reference',
    size: 1,
    look: { neck: null, head: 'head', neckShare: 0 },
    flavors: [
      { clip: 'Chirp', during: 'sitIdle', loops: 1, weight: 3 },
      { clip: 'Peck', during: 'sitIdle', loops: 1, weight: 2 },
      { clip: 'Chirp', during: 'idle', loops: 1, weight: 1 }
    ],
    flies: true,
    feedDrop: { offsetX: 0, offsetY: -44, radius: 70 },
    feedClips: ['Peck', 'Chirp'],
    happyClips: ['Chirp'],
    carry: 'talons',
    aliases: ['bird', 'birdie', 'blue bird', 'bluebird', 'birb']
  },
  koala: {
    id: 'koala',
    name: 'Koala',
    blurb: 'A sleepy grey koala. Waddles slowly, waves and naps.',
    file: 'koala/koala.glb',
    clips: { idle: ['Idle'], walk: ['Walk'], sit: ['Sit'], sitIdle: ['SitIdle'], standUp: ['StandUp'] },
    walkUnitsPerSecond: 0.23,
    fit: 'reference',
    size: 1,
    look: { neck: null, head: 'head', neckShare: 0 },
    flavors: [
      { clip: 'Wave', during: 'sitIdle', loops: 1, weight: 2 },
      { clip: 'Sleep', during: 'sitIdle', loops: 3, weight: 2 }
    ],
    flies: false,
    feedDrop: { offsetX: 0, offsetY: -50, radius: 76 },
    feedClips: ['Wave'],
    happyClips: ['Wave'],
    aliases: ['koala', 'koala bear']
  }
}

/** How a pet is named in a sentence: "the cat", but "the Doberman" (a breed name). */
export function petNoun(id: PetId): string {
  return id === 'doberman' ? 'Doberman' : PETS[id].name.toLowerCase()
}

export function parsePetId(value: unknown): PetId | null {
  return typeof value === 'string' && (PET_IDS as string[]).includes(value) ? (value as PetId) : null
}

/** Resolved clip per role for the clips the asset really has. null = the asset can't be used. */
export function resolvePetClips(spec: PetSpec, available: Iterable<string>): Record<PetRole, string> | null {
  const have = new Set(available)
  if (!have.has('Idle')) return null
  const pick = (role: PetRole): string => spec.clips[role].find((name) => have.has(name)) ?? 'Idle'
  return { idle: 'Idle', walk: pick('walk'), sit: pick('sit'), sitIdle: pick('sitIdle'), standUp: pick('standUp') }
}

/** Flavors whose clips exist in the asset. */
export function usableFlavors(spec: PetSpec, available: Iterable<string>): PetFlavor[] {
  const have = new Set(available)
  return spec.flavors.filter((flavor) => have.has(flavor.clip))
}

export function pickFlavor(flavors: PetFlavor[], during: PetFlavor['during'], rng: () => number): PetFlavor | null {
  const fit = flavors.filter((flavor) => flavor.during === during)
  const total = fit.reduce((sum, flavor) => sum + flavor.weight, 0)
  if (!fit.length || total <= 0) return null
  let roll = rng() * total
  for (const flavor of fit) {
    roll -= flavor.weight
    if (roll < 0) return flavor
  }
  return fit[fit.length - 1]
}

/**
 * Model scale (window units per model unit) shared by the reference pets: the
 * Doberman's fitted scale from its asset notes, so every pet keeps its real
 * size relative to the dog (a cat is smaller than a Doberman).
 */
export function referenceScale(): number {
  const viewW = PET_WINDOW.width / PIXELS_PER_METRE
  const usableH = (PET_WINDOW.height - GROUND_PAD_PX) / PIXELS_PER_METRE
  return fitModelScale(MODEL_LENGTH, MODEL_HEIGHT, viewW, usableH)
}

/** Screen pixels (DIP) per model unit for a reference pet. */
export function unitPx(spec: PetSpec): number {
  return referenceScale() * spec.size * PIXELS_PER_METRE
}

// ---------- Bird tree ----------

/** From bird.glb: the Tree node's mesh bounds (local) and its PerchPoint child. */
export const TREE = {
  minX: -0.41,
  maxX: 0.915,
  height: 1.59,
  perch: { x: 0.64, y: 0.53 }
} as const

export const TREE_PAD = 6

/**
 * Tree window size and the perch point inside it, in DIP. The tree is drawn
 * mirrored (camera behind it) so its branch reaches left, into the screen,
 * when the tree stands in the bottom-right corner.
 */
export function treeLayout(px: number): { width: number; height: number; perchX: number; perchY: number } {
  const width = Math.ceil((TREE.maxX - TREE.minX) * px) + TREE_PAD * 2
  const height = Math.ceil(TREE.height * px) + TREE_PAD * 2
  return {
    width,
    height,
    perchX: Math.round(TREE_PAD + (TREE.maxX - TREE.perch.x) * px),
    perchY: Math.round(TREE_PAD + (TREE.height - TREE.perch.y) * px)
  }
}

/** Tree window position: bottom-right corner of the work area. */
export function treeBounds(work: { x: number; y: number; width: number; height: number }, px: number): { x: number; y: number; width: number; height: number } {
  const size = treeLayout(px)
  return { x: Math.round(work.x + work.width - size.width), y: Math.round(work.y + work.height - size.height), width: size.width, height: size.height }
}

/** Pet window origin that puts the bird's feet on the perch. */
export function perchOrigin(tree: { x: number; y: number }, px: number): { x: number; y: number } {
  const size = treeLayout(px)
  return {
    x: Math.round(tree.x + size.perchX - PET_WINDOW.width / 2),
    y: Math.round(tree.y + size.perchY - (PET_WINDOW.height - GROUND_PAD_PX))
  }
}

// ---------- Flight ----------

export const FLY_PX_PER_SECOND = 260

export interface FlightPlan {
  from: { x: number; y: number }
  to: { x: number; y: number }
  seconds: number
  /** Arc height in DIP above the straight line. */
  lift: number
}

export function planFlight(from: { x: number; y: number }, to: { x: number; y: number }): FlightPlan {
  const distance = Math.hypot(to.x - from.x, to.y - from.y)
  return { from, to, seconds: Math.max(0.8, distance / FLY_PX_PER_SECOND), lift: Math.min(90, 30 + distance * 0.15) }
}

/** Position along the flight at t in [0, 1]: eased along the line, lifted on an arc. */
export function flightPoint(plan: FlightPlan, t: number): { x: number; y: number } {
  const k = Math.min(1, Math.max(0, t))
  const ease = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2
  return {
    x: plan.from.x + (plan.to.x - plan.from.x) * ease,
    y: plan.from.y + (plan.to.y - plan.from.y) * ease - Math.sin(Math.PI * k) * plan.lift
  }
}

// ---------- Commands ----------

const PET_WORD = '(?:pet|miko|character|animal|avatar)'

/** "switch to the cat", "make MIKO a koala", "change pet to bird", "be a dog again". Null for anything else. */
export function parsePetCommand(raw: string): { kind: 'switch'; pet: PetId } | { kind: 'choose' } | null {
  const t = raw
    .trim()
    .toLowerCase()
    .replace(/[.!?]+$/g, '')
    .replace(/^(?:please\s+|hey\s+miko,?\s+|miko,?\s+)/, '')
    .replace(/\s+(?:please|again|now|instead)$/g, '')
    .replace(/\s+/g, ' ')
  if (new RegExp(`^(?:choose|pick|change|switch|customi[sz]e)\\s+(?:my\\s+|your\\s+|the\\s+)?${PET_WORD}$|^(?:show\\s+)?(?:pet\\s+)?(?:chooser|choices)$|^(?:which|what)\\s+pets?\\s+(?:can i|are there)`).test(t)) {
    return { kind: 'choose' }
  }
  const name = '(?:a\\s+|an\\s+|the\\s+|my\\s+)?([a-z ]{2,20}?)'
  const patterns = [
    new RegExp(`^(?:switch|change)\\s+(?:my\\s+|your\\s+|the\\s+)?${PET_WORD}\\s+(?:to|into)\\s+${name}$`),
    new RegExp(`^(?:switch|change)\\s+to\\s+${name}(?:\\s+${PET_WORD})?$`),
    new RegExp(`^(?:make|turn)\\s+(?:miko|yourself|you)\\s+(?:into\\s+)?${name}$`),
    new RegExp(`^(?:turn|transform)\\s+into\\s+${name}$`),
    new RegExp(`^(?:be|become)\\s+${name}$`),
    new RegExp(`^(?:use|choose|pick|select)\\s+${name}\\s+(?:as\\s+(?:my\\s+)?)?${PET_WORD}$`),
    new RegExp(`^(?:i want|give me)\\s+${name}(?:\\s+(?:as\\s+(?:my\\s+)?)?${PET_WORD})?$`)
  ]
  for (const re of patterns) {
    const found = re.exec(t)
    if (!found?.[1]) continue
    const word = found[1].trim()
    const pet = PET_IDS.find((id) => PETS[id].aliases.includes(word))
    if (pet) return { kind: 'switch', pet }
  }
  return null
}
