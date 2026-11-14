import * as THREE from 'three'
import {
  HIPS,
  HIP_Y,
  LEG_LOWER,
  LEG_UPPER,
  createFootLocks,
  resolveFoot,
  toActor,
  type FootLock,
  type ScenePose
} from '../../../shared/gait'
import { PIXELS_PER_METRE } from '../../../shared/motion'
import { sampleMotion, type MotionSample } from '../../../shared/sequence'

const LIMB_RADIUS = 0.038
const JOINT_RADIUS = 0.052
const OVERLAP = 0.046

export interface FootReadout {
  planted: boolean
  worldX: number
  worldY: number
  worldZ: number
}

interface LegRig {
  upper: THREE.Mesh
  lower: THREE.Mesh
  hip: THREE.Mesh
  knee: THREE.Mesh
  paw: THREE.Mesh
}

function fur(color: number): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.74, metalness: 0 })
}

function placeLimb(mesh: THREE.Mesh, from: THREE.Vector3, to: THREE.Vector3): void {
  const delta = new THREE.Vector3().subVectors(to, from)
  const length = Math.max(0.04, delta.length())
  mesh.position.copy(from).add(to).multiplyScalar(0.5)
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.normalize())
  mesh.scale.set(1, length + OVERLAP, 1)
}

function bendKnee(hip: THREE.Vector3, foot: THREE.Vector3, want: THREE.Vector3): THREE.Vector3 {
  const span = new THREE.Vector3().subVectors(foot, hip)
  const dist = Math.max(0.02, span.length())
  const reach = LEG_UPPER + LEG_LOWER - 0.004
  const dir = span.multiplyScalar(1 / dist)
  const target = Math.min(dist, reach)
  const proj = (LEG_UPPER * LEG_UPPER - LEG_LOWER * LEG_LOWER + target * target) / (2 * target)
  const height = Math.sqrt(Math.max(0, LEG_UPPER * LEG_UPPER - proj * proj))
  const knee = hip.clone().addScaledVector(dir, Math.min(proj, target))
  const perp = want.clone().sub(dir.clone().multiplyScalar(want.dot(dir)))
  if (perp.lengthSq() < 1e-8) perp.set(0, 0, 1)
  return knee.addScaledVector(perp.normalize(), height)
}

/**
 * Temporary cream puppy for rehearsing motion. The live pet stays the photograph.
 * The caller owns scene-root translation and yaw. This rig only poses the body.
 */
export class LivingDog {
  readonly root = new THREE.Group()
  private readonly body: THREE.Group
  private readonly head: THREE.Group
  private readonly tail: THREE.Group
  private readonly legs: LegRig[]
  private readonly locks: Array<FootLock | null>
  private readonly hip = new THREE.Vector3()
  private readonly foot = new THREE.Vector3()
  private readonly want = new THREE.Vector3()
  private readonly actorPoint = new THREE.Vector3()

