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

/** Panel dimensions in DIP. Chat uses PANEL; Mail asks for MAIL_PANEL and is fitted to the work area. */
export interface PanelSize {
  width: number
  height: number
  gap: number
}

export const MAIL_PANEL: PanelSize = { width: 700, height: 520, gap: 12 }
const MAIL_MIN = { width: 360, height: 300 }

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

function contentSize(panelOpen: boolean, panel: PanelSize = PANEL): { width: number; height: number } {
  if (!panelOpen) {
    return { width: PET_WINDOW.width, height: PET_WINDOW.height }
  }
  return {
    width: PET_WINDOW.width + panel.gap + panel.width,
    height: Math.max(PET_WINDOW.height, panel.height)
  }
}

/** Pet canvas origin inside the window. A left-side panel pushes the dog right; a tall panel centres it vertically. */
export function petViewportOffset(panelOpen: boolean, panelSide: 'left' | 'right', panel: PanelSize = PANEL): Point {
  if (!panelOpen) return { x: 0, y: 0 }
  const size = contentSize(true, panel)
  return {
    x: panelSide === 'left' ? panel.width + panel.gap : 0,
    y: Math.round((size.height - PET_WINDOW.height) / 2)
  }
}

/**
 * Mail panel size for this spot: up to MAIL_PANEL, shrunk to the wider free side
 * beside the dog and to the work area height. Never below MAIL_MIN (the window clamp
 * then shifts the dog so both stay on screen).
 */
export function fitMailPanel(pet: Point, work: Rect): PanelSize {
  const spaceLeft = pet.x - work.x
  const spaceRight = work.x + work.width - (pet.x + PET_WINDOW.width)
  const side = Math.max(spaceLeft, spaceRight) - MAIL_PANEL.gap
  const widest = work.width - PET_WINDOW.width - MAIL_PANEL.gap
  const width = Math.round(clamp(Math.min(MAIL_PANEL.width, Math.max(side, MAIL_MIN.width)), MAIL_MIN.width, Math.max(MAIL_MIN.width, widest)))
  const height = Math.round(clamp(MAIL_PANEL.height, Math.min(MAIL_MIN.height, work.height), Math.max(MAIL_MIN.height, work.height - 2 * EDGE_MARGIN)))
  return { width: Math.min(width, MAIL_PANEL.width), height: Math.min(height, work.height), gap: MAIL_PANEL.gap }
}

function spaces(pet: Point, work: Rect, panel: PanelSize = PANEL): {
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
    leftFits: spaceLeft >= panel.width + panel.gap,
    rightFits: spaceRight >= panel.width + panel.gap
  }
}

export function choosePanelSide(pet: Point, work: Rect, panel: PanelSize = PANEL): 'left' | 'right' {
  const { leftFits, rightFits, spaceLeft, spaceRight } = spaces(pet, work, panel)
  if (leftFits && !rightFits) return 'left'
  if (rightFits && !leftFits) return 'right'
  return spaceRight > spaceLeft ? 'right' : 'left'
}

export function resolvePanelSide(
  pet: Point,
  work: Rect,
  preferred: 'left' | 'right',
  panel: PanelSize = PANEL
): 'left' | 'right' {
  const { leftFits, rightFits } = spaces(pet, work, panel)
  if (preferred === 'left' && leftFits) return 'left'
  if (preferred === 'right' && rightFits) return 'right'
  return choosePanelSide(pet, work, panel)
}

export function boundsFromPet(
  pet: Point,
  panelOpen: boolean,
  panelSide: 'left' | 'right',
  panel: PanelSize = PANEL
): Rect {
  const size = contentSize(panelOpen, panel)
  const offset = petViewportOffset(panelOpen, panelSide, panel)
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
  panelSide: 'left' | 'right',
  panel: PanelSize = PANEL
): Point {
  const offset = petViewportOffset(panelOpen, panelSide, panel)
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
  preferredSide: 'left' | 'right',
  panel: PanelSize = PANEL
): Layout {
  const panelSide = panelOpen ? resolvePanelSide(pet, work, preferredSide, panel) : preferredSide
  const clamped = clampBounds(boundsFromPet(pet, panelOpen, panelSide, panel), work)
  return {
    pet: petFromBounds(clamped, panelOpen, panelSide, panel),
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
