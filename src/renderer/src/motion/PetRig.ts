import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import type { HitRect } from '../../../shared/api'
import {
  GROUND_PAD_PX,
  MODEL_HEIGHT,
  MODEL_LENGTH,
  WALK_CYCLES,
  clipDuration,
  fitModelScale,
  viewerYawFromCamera
} from '../../../shared/doberman'
import { dampLook } from '../../../shared/look'
import { PIXELS_PER_METRE } from '../../../shared/motion'
import { PETS, referenceScale, resolvePetClips, usableFlavors, type PetFlavor, type PetRole, type PetSpec } from '../../../shared/pets'
import dobermanUrl from '../assets/doberman.glb?inline'

/** The built page is a file URL. A data URI still loads under the sandbox. */
export async function dobermanBytes(): Promise<ArrayBuffer> {
  const url = dobermanUrl
  if (url.startsWith('data:')) {
    const base64 = url.slice(url.indexOf(',') + 1)
    const binary = atob(base64)
    const bytes = new Uint8Array(binary.length)
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
    return bytes.buffer
  }
  const response = await fetch(url)
  if (!response.ok) throw new Error(`doberman.glb ${response.status}`)
  return response.arrayBuffer()
}

export interface PetSource {
  spec: PetSpec
  bytes: ArrayBuffer
}

/** Everything that belongs to one loaded pet. Swapped as a whole. */
interface LoadedPet {
  spec: PetSpec
  root: THREE.Object3D
  mixer: THREE.AnimationMixer
  actions: Map<string, THREE.AnimationAction>
  clips: Record<PetRole, string>
  flavors: PetFlavor[]
  durations: Map<string, number>
  neck: THREE.Object3D | null
  head: THREE.Object3D | null
  skinned: THREE.SkinnedMesh | null
  box: THREE.Box3
  cycleSeconds: number
}

/** Parse a pet asset into a ready (not yet shown) pet. Throws when it can't be used. */
async function parsePet(source: PetSource): Promise<LoadedPet> {
  const gltf = await new GLTFLoader().parseAsync(source.bytes, '')
  const names = gltf.animations.map((clip) => clip.name)
  const clips = resolvePetClips(source.spec, names)
  if (!clips) throw new Error(`${source.spec.file} has no Idle clip`)
  // The bird's tree is drawn in its own window in the screen corner, not beside the bird.
  const tree = gltf.scene.getObjectByName('Tree')
  tree?.removeFromParent()
  const mixer = new THREE.AnimationMixer(gltf.scene)
  const actions = new Map<string, THREE.AnimationAction>()
  const durations = new Map<string, number>()
  for (const clip of gltf.animations) {
    actions.set(clip.name, mixer.clipAction(clip))
    durations.set(clip.name, clip.duration)
  }
  let neck: THREE.Object3D | null = null
  let head: THREE.Object3D | null = null
  let skinned: THREE.SkinnedMesh | null = null
  gltf.scene.traverse((object) => {
    const mesh = object as THREE.SkinnedMesh
    if (!mesh.isSkinnedMesh) return
    mesh.frustumCulled = false
    skinned = mesh
    for (const bone of mesh.skeleton.bones) {
      if (source.spec.look.neck && bone.name === source.spec.look.neck) neck = bone
      if (bone.name === source.spec.look.head) head = bone
    }
  })
  if (!head) console.warn(`[miko] ${source.spec.id}: head bone "${source.spec.look.head}" not found; cursor tracking off`)
  const pet: LoadedPet = {
    spec: source.spec,
    root: gltf.scene,
    mixer,
    actions,
    clips,
    flavors: usableFlavors(source.spec, names),
    durations,
    neck,
    head,
    skinned,
    box: new THREE.Box3(),
    cycleSeconds: durations.get(clips.walk) ?? clipDuration('Walk')
  }
  pet.box = measure(pet)
  return pet
}