  constructor() {
    const cream = fur(0xf0d2b4)
    const ear = fur(0xc98962)
    const dark = fur(0x2c241f)

    this.body = new THREE.Group()
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.145, 0.34, 6, 12), cream)
    torso.rotation.z = Math.PI / 2
    torso.position.y = 0.38
    this.body.add(torso)

    const neck = new THREE.Mesh(new THREE.SphereGeometry(0.07, 12, 8), cream)
    neck.position.set(0.22, 0.46, 0)
    this.body.add(neck)

    this.head = new THREE.Group()
    this.head.position.set(0.28, 0.5, 0)
    const skull = new THREE.Mesh(new THREE.SphereGeometry(0.14, 16, 12), cream)
    skull.scale.set(1.15, 0.95, 1)
    const muzzle = new THREE.Mesh(new THREE.SphereGeometry(0.07, 12, 8), fur(0xf7e6d4))
    muzzle.position.set(0.11, -0.035, 0)
    const nose = new THREE.Mesh(new THREE.SphereGeometry(0.03, 10, 8), dark)
    nose.position.set(0.17, -0.028, 0)
    const leftEar = new THREE.Mesh(new THREE.CapsuleGeometry(0.042, 0.09, 4, 8), ear)
    leftEar.position.set(-0.02, 0.02, 0.1)
    leftEar.rotation.z = 0.7
    const rightEar = new THREE.Mesh(new THREE.CapsuleGeometry(0.042, 0.09, 4, 8), ear)
    rightEar.position.set(-0.02, 0.02, -0.1)
    rightEar.rotation.z = -0.7
    const leftEye = new THREE.Mesh(new THREE.SphereGeometry(0.024, 8, 8), dark)
    leftEye.position.set(0.08, 0.03, 0.055)
    const rightEye = new THREE.Mesh(new THREE.SphereGeometry(0.024, 8, 8), dark)
    rightEye.position.set(0.08, 0.03, -0.055)
    this.head.add(skull, muzzle, nose, leftEar, rightEar, leftEye, rightEye)

    this.tail = new THREE.Group()
    this.tail.position.set(-0.2, 0.44, 0)
    const tailBase = new THREE.Mesh(new THREE.SphereGeometry(0.058, 12, 8), cream)
    const tailMesh = new THREE.Mesh(new THREE.CapsuleGeometry(0.03, 0.16, 4, 8), cream)
    tailMesh.position.y = 0.1
    this.tail.add(tailBase, tailMesh)

    const limb = new THREE.CylinderGeometry(LIMB_RADIUS, LIMB_RADIUS * 0.92, 1, 8)
    this.legs = HIPS.map((hip) => {
      const material = fur(hip.front ? 0xf3d7b8 : 0xe8c6a6)
      const upper = new THREE.Mesh(limb, material)
      const lower = new THREE.Mesh(limb, material)
      const joint = new THREE.SphereGeometry(JOINT_RADIUS, 10, 8)
      const socket = new THREE.Mesh(joint, material)
      const knee = new THREE.Mesh(joint, material)
      const paw = new THREE.Mesh(new THREE.SphereGeometry(0.056, 12, 8), fur(0xf8e6d2))
      paw.scale.y = 0.55
      this.body.add(upper, lower, socket, knee, paw)
      return { upper, lower, hip: socket, knee, paw }
    })

    this.root.add(this.body)
    this.body.add(this.head, this.tail)
    this.locks = createFootLocks(HIPS.length)
  }

  reset(): void {
    this.locks.fill(null)
  }

  /** Pose the skeleton. Does not move or yaw the root. */
  apply(pose: MotionSample): FootReadout[] {
    this.body.rotation.set(pose.shake, 0, -pose.pitch)
    this.head.rotation.set(pose.headPitch, pose.headYaw, pose.shake * 0.35)
    const wag = pose.gait ? 0.38 : 0.1
    this.tail.rotation.set(-0.4, Math.sin(pose.gaitDistance * 14 + pose.along * 8) * wag, 0.15 - pose.duck * 0.4)

    const scene: ScenePose = { x: pose.x, z: 0, yaw: pose.yaw }
    const world = new THREE.Vector3()
    return this.legs.map((leg, index) => {
      const spec = HIPS[index]
      if (!spec) return { planted: false, worldX: 0, worldY: 0, worldZ: 0 }
      const placed = this.placeLeg(leg, index, spec, pose, scene)
      leg.paw.getWorldPosition(world)
      return {
        planted: placed.planted,
        worldX: world.x,
        worldY: world.y,
        worldZ: world.z
      }
    })
  }

  private placeLeg(
    leg: LegRig,
    index: number,
    spec: (typeof HIPS)[number],
    pose: MotionSample,
    scene: ScenePose
  ): { x: number; y: number; z: number; planted: boolean } {
    let planted = false
    if (pose.gait) {
      const resolved = resolveFoot(
        this.locks,
        index,
        pose.gaitDistance,
        spec.beat,
        spec.x,
        spec.z,
        scene,
        true
      )
      const local = toActor(resolved.x, resolved.z, scene)
      this.foot.set(local.x, resolved.y - pose.y, local.z)
      planted = resolved.planted
    } else {
      this.locks[index] = null
      if (pose.pitch !== 0) {
        const reach = spec.front ? Math.max(pose.climb, 0) : 0
        this.foot.copy(this.toBody(spec.x + reach * 0.18, reach * 0.42, spec.z))
      } else if (pose.scratch > 0 && index === 0) {
        this.foot.set(spec.x + 0.1, 0.05 + pose.scratch * 0.2, spec.z)
      } else {
        this.foot.set(spec.x, 0, spec.z)
      }
    }

    this.hip.set(spec.x, HIP_Y, spec.z)
    this.want.set(spec.front ? 0.45 : -0.55, 0.05, spec.bow * 0.25)
    const knee = bendKnee(this.hip, this.foot, this.want)
    placeLimb(leg.upper, this.hip, knee)
    placeLimb(leg.lower, knee, this.foot)
    leg.hip.position.copy(this.hip)
    leg.knee.position.copy(knee)
    leg.paw.position.copy(this.foot)
    return { x: this.foot.x, y: this.foot.y, z: this.foot.z, planted }
  }

  /** Actor-space point, expressed in the pitched body frame. */
  private toBody(x: number, y: number, z: number): THREE.Vector3 {
    this.actorPoint.set(x, y, z)
    this.root.updateWorldMatrix(true, false)
    this.root.localToWorld(this.actorPoint)
    return this.body.worldToLocal(this.actorPoint)
  }
}

