import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { app, BrowserWindow, screen } from 'electron'
import { DEFAULT_PET, PETS, PET_IDS, parsePetId, perchOrigin, treeBounds, type PetId } from '../shared/pets'
import { placeInitially } from '../shared/layout'
import { isPetVisible, petOriginPoint, raisePetWindow } from './pet-window'
import { selectedPet, setSelectedPet } from './settings'

/**
 * Pet characters on the main side: which assets exist, their bytes for the
 * renderer, the saved choice, flight geometry, and the bird's tree window.
 * The Doberman is bundled into the renderer; the others are read from
 * pet_animals/ only when their .glb exists, so missing pets never show.
 */

const MAX_MODEL_BYTES = 20 * 1024 * 1024

function assetRoots(): string[] {
  const roots = [join(app.getAppPath(), 'pet_animals'), join(process.cwd(), 'pet_animals')]
  if (process.resourcesPath) roots.push(join(process.resourcesPath, 'pet_animals'))
  return roots
}

function assetPath(id: PetId): string | null {
  if (id === 'doberman') return null
  for (const root of assetRoots()) {
    const path = join(root, PETS[id].file)
    try {
      if (existsSync(path) && statSync(path).isFile() && statSync(path).size > 0) return path
    } catch {
      // Unreadable: treat as missing.
    }
  }
  return null
}

/** Pets whose assets exist, Doberman first. */
export function availablePets(): PetId[] {
  return PET_IDS.filter((id) => id === 'doberman' || assetPath(id) !== null)
}

export function petModel(id: PetId): Uint8Array | null {
  const path = assetPath(id)
  if (!path || statSync(path).size > MAX_MODEL_BYTES) return null
  return new Uint8Array(readFileSync(path))
}

/** The saved pet if its asset still exists; the Doberman otherwise (and for existing users). */
export function currentPetChoice(): PetId {
  const saved = parsePetId(selectedPet()) ?? DEFAULT_PET
  return availablePets().includes(saved) ? saved : DEFAULT_PET
}

export function savePetChoice(id: PetId): boolean {
  if (!availablePets().includes(id)) return false
  return setSelectedPet(id)
}

// ---------- Active pet and the bird's tree ----------

let activePet: PetId = DEFAULT_PET
let activeUnitPx = 0
let tree: BrowserWindow | null = null
let treeReady = false

/** The renderer reports the pet it has on screen (after a successful load) and its scale. */
export function setActivePet(id: PetId, unitPx: number): void {
  activePet = id
  activeUnitPx = Number.isFinite(unitPx) && unitPx > 10 && unitPx < 1000 ? unitPx : 0
  syncTree()
}

function workForPet(): Electron.Rectangle {
  const origin = petOriginPoint()
  return screen.getDisplayNearestPoint({ x: Math.round(origin.x + 110), y: Math.round(origin.y + 125) }).workArea
}

function treeWanted(): boolean {
  return activePet === 'bird' && activeUnitPx > 0 && isPetVisible()
}

/** Show, move or hide the tree to match the pet. Cheap when nothing changed. */
export function syncTree(): void {
  if (!treeWanted()) {
    if (tree && !tree.isDestroyed() && tree.isVisible()) tree.hide()
    return
  }
  const win = ensureTree()
  const bounds = treeBounds(workForPet(), activeUnitPx)
  const now = win.getContentBounds()
  if (now.x !== bounds.x || now.y !== bounds.y || now.width !== bounds.width || now.height !== bounds.height) {
    win.setContentBounds(bounds, false)
    if (treeReady) win.webContents.send('miko:tree-scale', activeUnitPx)
  }
  if (treeReady && !win.isVisible()) {
    win.showInactive()
    win.setAlwaysOnTop(true, 'floating')
    // The bird flies and walks in front of its tree.
    raisePetWindow()
  }
}

/** Where to fly: the pet's origin now, the ground under it, and the perch (when the tree is up). */
export function flightInfo(): { origin: { x: number; y: number }; groundY: number; perch: { x: number; y: number } | null } {
  const work = workForPet()
  const origin = petOriginPoint()
  const groundY = placeInitially(work).pet.y
  const perch = treeWanted() && tree && !tree.isDestroyed() && tree.isVisible() ? perchOrigin(treeBounds(work, activeUnitPx), activeUnitPx) : null
  return { origin, groundY, perch }
}

export function isTreeSender(senderId: number): boolean {
  return tree !== null && !tree.isDestroyed() && tree.webContents.id === senderId
}

export function treeScale(): number {
  return activeUnitPx
}

function ensureTree(): BrowserWindow {
  if (tree && !tree.isDestroyed()) return tree
  treeReady = false
  const bounds = treeBounds(workForPet(), activeUnitPx)
  const created = new BrowserWindow({
    ...bounds,
    useContentSize: true,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    focusable: false,
    skipTaskbar: true,
    title: 'MIKO tree',
    webPreferences: {
      preload: join(__dirname, '../preload/tree.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      spellcheck: false
    }
  })
  tree = created
  created.setIgnoreMouseEvents(true)
  created.setAlwaysOnTop(true, 'floating')
  created.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  if (process.platform === 'darwin') {
    created.setHiddenInMissionControl(true)
    created.setWindowButtonVisibility(false)
  }
  created.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  created.webContents.on('will-navigate', (event) => event.preventDefault())
  created.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
  created.on('closed', () => {
    if (tree === created) tree = null
  })
  created.webContents.once('did-finish-load', () => {
    treeReady = true
    syncTree()
  })
  const devServer = !app.isPackaged ? process.env['ELECTRON_RENDERER_URL'] : undefined
  if (devServer) void created.loadURL(`${devServer}/tree.html`)
  else void created.loadFile(join(__dirname, '../renderer/tree.html'))
  return created
}

export function closeTree(): void {
  if (tree && !tree.isDestroyed()) tree.destroy()
  tree = null
}