/** Union of the animated bounds over the clips the controller uses. */
function measure(pet: LoadedPet): THREE.Box3 {
  const union = new THREE.Box3()
  const sample = (name: string, time: number): void => {
    const action = pet.actions.get(name)
    if (!action) return
    pet.mixer.stopAllAction()
    action.setLoop(THREE.LoopOnce, 1)
    action.clampWhenFinished = true
    action.play()
    action.paused = true
    action.time = Math.min(Math.max(0, time), Math.max(0, action.getClip().duration - 1e-4))
    pet.mixer.update(0)
    pet.root.updateWorldMatrix(true, true)
    pet.root.traverse((object) => {
      const mesh = object as THREE.SkinnedMesh
      if (mesh.isSkinnedMesh) mesh.skeleton.update()
    })
    union.union(new THREE.Box3().setFromObject(pet.root, true))
    action.stop()
  }
  if (pet.spec.fit === 'measured') {
    // The Doberman's original sampling, so its on-screen size is unchanged.
    for (const time of [0, 0.5, 1, 1.5]) sample('Idle', time)
    for (const time of [0, 0.25, 0.5, 0.75]) sample('Walk', time)
    sample('Sit', clipDuration('Sit'))
    for (const time of [0, 0.5, 1, 1.5]) sample('SitIdle', time)
    sample('StandUp', 0)
    sample('StandUp', clipDuration('StandUp'))
  } else {
    for (const name of new Set(Object.values(pet.clips))) {
      const seconds = pet.durations.get(name) ?? 1
      for (const k of [0, 0.25, 0.5, 0.75, 1]) sample(name, seconds * k)
    }
  }
  pet.mixer.stopAllAction()
  if (union.isEmpty()) {
    union.set(new THREE.Vector3(-0.22, 0, -0.4), new THREE.Vector3(0.22, MODEL_HEIGHT, MODEL_LENGTH - 0.4))
  }
  return union
}

function disposeObject(root: THREE.Object3D): void {
  root.traverse((object) => {
    const mesh = object as THREE.Mesh
    mesh.geometry?.dispose()
    const material = mesh.material
    if (Array.isArray(material)) material.forEach((entry) => entry.dispose())
    else material?.dispose()
  })
}

/**
 * Desktop pet. Each GLB faces +Z and is Y-up. The camera sits on +X, so +Z is
 * screen-left; a parent yaw of pi turns the pet toward screen-right. Walk
 * stays in place and the window moves at the fitted scene scale. A new pet is
 * parsed off-screen and swapped in only when it loaded, so a broken asset
 * leaves the current pet in place.
 */
