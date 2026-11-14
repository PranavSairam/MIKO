import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import type { HitRect } from '../../../shared/api'
import {
  DOBERMAN_CLIPS,
  GROUND_PAD_PX,
  MODEL_HEIGHT,
  MODEL_LENGTH,
  WALK_CYCLES,
  clipDuration,
  cycleDip,
  fitModelScale,
  viewerYawFromCamera,
  walkDipPerSecond,
  type DobermanClipName
} from '../../../shared/doberman'
import { dampLook } from '../../../shared/look'
import { PIXELS_PER_METRE } from '../../../shared/motion'
import modelUrl from '../assets/doberman.glb?inline'

const CLIP_NAMES = Object.keys(DOBERMAN_CLIPS) as DobermanClipName[]

/** The built page is a file URL. A data URI still loads under the sandbox. */
async function loadModelBytes(url: string): Promise<ArrayBuffer> {
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

/**
 * Desktop Doberman. The GLB faces +Z and is Y-up. The camera sits on +X,
 * so +Z is screen-left; a parent yaw of pi turns the dog toward screen-right.
 * Walk stays in place. The window moves at the fitted scene scale.
 */
export class DobermanRig {
  private readonly renderer: THREE.WebGLRenderer
  private readonly scene = new THREE.Scene()
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.05, 20)
  private readonly orient = new THREE.Group()
  private readonly fit = new THREE.Group()
  private readonly align = new THREE.Group()
  private mixer: THREE.AnimationMixer | null = null
  private readonly actions = new Map<string, THREE.AnimationAction>()
  private model: THREE.Object3D | null = null
  private modelBox = new THREE.Box3()
  private scale = 1
  private cycleSeconds = clipDuration('Walk')
  private activeName = ''
  private activeToken = 0
  private finishedHandler: ((event: { action: THREE.AnimationAction }) => void) | null = null
  private clipFinished: ((name: string, token: number) => void) | null = null
  private hitListener: ((rect: HitRect) => void) | null = null
  private hit: HitRect = { x: 36, y: 24, width: 148, height: 200 }
  private failed = false
  private neck: THREE.Object3D | null = null
  private headBone: THREE.Object3D | null = null
  private skinned: THREE.SkinnedMesh | null = null
  private lookYaw = 0
  private lookPitch = 0
  private lookReady = false
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

  constructor(private readonly canvas: HTMLCanvasElement) {
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
    this.ready = this.load()
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
    return walkDipPerSecond(this.scale)
  }

  walkDistancePx(): number {
    return this.dipPerSecond() * this.cycleSeconds * WALK_CYCLES
  }

  cyclePx(): number {
    return cycleDip(this.scale, this.cycleSeconds)
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
    if (this.model) this.applyFit()
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
    if (!this.lookReady || !this.headBone) return null
    this.camera.updateMatrixWorld()
    this.orient.updateWorldMatrix(true, true)
    this.headBone.getWorldPosition(this.headPoint)
    this.headPoint.project(this.camera)
    const width = this.canvas.clientWidth || 1
    const height = this.canvas.clientHeight || 1
    return {
      x: (this.headPoint.x * 0.5 + 0.5) * width,
      y: (-this.headPoint.y * 0.5 + 0.5) * height
    }
  }

  play(name: string, once: boolean, token: number): void {
    if (this.activeName === name && this.activeToken === token) return
    const action = this.actions.get(name)
    if (!action) return
    this.clearFinished()
    const previous = this.actions.get(this.activeName)
    if (previous && previous !== action) previous.stop()
    action.reset()
    action.enabled = true
    action.setEffectiveWeight(1)
    action.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, once ? 1 : Infinity)
    action.clampWhenFinished = once
    action.play()
    this.activeName = name
    this.activeToken = token
    if (!once) return
    const handler = (event: { action: THREE.AnimationAction }): void => {
      if (event.action !== action) return
      this.clearFinished()
      this.clipFinished?.(name, token)
    }
    this.finishedHandler = handler
    this.mixer?.addEventListener('finished', handler)
  }

  setPaused(paused: boolean): void {
    if (this.mixer) this.mixer.timeScale = paused ? 0 : 1
  }

  /**
   * Advance clips, then remember the pose they wrote. A paused mixer does not
   * rewrite the bones, so the previous look has to be removed first or the
   * next offset multiplies on top of it.
   */
  advance(dt: number): void {
    if (this.failed) return
    this.restorePose()
    this.mixer?.update(dt)
    this.capturePose()
  }

  private capturePose(): void {
    if (this.neck) this.baseNeck.copy(this.neck.quaternion)
    if (this.headBone) this.baseHead.copy(this.headBone.quaternion)
  }

  private restorePose(): void {
    if (!this.lookApplied) return
    if (this.neck) this.neck.quaternion.copy(this.baseNeck)
    if (this.headBone) this.headBone.quaternion.copy(this.baseHead)
    this.lookApplied = false
  }

  render(): void {
    if (this.failed) return
    this.applyLook()
    this.renderer.render(this.scene, this.camera)
  }

  stop(): void {
    this.clearFinished()
    this.restorePose()
    this.mixer?.stopAllAction()
    if (this.mixer) this.mixer.timeScale = 0
    this.activeName = ''
    this.activeToken = 0
    this.lookYaw = 0
    this.lookPitch = 0
  }

  dispose(): void {
    this.stop()
    this.renderer.dispose()
    this.scene.traverse((object) => {
      const mesh = object as THREE.Mesh
      mesh.geometry?.dispose()
      const material = mesh.material
      if (Array.isArray(material)) material.forEach((entry) => entry.dispose())
      else material?.dispose()
    })
  }

  private async load(): Promise<void> {
    try {
      const buffer = await loadModelBytes(modelUrl)
      const gltf = await new GLTFLoader().parseAsync(buffer, '')
      const names = new Set(gltf.animations.map((clip) => clip.name))
      for (const name of CLIP_NAMES) {
        if (!names.has(name)) throw new Error(`doberman.glb is missing ${name}`)
      }
      this.model = gltf.scene
      this.align.add(gltf.scene)
      this.mixer = new THREE.AnimationMixer(gltf.scene)
      for (const clip of gltf.animations) {
        this.actions.set(clip.name, this.mixer.clipAction(clip))
        const expected = DOBERMAN_CLIPS[clip.name as DobermanClipName]
        if (expected && Math.abs(clip.duration - clipDuration(clip.name as DobermanClipName)) > 1 / 24) {
          console.warn(`[miko] ${clip.name} duration ${clip.duration}s differs from the source clip`)
        }
      }
      const walk = gltf.animations.find((clip) => clip.name === 'Walk')
      this.cycleSeconds = walk?.duration ?? clipDuration('Walk')
      const boneNames: string[] = []
      gltf.scene.traverse((object) => {
        const skinned = object as THREE.SkinnedMesh
        if (skinned.isSkinnedMesh) {
          skinned.frustumCulled = false
          this.skinned = skinned
          for (const bone of skinned.skeleton.bones) {
            if (bone.name) boneNames.push(bone.name)
            if (bone.name === 'neck') this.neck = bone
            if (bone.name === 'head') this.headBone = bone
          }
        }
      })
      this.lookReady = this.neck !== null && this.headBone !== null
      if (!this.lookReady) {
        console.warn(`[miko] look skipped. skeleton bones: ${boneNames.join(', ') || '(none)'}`)
      }
      this.measure()
      this.applyFit()
      this.stop()
      console.info(
        `[miko] doberman ${CLIP_NAMES.join(', ')} scale ${this.scale.toFixed(3)} ${this.dipPerSecond().toFixed(1)} dip/s`
      )
    } catch (error) {
      this.failed = true
      console.error('[miko] could not load doberman.glb', error)
      throw error
    }
  }

  private measure(): void {
    const model = this.model
    const mixer = this.mixer
    if (!model || !mixer) return
    const union = new THREE.Box3()
    const sample = (name: DobermanClipName, time: number): void => {
      const clip = DOBERMAN_CLIPS[name]
      const action = this.actions.get(clip.name)
      if (!action) return
      mixer.stopAllAction()
      action.setLoop(THREE.LoopOnce, 1)
      action.clampWhenFinished = true
      action.play()
      action.paused = true
      action.time = Math.min(Math.max(0, time), Math.max(0, action.getClip().duration - 1e-4))
      mixer.update(0)
      model.updateWorldMatrix(true, true)
      model.traverse((object) => {
        const skinned = object as THREE.SkinnedMesh
        if (skinned.isSkinnedMesh) skinned.skeleton.update()
      })
      union.union(new THREE.Box3().setFromObject(model, true))
      action.stop()
    }
    for (const time of [0, 0.5, 1, 1.5]) sample('Idle', time)
    for (const time of [0, 0.25, 0.5, 0.75]) sample('Walk', time)
    sample('Sit', clipDuration('Sit'))
    for (const time of [0, 0.5, 1, 1.5]) sample('SitIdle', time)
    sample('StandUp', 0)
    sample('StandUp', clipDuration('StandUp'))
    mixer.stopAllAction()
    if (union.isEmpty()) {
      union.set(new THREE.Vector3(-0.22, 0, -0.4), new THREE.Vector3(0.22, MODEL_HEIGHT, MODEL_LENGTH - 0.4))
    }
    this.modelBox = union
  }

  private applyFit(): void {
    const width = this.canvas.clientWidth || 1
    const height = this.canvas.clientHeight || 1
    const size = this.modelBox.getSize(new THREE.Vector3())
    const center = this.modelBox.getCenter(new THREE.Vector3())
    this.align.position.set(-center.x, -this.modelBox.min.y, -center.z)
    const pad = GROUND_PAD_PX / PIXELS_PER_METRE
    const viewW = width / PIXELS_PER_METRE
    const usableH = Math.max(0.2, height / PIXELS_PER_METRE - pad)
    const length = size.z > 0.01 ? size.z : MODEL_LENGTH
    const tall = size.y > 0.01 ? size.y : MODEL_HEIGHT
    this.scale = fitModelScale(length, tall, viewW, usableH)
    this.fit.scale.setScalar(this.scale)
    this.publishHit()
  }

  private publishHit(): void {
    const width = this.canvas.clientWidth || 1
    const height = this.canvas.clientHeight || 1
    this.camera.updateMatrixWorld()
    this.align.updateWorldMatrix(true, true)
    const corner = new THREE.Vector3()
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    const xs = [this.modelBox.min.x, this.modelBox.max.x]
    const ys = [this.modelBox.min.y, this.modelBox.max.y]
    const zs = [this.modelBox.min.z, this.modelBox.max.z]
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
   * head +Y looks screen-right, so the signs oppose. Local +X nods down.
   * No roll, so the head stays upright and the neck stays attached.
   */
  private applyLook(): void {
    if (!this.lookReady || !this.neck || !this.headBone) return
    this.neck.quaternion.copy(this.baseNeck)
    this.headBone.quaternion.copy(this.baseHead)
    this.lookApplied = false
    if (Math.abs(this.lookYaw) < 1e-4 && Math.abs(this.lookPitch) < 1e-4) {
      this.skinned?.skeleton.update()
      return
    }
    this.yawTurn.setFromAxisAngle(this.axisZ, -this.lookYaw * 0.4)
    this.pitchTurn.setFromAxisAngle(this.axisX, -this.lookPitch * 0.4)
    this.neck.quaternion.multiply(this.yawTurn).multiply(this.pitchTurn)
    this.yawTurn.setFromAxisAngle(this.axisY, this.lookYaw * 0.6)
    this.pitchTurn.setFromAxisAngle(this.axisX, -this.lookPitch * 0.6)
    this.headBone.quaternion.multiply(this.yawTurn).multiply(this.pitchTurn)
    this.lookApplied = true
    this.skinned?.skeleton.update()
  }

  private clearFinished(): void {
    if (!this.finishedHandler || !this.mixer) {
      this.finishedHandler = null
      return
    }
    this.mixer.removeEventListener('finished', this.finishedHandler)
    this.finishedHandler = null
  }
}