export function createLivingStage(canvas: HTMLCanvasElement): {
  resize: () => void
  render: (time: number) => { phase: MotionSample['phase']; planted: number }
  dispose: () => void
} {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.setClearColor(0xe7e1da, 1)

  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 30)
  camera.position.set(0.2, 0.85, 2.7)
  camera.lookAt(0.2, 0.32, 0)

  scene.add(new THREE.AmbientLight(0xfff6ee, 0.9))
  const sun = new THREE.DirectionalLight(0xfff8f0, 1.35)
  sun.position.set(2, 3.2, 2.4)
  scene.add(sun)

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(8, 4),
    new THREE.MeshStandardMaterial({ color: 0xd9d2ca, roughness: 1 })
  )
  ground.rotation.x = -Math.PI / 2
  scene.add(ground)

  const wall = new THREE.Mesh(
    new THREE.BoxGeometry(0.08, 0.9, 1.5),
    new THREE.MeshStandardMaterial({ color: 0xc9c1b8, roughness: 0.92 })
  )
  wall.position.set(-0.55, 0.45, 0)
  scene.add(wall)

  const carrier = new THREE.Group()
  const dog = new LivingDog()
  carrier.add(dog.root)
  scene.add(carrier)

  const markers = HIPS.map(
    () =>
      new THREE.Mesh(
        new THREE.SphereGeometry(0.035, 10, 8),
        new THREE.MeshStandardMaterial({ color: 0x8a9a84, roughness: 1 })
      )
  )
  markers.forEach((marker) => scene.add(marker))

  const resize = (): void => {
    const width = canvas.clientWidth || 1
    const height = canvas.clientHeight || 1
    camera.aspect = width / height
    camera.updateProjectionMatrix()
    renderer.setSize(width, height, false)
  }

  return {
    resize,
    render: (time) => {
      const pose = sampleMotion(time)
      carrier.position.set(pose.x, pose.y, 0)
      carrier.rotation.set(0, pose.yaw, 0)
      const feet = dog.apply(pose)
      let planted = 0
      feet.forEach((foot, index) => {
        const marker = markers[index]
        if (!marker) return
        marker.visible = pose.gait
        marker.position.set(foot.worldX, Math.max(0.03, foot.worldY), foot.worldZ)
        const material = marker.material as THREE.MeshStandardMaterial
        material.color.setHex(foot.planted ? 0x6e8b6e : 0xd7c4a8)
        if (foot.planted) planted += 1
      })
      renderer.render(scene, camera)
      return { phase: pose.phase, planted }
    },
    dispose: () => {
      renderer.dispose()
      scene.traverse((object) => {
        const mesh = object as THREE.Mesh
        mesh.geometry?.dispose()
        const material = mesh.material
        if (Array.isArray(material)) material.forEach((entry) => entry.dispose())
        else material?.dispose()
      })
    }
  }
}

export function createDesktopRig(canvas: HTMLCanvasElement): {
  resize: () => void
  place: (pose: MotionSample) => void
  reset: () => void
  dispose: () => void
} {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.setClearColor(0x000000, 0)

  const scene = new THREE.Scene()
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 20)
  scene.add(new THREE.AmbientLight(0xfff6ee, 1.05))
  const sun = new THREE.DirectionalLight(0xfff8f0, 1.15)
  sun.position.set(1.2, 2.4, 3)
  scene.add(sun)

  const carrier = new THREE.Group()
  const dog = new LivingDog()
  carrier.add(dog.root)
  scene.add(carrier)

  const resize = (): void => {
    const width = canvas.clientWidth || 1
    const height = canvas.clientHeight || 1
    const viewWidth = width / PIXELS_PER_METRE
    const viewHeight = height / PIXELS_PER_METRE
    const pad = 20 / PIXELS_PER_METRE
    const center = viewHeight / 2 - pad
    camera.left = -viewWidth / 2
    camera.right = viewWidth / 2
    camera.top = viewHeight / 2
    camera.bottom = -viewHeight / 2
    camera.position.set(0, center, 4)
    camera.lookAt(0, center, 0)
    camera.updateProjectionMatrix()
    renderer.setSize(width, height, false)
  }

  return {
    resize,
    place: (pose) => {
      carrier.position.set(0, pose.y, 0)
      carrier.rotation.set(0, pose.yaw, 0)
      dog.apply(pose)
      renderer.render(scene, camera)
    },
    reset: () => dog.reset(),
    dispose: () => {
      renderer.dispose()
      scene.traverse((object) => {
        const mesh = object as THREE.Mesh
        mesh.geometry?.dispose()
        const material = mesh.material
        if (Array.isArray(material)) material.forEach((entry) => entry.dispose())
        else material?.dispose()
      })
    }
  }
}
