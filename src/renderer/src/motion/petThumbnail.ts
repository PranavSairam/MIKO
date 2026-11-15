import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import type { PetSpec } from '../../../shared/pets'

/**
 * A still portrait of a pet for the chooser, rendered from its own .glb (so
 * a card only exists when the asset loads). One small offscreen renderer is
 * created per call and disposed right after.
 */
export async function petThumbnail(spec: PetSpec, bytes: ArrayBuffer, size = 168): Promise<string> {
  const gltf = await new GLTFLoader().parseAsync(bytes, '')
  gltf.scene.getObjectByName('Tree')?.removeFromParent()
  const canvas = document.createElement('canvas')
  canvas.width = size * 2
  canvas.height = size * 2
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true })
  try {
    renderer.setClearColor(0x000000, 0)
    renderer.outputColorSpace = THREE.SRGBColorSpace
    const scene = new THREE.Scene()
    scene.add(new THREE.HemisphereLight(0xfff6ee, 0xd9cfc3, 0.8))
    const key = new THREE.DirectionalLight(0xfff8f2, 0.85)
    key.position.set(1.8, 3.1, 2.4)
    scene.add(key)
    scene.add(gltf.scene)
    // A calm pose: the seated idle when the pet has one, else its idle.
    const clip = gltf.animations.find((c) => c.name === 'SitIdle') ?? gltf.animations.find((c) => c.name === 'Idle')
    if (clip) {
      const mixer = new THREE.AnimationMixer(gltf.scene)
      const action = mixer.clipAction(clip)
      action.play()
      mixer.setTime(Math.min(0.6, clip.duration / 2))
    }
    gltf.scene.updateWorldMatrix(true, true)
    gltf.scene.traverse((o) => {
      const mesh = o as THREE.SkinnedMesh
      if (mesh.isSkinnedMesh) {
        mesh.skeleton.update()
        mesh.frustumCulled = false
      }
    })
    const box = new THREE.Box3().setFromObject(gltf.scene, true)
    const center = box.getCenter(new THREE.Vector3())
    const extent = box.getSize(new THREE.Vector3())
    const radius = Math.max(extent.x, extent.y, extent.z) * 0.62
    const camera = new THREE.OrthographicCamera(-radius, radius, radius, -radius, 0.01, 50)
    // Three-quarter view from the front-left, slightly above.
    camera.position.set(center.x + 2.2, center.y + 0.9, center.z + 2.6)
    camera.lookAt(center)
    renderer.render(scene, camera)
    return canvas.toDataURL('image/png')
  } finally {
    renderer.dispose()
    renderer.forceContextLoss()
    gltf.scene.traverse((o) => {
      const mesh = o as THREE.Mesh
      mesh.geometry?.dispose()
      const m = mesh.material
      if (Array.isArray(m)) m.forEach((x) => x.dispose())
      else m?.dispose()
    })
    void spec
  }
}
