import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { TREE, TREE_PAD } from '../../../shared/pets'

/**
 * The bird's tree, drawn alone in a small click-through window in the screen
 * corner. Same lights as the pet. The camera looks from behind (-Z) so the
 * branch with the perch reaches left, into the screen.
 */
declare global {
  interface Window {
    mikoTree?: { model: () => Promise<ArrayBuffer | null>; onScale: (listener: (unitPx: number) => void) => void }
  }
}

const canvas = document.getElementById('tree') as HTMLCanvasElement
const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, premultipliedAlpha: false })
renderer.setClearColor(0x000000, 0)
renderer.outputColorSpace = THREE.SRGBColorSpace
const scene = new THREE.Scene()
scene.add(new THREE.HemisphereLight(0xfff6ee, 0xd9cfc3, 0.72))
const key = new THREE.DirectionalLight(0xfff8f2, 0.82)
key.position.set(-1.8, 3.1, -2.4)
scene.add(key)
const fill = new THREE.DirectionalLight(0xd5e0ee, 0.28)
fill.position.set(2.4, 1.6, 1.2)
scene.add(fill)
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.05, 20)

function layout(): void {
  const width = canvas.clientWidth || 1
  const height = canvas.clientHeight || 1
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
  renderer.setSize(width, height, false)
  // One window pixel per DIP: the frustum spans the window in tree units around the tree's box.
  const unit = (height - TREE_PAD * 2) / TREE.height
  // Camera-space x = -world X: the left edge shows world X = maxX (+ padding).
  camera.left = -(TREE.maxX + TREE_PAD / unit)
  camera.right = camera.left + width / unit
  camera.top = TREE.height + TREE_PAD / unit
  camera.bottom = camera.top - height / unit
  // Behind the tree, looking +Z: camera-space x is world -X, so world maxX (the branch side) is at the left edge.
  camera.position.set(0, 0, -5)
  camera.up.set(0, 1, 0)
  camera.lookAt(0, 0, 0)
  camera.updateProjectionMatrix()
  renderer.render(scene, camera)
}

async function start(): Promise<void> {
  const bytes = await window.mikoTree?.model()
  if (!bytes) return
  const gltf = await new GLTFLoader().parseAsync(bytes, '')
  const tree = gltf.scene.getObjectByName('Tree')
  if (!tree) return
  tree.removeFromParent()
  // Stand the tree's own origin at the scene origin (it sits beside the bird in the asset).
  tree.position.set(0, 0, 0)
  scene.add(tree)
  layout()
}

window.addEventListener('resize', layout)
window.mikoTree?.onScale(() => layout())
void start()