export class PetRig {
  private readonly renderer: THREE.WebGLRenderer
  private readonly scene = new THREE.Scene()
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.05, 20)
  private readonly orient = new THREE.Group()
  private readonly fit = new THREE.Group()
  private readonly align = new THREE.Group()
  private pet: LoadedPet | null = null
  private scale = 1
  private activeName = ''
  private activeToken = 0
  private finishedHandler: ((event: { action: THREE.AnimationAction }) => void) | null = null
  private clipFinished: ((name: string, token: number) => void) | null = null
  private hitListener: ((rect: HitRect) => void) | null = null
  private hit: HitRect = { x: 36, y: 24, width: 148, height: 200 }
  private failed = false
  private paused = false
  private lookYaw = 0
  private lookPitch = 0
  private readonly axisX = new THREE.Vector3(1, 0, 0)
  private readonly axisY = new THREE.Vector3(0, 1, 0)
  private readonly axisZ = new THREE.Vector3(0, 0, 1)
  private readonly yawTurn = new THREE.Quaternion()
  private readonly pitchTurn = new THREE.Quaternion()
  private readonly headPoint = new THREE.Vector3()
  private readonly baseNeck = new THREE.Quaternion()
  private readonly baseHead = new THREE.Quaternion()
  private lookApplied = false

  readonly ready: Promise<void>

  constructor(
    private readonly canvas: HTMLCanvasElement,
    initial: Promise<PetSource>
  ) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      antialias: true,
      premultipliedAlpha: false
    })
    this.renderer.setClearColor(0x000000, 0)
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.scene.add(new THREE.HemisphereLight(0xfff6ee, 0xd9cfc3, 0.72))
    const key = new THREE.DirectionalLight(0xfff8f2, 0.82)
    key.position.set(1.8, 3.1, 2.4)
    this.scene.add(key)
    const fill = new THREE.DirectionalLight(0xd5e0ee, 0.28)
    fill.position.set(-2.4, 1.6, -1.2)
    this.scene.add(fill)
    this.fit.add(this.align)
    this.orient.add(this.fit)
    this.scene.add(this.orient)
    this.resize()
    this.ready = this.loadInitial(initial)
  }

  /** The pet on screen (null until the first load). */
  current(): PetSpec | null {
    return this.pet?.spec ?? null
  }

  /** Clip for a controller role on the current pet. */
  roleClip(role: PetRole): string {
    return this.pet?.clips[role] ?? 'Idle'
  }

  flavors(): PetFlavor[] {
    return this.pet?.flavors ?? []
  }

  clipSeconds(name: string): number {
    return this.pet?.durations.get(name) ?? 0
  }

  hasClip(name: string): boolean {
    return this.pet?.actions.has(name) ?? false
  }

  /** Real lengths of the current pet's one-shot role clips, for the shared controller. */
  oneShotSeconds(): { sit: number; standUp: number } {
    return { sit: this.clipSeconds(this.roleClip('sit')), standUp: this.clipSeconds(this.roleClip('standUp')) }
  }

  /**
   * Load another pet and swap it in. The current pet keeps rendering until
   * the new one has parsed; on failure it stays and the error is thrown.
   */
  async switchTo(source: PetSource): Promise<void> {
    const next = await parsePet(source)
    this.install(next)
  }

  onClipFinished(handler: (name: string, token: number) => void): void {
    this.clipFinished = handler
  }

  onHit(handler: (rect: HitRect) => void): void {
    this.hitListener = handler
  }

  hitRect(): HitRect {
    return this.hit
  }

  dipPerSecond(): number {
    const units = this.pet?.spec.walkUnitsPerSecond ?? PETS.doberman.walkUnitsPerSecond
    return units * this.scale * PIXELS_PER_METRE
  }

  walkDistancePx(): number {
    return this.dipPerSecond() * this.cycleSeconds() * WALK_CYCLES
  }

  cyclePx(): number {
    return this.dipPerSecond() * this.cycleSeconds()
  }

  private cycleSeconds(): number {
    return this.pet?.cycleSeconds ?? clipDuration('Walk')
  }

  /** DIP per model unit on screen right now. */
  unitPx(): number {
    return this.scale * PIXELS_PER_METRE
  }

  /** Yaw that points the model's +Z at this camera. */
  viewerYaw(): number {
    return viewerYawFromCamera(this.camera.position.x, this.camera.position.z)
  }

  resize(): void {
    const width = this.canvas.clientWidth || 1
    const height = this.canvas.clientHeight || 1
    const viewW = width / PIXELS_PER_METRE
    const viewH = height / PIXELS_PER_METRE
    const pad = GROUND_PAD_PX / PIXELS_PER_METRE
    const lookY = viewH / 2 - pad
    this.camera.left = -viewW / 2
    this.camera.right = viewW / 2
    this.camera.top = viewH / 2
    this.camera.bottom = -viewH / 2
    this.camera.position.set(3.4, lookY, 0)
    this.camera.up.set(0, 1, 0)
    this.camera.lookAt(0, lookY, 0)
    this.camera.updateProjectionMatrix()
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    this.renderer.setSize(width, height, false)
    if (this.pet) this.applyFit()
  }

  /** Parent yaw. 0 faces screen-left, π faces screen-right, and the camera yaw faces the viewer. */
  setYaw(yaw: number): void {
    if (Math.abs(this.orient.rotation.y - yaw) < 1e-4) return
    this.orient.rotation.y = yaw
    this.publishHit()
  }

  /**
   * Ease toward a look offset. Weight 0 blends it out. The offset is applied
   * after the mixer, from that frame's pose, so it does not accumulate.
   */
  dampLook(yaw: number, pitch: number, weight: number, dt: number): void {
    this.lookYaw = dampLook(this.lookYaw, yaw * weight, dt)
    this.lookPitch = dampLook(this.lookPitch, pitch * weight, dt)
  }

  /** Head position in canvas DIP from the animated pose, before the look offset. */
  headViewport(): { x: number; y: number } | null {
    const head = this.pet?.head
    if (!head) return null
    this.camera.updateMatrixWorld()
    this.orient.updateWorldMatrix(true, true)
    head.getWorldPosition(this.headPoint)
    this.headPoint.project(this.camera)
    const width = this.canvas.clientWidth || 1
    const height = this.canvas.clientHeight || 1
    return {
      x: (this.headPoint.x * 0.5 + 0.5) * width,
      y: (-this.headPoint.y * 0.5 + 0.5) * height
    }
  }

  /** Play a clip by name. A missing clip falls back to Idle (never leaves the pet frozen in a stale pose). */
  play(name: string, once: boolean, token: number): void {
    const pet = this.pet
    if (!pet) return
    const clip = pet.actions.has(name) ? name : 'Idle'
    if (this.activeName === clip && this.activeToken === token) return
    const action = pet.actions.get(clip)
    if (!action) return
    this.clearFinished()
    const previous = pet.actions.get(this.activeName)
    if (previous && previous !== action) previous.stop()
    action.reset()
    action.enabled = true
    action.setEffectiveWeight(1)
    action.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, once ? 1 : Infinity)
    action.clampWhenFinished = once
    action.play()
    this.activeName = clip
    this.activeToken = token
    // Read-only diagnostics (devtools / tests): which clip is playing.
    this.canvas.dataset.clip = clip
    if (!once) return
    const handler = (event: { action: THREE.AnimationAction }): void => {
      if (event.action !== action) return
      this.clearFinished()
      // Report the requested name so callers match it against their role clip.
      this.clipFinished?.(name, token)
    }
    this.finishedHandler = handler
    pet.mixer.addEventListener('finished', handler)
  }

  /** Play a clip for a fixed number of loops (flavors such as Sleep x3). Ends with the clip-finished event. */
  playLoops(name: string, loops: number, token: number): void {
    const pet = this.pet
    if (!pet || !pet.actions.has(name)) return
    if (loops <= 1) {
      this.play(name, true, token)
      return
    }
    this.play(name, true, token)
    const action = pet.actions.get(name)
    if (action) {
      action.setLoop(THREE.LoopRepeat, loops)
      action.clampWhenFinished = true
    }
  }

  setPaused(paused: boolean): void {
    this.paused = paused
    if (this.pet) this.pet.mixer.timeScale = paused ? 0 : 1
  }

  /**
   * Advance clips, then remember the pose they wrote. A paused mixer does not
   * rewrite the bones, so the previous look has to be removed first or the
   * next offset multiplies on top of it.
   */
  advance(dt: number): void {
    if (this.failed || !this.pet) return
    this.restorePose()
    this.pet.mixer.update(dt)
    this.capturePose()
  }

  render(): void {
    if (this.failed || !this.pet) return
    this.applyLook()
    this.renderer.render(this.scene, this.camera)
  }

  stop(): void {
    this.clearFinished()
    this.restorePose()
    if (this.pet) {
      this.pet.mixer.stopAllAction()
      this.pet.mixer.timeScale = 0
    }
    this.activeName = ''
    this.activeToken = 0
    this.lookYaw = 0
    this.lookPitch = 0
  }

  dispose(): void {
    this.stop()
    this.renderer.dispose()
    disposeObject(this.scene)
  }

  private async loadInitial(initial: Promise<PetSource>): Promise<void> {
    try {
      let source: PetSource
      try {
        source = await initial
        this.install(await parsePet(source))
      } catch (error) {
        if (this.pet) return
        // The chosen pet couldn't load: fall back to the bundled Doberman.
        console.error('[miko] chosen pet failed to load; using the Doberman', error)
        this.install(await parsePet({ spec: PETS.doberman, bytes: await dobermanBytes() }))
      }
      console.info(`[miko] ${this.pet?.spec.id} scale ${this.scale.toFixed(3)} ${this.dipPerSecond().toFixed(1)} dip/s`)
    } catch (error) {
      this.failed = true
      console.error('[miko] could not load any pet', error)
      throw error
    }
  }

  private install(next: LoadedPet): void {
    const previous = this.pet
    this.clearFinished()
    this.restorePose()
    if (previous) {
      previous.mixer.stopAllAction()
      this.align.remove(previous.root)
    }
    this.pet = next
    this.align.add(next.root)
    this.canvas.dataset.pet = next.spec.id
    next.mixer.timeScale = this.paused ? 0 : 1
    this.activeName = ''
    this.activeToken = 0
    this.lookApplied = false
    this.applyFit()
    if (previous) disposeObject(previous.root)
  }

  private capturePose(): void {
    if (this.pet?.neck) this.baseNeck.copy(this.pet.neck.quaternion)
    if (this.pet?.head) this.baseHead.copy(this.pet.head.quaternion)
  }

  private restorePose(): void {
    if (!this.lookApplied || !this.pet) return
    if (this.pet.neck) this.pet.neck.quaternion.copy(this.baseNeck)
    if (this.pet.head) this.pet.head.quaternion.copy(this.baseHead)
    this.lookApplied = false
  }

  private applyFit(): void {
    const pet = this.pet
    if (!pet) return
    const width = this.canvas.clientWidth || 1
    const height = this.canvas.clientHeight || 1
    const size = pet.box.getSize(new THREE.Vector3())
    const center = pet.box.getCenter(new THREE.Vector3())
    this.align.position.set(-center.x, -pet.box.min.y, -center.z)
    const pad = GROUND_PAD_PX / PIXELS_PER_METRE
    const viewW = width / PIXELS_PER_METRE
    const usableH = Math.max(0.2, height / PIXELS_PER_METRE - pad)
    const length = size.z > 0.01 ? size.z : MODEL_LENGTH
    const tall = size.y > 0.01 ? size.y : MODEL_HEIGHT
    // fitModelScale keeps a 10% margin, so divide it out for the "must fit" cap.
    const fits = fitModelScale(length, tall, viewW, usableH)
    this.scale = pet.spec.fit === 'measured' ? fits : Math.min(referenceScale() * pet.spec.size, fits / 0.9)
    this.fit.scale.setScalar(this.scale)
    this.publishHit()
  }

  private publishHit(): void {
    const pet = this.pet
    if (!pet) return
    const width = this.canvas.clientWidth || 1
    const height = this.canvas.clientHeight || 1
    this.camera.updateMatrixWorld()
    this.align.updateWorldMatrix(true, true)
    const corner = new THREE.Vector3()
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    const xs = [pet.box.min.x, pet.box.max.x]
    const ys = [pet.box.min.y, pet.box.max.y]
    const zs = [pet.box.min.z, pet.box.max.z]
    for (const x of xs) {
      for (const y of ys) {
        for (const z of zs) {
          corner.set(x, y, z).applyMatrix4(this.align.matrixWorld)
          corner.project(this.camera)
          const sx = (corner.x * 0.5 + 0.5) * width
          const sy = (-corner.y * 0.5 + 0.5) * height
          minX = Math.min(minX, sx)
          minY = Math.min(minY, sy)
          maxX = Math.max(maxX, sx)
          maxY = Math.max(maxY, sy)
        }
      }
    }
    if (!Number.isFinite(minX)) return
    const x = Math.max(0, minX)
    const y = Math.max(0, minY)
    const right = Math.min(width, maxX)
    const bottom = Math.min(height, maxY)
    this.hit = {
      x,
      y,
      width: Math.max(1, right - x),
      height: Math.max(1, bottom - y)
    }
    this.hitListener?.(this.hit)
  }

  /**
   * Additive local turns on top of the clip. Neck +Z looks screen-left and
   * head +Y looks screen-right, so the signs oppose. Local +X nods down. A
   * pet without a neck turns its head alone. No roll, so the head stays upright.
   */
  private applyLook(): void {
    const pet = this.pet
    if (!pet?.head) return
    const { neck, head } = pet
    if (neck) neck.quaternion.copy(this.baseNeck)
    head.quaternion.copy(this.baseHead)
    this.lookApplied = false
    if (Math.abs(this.lookYaw) < 1e-4 && Math.abs(this.lookPitch) < 1e-4) {
      pet.skinned?.skeleton.update()
      return
    }
    const neckShare = neck ? pet.spec.look.neckShare : 0
    if (neck && neckShare > 0) {
      this.yawTurn.setFromAxisAngle(this.axisZ, -this.lookYaw * neckShare)
      this.pitchTurn.setFromAxisAngle(this.axisX, -this.lookPitch * neckShare)
      neck.quaternion.multiply(this.yawTurn).multiply(this.pitchTurn)
    }
    const headShare = neck ? 1 - neckShare : 0.85
    this.yawTurn.setFromAxisAngle(this.axisY, this.lookYaw * headShare)
    this.pitchTurn.setFromAxisAngle(this.axisX, -this.lookPitch * headShare)
    head.quaternion.multiply(this.yawTurn).multiply(this.pitchTurn)
    this.lookApplied = true
    this.canvas.dataset.look = this.lookYaw.toFixed(2)
    pet.skinned?.skeleton.update()
  }

  private clearFinished(): void {
    if (!this.finishedHandler || !this.pet) {
      this.finishedHandler = null
      return
    }
    this.pet.mixer.removeEventListener('finished', this.finishedHandler)
    this.finishedHandler = null
  }
}
