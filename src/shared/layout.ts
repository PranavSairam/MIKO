export const EDGE_MARGIN = 16

export const PET_WINDOW = {
  width: 220,
  height: 250
} as const

export const PANEL = {
  width: 272,
  height: 220,
  gap: 12
} as const

const PANEL_NEED = PANEL.width + PANEL.gap

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export interface Point {
  x: number
  y: number
}

export interface Layout {
  pet: Point
  bounds: Rect
  panelSide: 'left' | 'right'
}

export function clamp(value: number, min: number, max: number): number {
  if (max < min) return min
  return Math.min(max, Math.max(min, value))
}

function contentSize(panelOpen: boolean): { width: number; height: number } {
  if (!panelOpen) {
    return { width: PET_WINDOW.width, height: PET_WINDOW.height }
  }
  return {
    width: PET_WINDOW.width + PANEL.gap + PANEL.width,
    height: Math.max(PET_WINDOW.height, PANEL.height)
  }
}

/** Pet canvas origin inside the window. A left-side panel pushes the dog right. */
export function petViewportOffset(panelOpen: boolean, panelSide: 'left' | 'right'): Point {
  if (!panelOpen) return { x: 0, y: 0 }
  const size = contentSize(true)
  return {
    x: panelSide === 'left' ? PANEL.width + PANEL.gap : 0,
    y: Math.round((size.height - PET_WINDOW.height) / 2)
  }
}

function spaces(pet: Point, work: Rect): {
  spaceLeft: number
  spaceRight: number
  leftFits: boolean
  rightFits: boolean
} {
  const spaceLeft = pet.x - work.x
  const spaceRight = work.x + work.width - (pet.x + PET_WINDOW.width)
  return {
    spaceLeft,
    spaceRight,
    leftFits: spaceLeft >= PANEL_NEED,
    rightFits: spaceRight >= PANEL_NEED
  }
}

export function choosePanelSide(pet: Point, work: Rect): 'left' | 'right' {
  const { leftFits, rightFits, spaceLeft, spaceRight } = spaces(pet, work)
  if (leftFits && !rightFits) return 'left'
  if (rightFits && !leftFits) return 'right'
  return spaceRight > spaceLeft ? 'right' : 'left'
}

export function resolvePanelSide(
  pet: Point,
  work: Rect,
  preferred: 'left' | 'right'
): 'left' | 'right' {
  const { leftFits, rightFits } = spaces(pet, work)
  if (preferred === 'left' && leftFits) return 'left'
  if (preferred === 'right' && rightFits) return 'right'
  return choosePanelSide(pet, work)
}

export function boundsFromPet(
  pet: Point,
  panelOpen: boolean,
  panelSide: 'left' | 'right'
): Rect {
  const size = contentSize(panelOpen)
  const offset = petViewportOffset(panelOpen, panelSide)
  return {
    x: pet.x - offset.x,
    y: pet.y - offset.y,
    width: size.width,
    height: size.height
  }
}

export function petFromBounds(
  bounds: Rect,
  panelOpen: boolean,
  panelSide: 'left' | 'right'
): Point {
  const offset = petViewportOffset(panelOpen, panelSide)
  return { x: bounds.x + offset.x, y: bounds.y + offset.y }
}

export function clampBounds(bounds: Rect, work: Rect): Rect {
  return {
    x: clamp(bounds.x, work.x, work.x + work.width - bounds.width),
    y: clamp(bounds.y, work.y, work.y + work.height - bounds.height),
    width: bounds.width,
    height: bounds.height
  }
}

export function layoutWindow(
  pet: Point,
  panelOpen: boolean,
  work: Rect,
  preferredSide: 'left' | 'right'
): Layout {
  const panelSide = panelOpen ? resolvePanelSide(pet, work, preferredSide) : preferredSide
  const clamped = clampBounds(boundsFromPet(pet, panelOpen, panelSide), work)
  return {
    pet: petFromBounds(clamped, panelOpen, panelSide),
    bounds: {
      x: Math.round(clamped.x),
      y: Math.round(clamped.y),
      width: Math.round(clamped.width),
      height: Math.round(clamped.height)
    },
    panelSide
  }
}

export function placeInitially(work: Rect): Layout {
  return layoutWindow(
    {
      x: work.x + work.width - PET_WINDOW.width - EDGE_MARGIN,
      y: work.y + work.height - PET_WINDOW.height - EDGE_MARGIN
    },
    false,
    work,
    'left'
  )
}
