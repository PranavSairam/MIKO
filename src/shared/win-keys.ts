/**
 * Windows "MIKO Keys" helper protocol (resources/keys-win.ps1). Pure; used by main and tests.
 * Key events use the same JSON as the Mac helper ({"event":"talk-start"|"talk-stop"|"switcher"}).
 */
import { parseKeyEvent, type KeyEvent } from './keys.ts'

export interface WinWindow {
  hwnd: number
  pid: number
  title: string
  path: string
  name: string
  minimized: boolean
  active: boolean
}

export type WinKeysLine =
  | { type: 'event'; event: KeyEvent }
  | { type: 'ready' }
  | { type: 'error'; code: string; detail: string }
  | { type: 'reply'; id: number; windows?: WinWindow[]; ok?: boolean; error?: string }

export function parseWinKeysLine(line: string): WinKeysLine | null {
  let payload: unknown
  try {
    payload = JSON.parse(line.replace(/^﻿/, '').trim())
  } catch {
    return null
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null
  const record = payload as Record<string, unknown>
  if (Number.isInteger(record.id)) {
    const reply: { type: 'reply'; id: number; windows?: WinWindow[]; ok?: boolean; error?: string } = {
      type: 'reply',
      id: record.id as number
    }
    if (Array.isArray(record.windows)) reply.windows = record.windows.map(parseWindow).filter((w): w is WinWindow => w !== null)
    if (typeof record.ok === 'boolean') reply.ok = record.ok
    if (typeof record.error === 'string') reply.error = record.error.slice(0, 300)
    return reply
  }
  if (record.ready === true) return { type: 'ready' }
  if (typeof record.event === 'string') {
    const event = parseKeyEvent(JSON.stringify({ event: record.event }))
    return event ? { type: 'event', event } : null
  }
  if (typeof record.error === 'string') {
    return { type: 'error', code: record.error.slice(0, 40), detail: typeof record.detail === 'string' ? record.detail.slice(0, 300) : '' }
  }
  return null
}

function parseWindow(value: unknown): WinWindow | null {
  if (!value || typeof value !== 'object') return null
  const w = value as Record<string, unknown>
  if (typeof w.hwnd !== 'number' || !Number.isSafeInteger(w.hwnd) || w.hwnd <= 0) return null
  if (!Number.isInteger(w.pid) || (w.pid as number) <= 0) return null
  const text = (v: unknown, max: number): string => (typeof v === 'string' ? v.slice(0, max) : '')
  const title = text(w.title, 200)
  const name = text(w.name, 80).trim() || title.slice(0, 80)
  if (!name) return null
  return {
    hwnd: w.hwnd,
    pid: w.pid as number,
    title,
    path: text(w.path, 1024),
    name,
    minimized: w.minimized === true,
    active: w.active === true
  }
}

export interface WinSwitcherEntry {
  pid: number
  name: string
  path: string
  /** Front-most window of this app (focus target). */
  hwnd: number
  /** Every listed window of this app (close targets). */
  hwnds: number[]
  minimized: boolean
  active: boolean
}

/**
 * One switcher card per app, in front-to-back order (EnumWindows order), skipping MIKO
 * itself and Windows shell surfaces that are not apps.
 */
export function groupWindows(windows: WinWindow[], skipPaths: string[] = []): WinSwitcherEntry[] {
  const skip = new Set(skipPaths.filter(Boolean).map((p) => p.toLowerCase()))
  const byPid = new Map<number, WinSwitcherEntry>()
  const order: WinSwitcherEntry[] = []
  for (const w of windows) {
    if (skip.has(w.path.toLowerCase())) continue
    if (isShellSurface(w)) continue
    const existing = byPid.get(w.pid)
    if (existing) {
      existing.hwnds.push(w.hwnd)
      existing.active = existing.active || w.active
      existing.minimized = existing.minimized && w.minimized
      continue
    }
    const entry: WinSwitcherEntry = {
      pid: w.pid,
      name: w.name,
      path: w.path,
      hwnd: w.hwnd,
      hwnds: [w.hwnd],
      minimized: w.minimized,
      active: w.active
    }
    byPid.set(w.pid, entry)
    order.push(entry)
  }
  return order
}

function isShellSurface(w: WinWindow): boolean {
  const exe = w.path.split(/[\\/]/).pop()?.toLowerCase() ?? ''
  if (exe === 'explorer.exe' && /^(?:program manager|)$/i.test(w.title)) return true
  if (exe === 'textinputhost.exe' || exe === 'shellexperiencehost.exe' || exe === 'searchhost.exe' || exe === 'startmenuexperiencehost.exe') {
    return true
  }
  return /^(?:program manager|windows input experience)$/i.test(w.title)
}
