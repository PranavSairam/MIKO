import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  EDGE_MARGIN,
  PANEL,
  PET_WINDOW,
  MAIL_PANEL,
  choosePanelSide,
  fitMailPanel,
  layoutWindow,
  placeInitially
} from './layout.ts'

const desktop: { x: number; y: number; width: number; height: number } = {
  x: 0,
  y: 0,
  width: 1440,
  height: 900
}

describe('placeInitially', () => {
  it('sits the pet in the bottom-right of the work area, above the taskbar', () => {
    const placed = placeInitially(desktop)
    assert.equal(placed.bounds.width, PET_WINDOW.width)
    assert.equal(placed.bounds.height, PET_WINDOW.height)
    assert.equal(placed.bounds.x, desktop.width - PET_WINDOW.width - EDGE_MARGIN)
    assert.equal(placed.bounds.y, desktop.height - PET_WINDOW.height - EDGE_MARGIN)
    assert.deepEqual(placed.pet, { x: placed.bounds.x, y: placed.bounds.y })
  })

  it('clamps onto a work area smaller than the pet', () => {
    const tiny = { x: 10, y: 20, width: 180, height: 160 }
    const placed = placeInitially(tiny)
    assert.equal(placed.bounds.x, tiny.x)
    assert.equal(placed.bounds.y, tiny.y)
    assert.ok(Number.isFinite(placed.pet.x))
    assert.ok(Number.isFinite(placed.pet.y))
  })
})

describe('panel placement', () => {
  it('opens to the left from the bottom-right and keeps the pet still', () => {
    const placed = placeInitially(desktop)
    const opened = layoutWindow(placed.pet, true, desktop, choosePanelSide(placed.pet, desktop))
    assert.equal(opened.panelSide, 'left')
    assert.equal(opened.pet.x, placed.pet.x)
    assert.equal(opened.pet.y, placed.pet.y)
    assert.equal(opened.bounds.x, placed.pet.x - PANEL.width - PANEL.gap)
    assert.equal(opened.bounds.width, PET_WINDOW.width + PANEL.gap + PANEL.width)
    assert.ok(opened.bounds.x >= desktop.x)
    assert.ok(opened.bounds.x + opened.bounds.width <= desktop.x + desktop.width)
    assert.ok(opened.bounds.y >= desktop.y)
    assert.ok(opened.bounds.y + opened.bounds.height <= desktop.y + desktop.height)
  })

  it('opens to the right when the pet is against the left edge', () => {
    const pet = { x: desktop.x + EDGE_MARGIN, y: 400 }
    const opened = layoutWindow(pet, true, desktop, choosePanelSide(pet, desktop))
    assert.equal(opened.panelSide, 'right')
    assert.equal(opened.pet.x, pet.x)
    assert.equal(opened.pet.y, pet.y)
    assert.equal(opened.bounds.x, pet.x)
    assert.ok(opened.bounds.x + opened.bounds.width <= desktop.width)
  })

  it('keeps the current side while dragging when both sides fit', () => {
    const pet = { x: 500, y: 300 }
    const stayed = layoutWindow(pet, true, desktop, 'right')
    assert.equal(stayed.panelSide, 'right')
    assert.equal(stayed.pet.x, pet.x)
    assert.equal(stayed.bounds.x, pet.x)
  })

  it('flips the panel when the preferred side no longer fits', () => {
    const pet = { x: EDGE_MARGIN, y: 300 }
    const flipped = layoutWindow(pet, true, desktop, 'left')
    assert.equal(flipped.panelSide, 'right')
    assert.equal(flipped.pet.x, pet.x)
  })
})

describe('dragging', () => {
  it('keeps the pet inside the work area', () => {
    const dragged = layoutWindow(
      { x: desktop.width + 80, y: desktop.height + 80 },
      false,
      desktop,
      'left'
    )
    assert.equal(dragged.bounds.x, desktop.width - PET_WINDOW.width)
    assert.equal(dragged.bounds.y, desktop.height - PET_WINDOW.height)
    assert.deepEqual(dragged.pet, { x: dragged.bounds.x, y: dragged.bounds.y })
  })

  it('clamps into a display whose origin is negative', () => {
    const leftMonitor = { x: -1920, y: 0, width: 1920, height: 1080 }
    const dragged = layoutWindow({ x: -4000, y: -80 }, false, leftMonitor, 'left')
    assert.equal(dragged.bounds.x, leftMonitor.x)
    assert.equal(dragged.bounds.y, leftMonitor.y)
    assert.equal(dragged.pet.x, leftMonitor.x)
    assert.equal(dragged.pet.y, leftMonitor.y)
  })

  it('moves the pet with the window when the open panel still fits', () => {
    const start = layoutWindow({ x: 600, y: 400 }, true, desktop, 'left')
    const next = layoutWindow(
      { x: start.pet.x + 24, y: start.pet.y - 10 },
      true,
      desktop,
      start.panelSide
    )
    assert.equal(next.panelSide, 'left')
    assert.equal(next.pet.x, start.pet.x + 24)
    assert.equal(next.pet.y, start.pet.y - 10)
    assert.equal(next.bounds.x, next.pet.x - PANEL.width - PANEL.gap)
  })
})

describe('mail panel size', () => {
  const inside = (r: { x: number; y: number; width: number; height: number }, w: typeof desktop): boolean =>
    r.x >= w.x && r.y >= w.y && r.x + r.width <= w.x + w.width && r.y + r.height <= w.y + w.height

  it('uses about 700x520 where it fits, keeping the dog beside it', () => {
    const placed = placeInitially(desktop)
    const size = fitMailPanel(placed.pet, desktop)
    assert.deepEqual({ width: size.width, height: size.height }, { width: MAIL_PANEL.width, height: MAIL_PANEL.height })
    const opened = layoutWindow(placed.pet, true, desktop, choosePanelSide(placed.pet, desktop, size), size)
    assert.equal(opened.bounds.width, PET_WINDOW.width + size.gap + size.width)
    assert.equal(opened.bounds.height, size.height)
    assert.ok(inside(opened.bounds, desktop))
    const petRect = { ...opened.pet, width: PET_WINDOW.width, height: PET_WINDOW.height }
    assert.ok(inside(petRect, desktop), 'dog stays on screen')
  })

  it('shrinks to the space beside the dog on a small screen', () => {
    const small = { x: 0, y: 0, width: 800, height: 480 }
    const placed = placeInitially(small)
    const size = fitMailPanel(placed.pet, small)
    assert.ok(size.width < MAIL_PANEL.width && size.width >= 360)
    assert.ok(size.height <= small.height - 2 * EDGE_MARGIN && size.height >= 300)
    const opened = layoutWindow(placed.pet, true, small, choosePanelSide(placed.pet, small, size), size)
    assert.ok(inside(opened.bounds, small))
    assert.ok(inside({ ...opened.pet, width: PET_WINDOW.width, height: PET_WINDOW.height }, small))
  })

  it('keeps the chat panel size unchanged by default', () => {
    const placed = placeInitially(desktop)
    const opened = layoutWindow(placed.pet, true, desktop, 'left')
    assert.equal(opened.bounds.width, PET_WINDOW.width + PANEL.gap + PANEL.width)
  })
})
