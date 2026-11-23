export const EDGE_MARGIN = 16

export const PET_WINDOW = {
  width: 220,
  height: 250
} as const

/** Default chat panel: room for a one-row header, a readable conversation and the composer. */
export const PANEL = {
  width: 420,
  height: 480,
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

/**
 * Pet canvas origin inside the window. A left-side panel pushes the dog right. A panel taller
 * than the pet grows upward from the pet's feet (the pet sits at the window's bottom), so the
 * pet doesn't jump when the panel opens near the bottom of the screen, where it usually lives.
 */
export function petViewportOffset(panelOpen: boolean, panelSide: 'left' | 'right', panel: PanelSize = PANEL): Point {
  if (!panelOpen) return { x: 0, y: 0 }
  const size = contentSize(true, panel)
  return {
    x: panelSide === 'left' ? panel.width + panel.gap : 0,
    y: Math.round(size.height - PET_WINDOW.height)
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

export type PanelKind = 'chat' | 'mail'
export type PanelPreset = 'small' | 'medium' | 'large'

/** Size choices per tab (DIP). Medium is the original size. */
export const PANEL_PRESETS: Record<PanelKind, Record<PanelPreset, { width: number; height: number }>> = {
  chat: { small: { width: 340, height: 360 }, medium: { width: 420, height: 480 }, large: { width: 600, height: 660 } },
  mail: { small: { width: 540, height: 420 }, medium: { width: 700, height: 520 }, large: { width: 960, height: 700 } }
}

export const PANEL_LIMITS: Record<PanelKind, { min: { width: number; height: number }; max: { width: number; height: number } }> = {
  chat: { min: { width: 300, height: 300 }, max: { width: 1000, height: 1000 } },
  mail: { min: { width: MAIL_MIN.width, height: MAIL_MIN.height }, max: { width: 1600, height: 1200 } }
}

/** A saved size, or null when the value isn't a usable size. */
export function parsePanelSize(kind: PanelKind, value: unknown): { width: number; height: number } | null {
  if (!value || typeof value !== 'object') return null
  const { width, height } = value as { width?: unknown; height?: unknown }
  if (typeof width !== 'number' || typeof height !== 'number' || !Number.isFinite(width) || !Number.isFinite(height)) return null
  const { min, max } = PANEL_LIMITS[kind]
  return { width: Math.round(clamp(width, min.width, max.width)), height: Math.round(clamp(height, min.height, max.height)) }
}

/**
 * Panel size for this spot. Without a chosen size: Chat uses PANEL and Mail
 * fits beside the dog (fitMailPanel). A chosen size is kept as asked, within
 * the tab's limits and the screen (the window clamp then moves the dog).
 */
export function fitPanel(kind: PanelKind, chosen: { width: number; height: number } | null, pet: Point, work: Rect): PanelSize {
  if (!chosen && kind === 'mail') return fitMailPanel(pet, work)
  const gap = kind === 'mail' ? MAIL_PANEL.gap : PANEL.gap
  const size = (chosen ? parsePanelSize(kind, chosen) : null) ?? (kind === 'chat' ? { width: PANEL.width, height: PANEL.height } : PANEL_PRESETS[kind].medium)
  const { min } = PANEL_LIMITS[kind]
  const widest = work.width - PET_WINDOW.width - gap
  const tallest = work.height - 2 * EDGE_MARGIN
  return {
    width: Math.round(clamp(size.width, Math.min(min.width, widest), Math.max(Math.min(min.width, widest), widest))),
    height: Math.round(clamp(size.height, Math.min(min.height, tallest), Math.max(Math.min(min.height, tallest), tallest))),
    gap
  }
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
