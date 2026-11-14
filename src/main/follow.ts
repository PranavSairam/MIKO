import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app, screen } from 'electron'
import { IPC } from '../shared/api'
import { FOLLOW_SETTLE_MS, perchPoint, settleKey, type SettleState } from '../shared/follow'
import { PET_WINDOW, type Point } from '../shared/layout'
import { readForeground } from './foreground'
import { followBlocked, isPetVisible, petOriginPoint, placePet, postToPet, reducedMotionEnabled } from './pet-window'

let enabled = false
let timer: NodeJS.Timeout | null = null
let settle: SettleState | null = null
let lastActed = ''
let wasBlocked = false
let polling = false
const yieldedFullscreen = new Set<string>()

export function isFollowEnabled(): boolean {
  return enabled
}

export function restoreFollow(): void {
  enabled = readSaved()
}

export async function enableFollow(next: boolean): Promise<{ ok: boolean; reason: string }> {
  if (!next) {
    enabled = false
    settle = null
    lastActed = ''
    writeSaved(false)
    return { ok: true, reason: '' }
  }
  const probe = readForeground(process.pid)
  if (!probe.ok) return { ok: false, reason: probe.permission }
  enabled = true
  settle = null
  lastActed = ''
  writeSaved(true)
  return { ok: true, reason: '' }
}

function readSaved(): boolean {
  try {
    const parsed: unknown = JSON.parse(readFileSync(join(app.getPath('userData'), 'follow.json'), 'utf8'))
    return !!parsed && typeof parsed === 'object' && (parsed as { enabled?: unknown }).enabled === true
  } catch {
    return false
  }
}

function writeSaved(next: boolean): void {
  try {
    writeFileSync(join(app.getPath('userData'), 'follow.json'), JSON.stringify({ enabled: next }))
  } catch {
    // The toggle still applies for this session.
  }
}

export function startFollowLoop(): void {
  if (timer) return
  timer = setInterval(() => {
    if (!enabled || polling) return
    polling = true
    try {
      tick(false)
    } finally {
      polling = false
    }
  }, 700)
}

export function comeToFront(): { ok: boolean; reason: string; paused: boolean } {
  const probe = readForeground(process.pid)
  if (!probe.ok) return { ok: false, reason: probe.permission, paused: false }
  if (!probe.window) return { ok: false, reason: 'I can\u2019t see an active window.', paused: false }
  if (followBlocked() || !isPetVisible()) return { ok: true, reason: '', paused: true }
  tick(true)
  return { ok: true, reason: '', paused: false }
}

function tick(once: boolean): void {
  if (!isPetVisible()) return
  const blocked = followBlocked()
  if (blocked) {
    wasBlocked = true
    return
  }
  if (wasBlocked) {
    wasBlocked = false
    lastActed = ''
  }
  const read = readForeground(process.pid)
  if (!read.ok || !read.window) return
  const front = read.window
  const key = `${front.pid}:${front.bounds.x},${front.bounds.y},${front.bounds.width},${front.bounds.height}:${front.fullscreen ? 1 : 0}`
  if (!once) {
    const settled = settleKey(settle, key, Date.now(), FOLLOW_SETTLE_MS)
    settle = settled.state
    if (!settled.ready) return
  }
  const pet = petOriginPoint()
  const appDisplay = screen.getDisplayMatching(front.bounds)
  const petDisplay = screen.getDisplayMatching({
    x: pet.x,
    y: pet.y,
    width: PET_WINDOW.width,
    height: PET_WINDOW.height
  })
  const dest = perchPoint(pet, front.bounds, appDisplay.workArea)
  const otherDisplay = appDisplay.id !== petDisplay.id
  if (front.fullscreen && otherDisplay) {
    if (!yieldedFullscreen.has(key)) yieldedFullscreen.add(key)
    return
  }
  if (key === lastActed && !once) return
  lastActed = key
  if (otherDisplay) {
    placePet(dest.x, dest.y, true)
    postToPet(IPC.follow, { kind: 'placed' })
    return
  }
  if (reducedMotionEnabled() || near(pet, dest)) {
    if (!near(pet, dest)) placePet(dest.x, dest.y, false)
    postToPet(IPC.follow, { kind: 'placed' })
    return
  }
  postToPet(IPC.follow, { kind: 'approach', x: dest.x, y: dest.y })
}

function near(pet: Point, dest: Point): boolean {
  return Math.hypot(pet.x - dest.x, pet.y - dest.y) < 12
}
