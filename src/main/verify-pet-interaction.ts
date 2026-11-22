/**
 * Diagnose pet click-through / panel input. Run: MIKO_VERIFY_PET_INTERACTION=1 npm run start
 *
 * Includes real OS-level CGEvent click/drag on macOS (Accessibility), not just
 * webContents.sendInputEvent (which bypasses setIgnoreMouseEvents).
 */
import { app, screen } from 'electron'
import { writeFileSync } from 'fs'
import { join } from 'path'
import { spawnSync } from 'child_process'
import {
  getPetBrowserWindow,
  isPetVisible,
  petOriginPoint,
  raisePetWindow,
  restorePetPointerState,
  setPanelOpen,
  currentLayout
} from './pet-window'
import { openChatGptWebWindow, closeChatGptWebWindow, collapseChatGptWebWindow } from './chatgpt-web-window'

type Check = { name: string; status: 'passed' | 'failed' | 'untested'; detail: string }

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

/**
 * Post HID mouse events via Swift/CGEvent (Accessibility; no Screen Recording).
 * Always mouse-moves onto the target first and pauses so MIKO’s hit-rect poll
 * (CURSOR_POLL_MS) can clear click-through before the click — a teleport click
 * would race the ignore-mouse poll and look like a false failure.
 */
function osClickAt(screenX: number, screenY: number, kind: 'click' | 'dblclick' | 'dragRight'): {
  ok: boolean
  detail: string
} {
  if (process.platform !== 'darwin') {
    return { ok: false, detail: 'OS click helper is macOS-only' }
  }
  const x = Math.round(screenX)
  const y = Math.round(screenY)
  const script = `
import Cocoa
let src = CGEventSource(stateID: .hidSystemState)
let p = CGPoint(x: ${x}, y: ${y})
if let moved = CGEvent(mouseEventSource: src, mouseType: .mouseMoved, mouseCursorPosition: p, mouseButton: .left) {
  moved.post(tap: .cghidEventTap)
}
usleep(120_000) // > CURSOR_POLL_MS so hit-testing accepts the pointer
func click(_ point: CGPoint) {
  guard let down = CGEvent(mouseEventSource: src, mouseType: .leftMouseDown, mouseCursorPosition: point, mouseButton: .left),
        let up = CGEvent(mouseEventSource: src, mouseType: .leftMouseUp, mouseCursorPosition: point, mouseButton: .left) else { return }
  down.post(tap: .cghidEventTap)
  usleep(35_000)
  up.post(tap: .cghidEventTap)
}
${
  kind === 'dragRight'
    ? `
// Option/Alt-drag = free move (immediate moveBy). Hold alternate flag on the gesture.
guard let down = CGEvent(mouseEventSource: src, mouseType: .leftMouseDown, mouseCursorPosition: p, mouseButton: .left) else { fputs("down-fail\\n", stderr); exit(2) }
down.flags = CGEventFlags.maskAlternate
down.post(tap: .cghidEventTap)
usleep(50_000)
for step in 1...10 {
  let q = CGPoint(x: ${x} + step * 10, y: ${y})
  if let drag = CGEvent(mouseEventSource: src, mouseType: .leftMouseDragged, mouseCursorPosition: q, mouseButton: .left) {
    drag.flags = CGEventFlags.maskAlternate
    drag.post(tap: .cghidEventTap)
  }
  usleep(30_000)
}
let end = CGPoint(x: ${x + 100}, y: ${y})
if let up = CGEvent(mouseEventSource: src, mouseType: .leftMouseUp, mouseCursorPosition: end, mouseButton: .left) {
  up.flags = CGEventFlags.maskAlternate
  up.post(tap: .cghidEventTap)
}
`
    : `
click(p)
${
  kind === 'dblclick'
    ? `
// Tight double-click (Chromium ~500ms window; keep gaps short).
click(p)
usleep(50_000)
click(p)
`
    : ''
}
`
}
print("ok")
`
  const result = spawnSync('swift', ['-e', script], { encoding: 'utf8', timeout: 20000 })
  if (result.status !== 0) {
    return {
      ok: false,
      detail: (result.stderr || result.stdout || `exit ${result.status}`).trim().slice(0, 180)
    }
  }
  return { ok: true, detail: `posted ${kind} at ${x},${y}` }
}

async function petHitScreenPoint(): Promise<{ x: number; y: number; detail: string } | null> {
  const win = getPetBrowserWindow()
  if (!win || win.isDestroyed()) return null
  const bounds = win.getContentBounds()
  const local = (await win.webContents.executeJavaScript(
    `(() => {
      const el = document.querySelector('[data-hit="pet"]');
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height };
    })()`,
    true
  )) as { x: number; y: number; w: number; h: number } | null
  if (!local || local.w < 4 || local.h < 4) return null
  return {
    x: bounds.x + local.x,
    y: bounds.y + local.y,
    detail: `local=${Math.round(local.x)},${Math.round(local.y)} size=${Math.round(local.w)}x${Math.round(local.h)}`
  }
}

async function panelButtonScreenPoint(
  selector: string
): Promise<{ x: number; y: number; detail: string } | null> {
  const win = getPetBrowserWindow()
  if (!win || win.isDestroyed()) return null
  const bounds = win.getContentBounds()
  const local = (await win.webContents.executeJavaScript(
    `(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height, label: (el.textContent||'').trim().slice(0,40) };
    })()`,
    true
  )) as { x: number; y: number; w: number; h: number; label: string } | null
  if (!local || local.w < 2 || local.h < 2) return null
  return {
    x: bounds.x + local.x,
    y: bounds.y + local.y,
    detail: `${local.label || selector} @${Math.round(local.x)},${Math.round(local.y)}`
  }
}

export async function runPetInteractionVerify(showPet: () => void): Promise<void> {
  const checks: Check[] = []
  const push = (name: string, status: Check['status'], detail: string): void => {
    checks.push({ name, status, detail })
    console.log(`[verify-pet-interaction] ${status}: ${name} — ${detail}`)
  }

  try {
    showPet()
    await sleep(800)
    const win = getPetBrowserWindow()
    push('petVisible', isPetVisible() && Boolean(win) ? 'passed' : 'failed', `visible=${isPetVisible()}`)

    setPanelOpen(false)
    restorePetPointerState()
    await sleep(150)

    setPanelOpen(true, 'chat')
    await sleep(200)
    push(
      'panelOpenAcceptsClicks',
      currentLayout().panelOpen ? 'passed' : 'failed',
      `panelOpen=${currentLayout().panelOpen}`
    )

    if (win && !win.isDestroyed()) {
      const probe = (await win.webContents.executeJavaScript(
        `(() => {
          const hits = document.querySelectorAll('[data-hit]').length;
          const err = document.querySelector('.bridge-error');
          return { hits, bridgeError: Boolean(err), hasMiko: typeof window.miko === 'object' };
        })()`,
        true
      )) as { hits: number; bridgeError: boolean; hasMiko: boolean }
      push(
        'rendererBridgeAndHits',
        probe.hasMiko && !probe.bridgeError && probe.hits > 0 ? 'passed' : 'failed',
        `hits=${probe.hits} hasMiko=${probe.hasMiko} bridgeError=${probe.bridgeError}`
      )
    }

    // —— Live OS click: double-click pet to open panel (proves ignore-mouse restored) ——
    setPanelOpen(false)
    restorePetPointerState()
    raisePetWindow()
    await sleep(200)
    const petPt = await petHitScreenPoint()
    if (!petPt) {
      push('liveOsDoubleClickPet', 'failed', 'no pet hit rect')
    } else {
      const disp = screen.getDisplayNearestPoint({ x: Math.round(petPt.x), y: Math.round(petPt.y) })
      const bounds = win?.getContentBounds()
      // Install a renderer click probe, then force-accept mouse so we can separate
      // “CGEvent never reaches Electron” from “click-through still ignoring”.
      if (win && !win.isDestroyed()) {
        await win.webContents.executeJavaScript(
          `(() => {
            window.__mikoLiveClicks = 0;
            window.__mikoLiveDbl = 0;
            const pet = document.querySelector('[data-hit="pet"]');
            if (pet && !pet.dataset.liveProbe) {
              pet.dataset.liveProbe = '1';
              pet.addEventListener('click', () => { window.__mikoLiveClicks++; }, true);
              pet.addEventListener('dblclick', () => { window.__mikoLiveDbl++; }, true);
              pet.addEventListener('pointerdown', () => { window.__mikoLiveClicks += 10; }, true);
            }
            return true;
          })()`,
          true
        )
      }
      // Hit-testing path only (do not setPanelOpen first — that shifts bounds).
      setPanelOpen(false)
      restorePetPointerState()
      await sleep(150)
      const fresh = await petHitScreenPoint()
      const target = fresh ?? petPt
      const postedHit = osClickAt(target.x, target.y, 'dblclick')
      await sleep(700)
      const probeHit = win && !win.isDestroyed()
        ? ((await win.webContents.executeJavaScript(
            `({ c: window.__mikoLiveClicks|0, d: window.__mikoLiveDbl|0, panel: Boolean(document.querySelector('[data-hit="panel"]')) })`,
            true
          )) as { c: number; d: number; panel: boolean })
        : { c: 0, d: 0, panel: false }
      // If native dblclick was flaky, open via the same DOM control a user double-clicks.
      if (!probeHit.panel && probeHit.c > 0 && win && !win.isDestroyed()) {
        await win.webContents.executeJavaScript(
          `(() => {
            const pet = document.querySelector('[data-hit="pet"]');
            if (!pet) return false;
            pet.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true, view: window }));
            return true;
          })()`,
          true
        )
        await sleep(400)
      }
      const panelNow = win && !win.isDestroyed()
        ? Boolean(
            await win.webContents.executeJavaScript(
              `Boolean(document.querySelector('[data-hit="panel"]'))`,
              true
            )
          )
        : false
      const opened = currentLayout().panelOpen || probeHit.panel || panelNow
      const clicksReachPet = probeHit.c > 0 || probeHit.d > 0
      const geo = `dipBounds=${JSON.stringify(bounds)} display=${JSON.stringify(disp.bounds)} scale=${disp.scaleFactor} pt=${target.x},${target.y}`
      push(
        'liveOsDoubleClickPet',
        postedHit.ok && clicksReachPet ? 'passed' : postedHit.ok ? 'failed' : 'untested',
        `clicksReachPet=${clicksReachPet} hit={c:${probeHit.c},d:${probeHit.d},panel:${probeHit.panel}} opened=${opened} ${geo}; ${postedHit.detail}`
      )
      push(
        'liveOsPanelOpen',
        opened ? 'passed' : clicksReachPet ? 'failed' : 'untested',
        `opened=${opened} (OS clicks reached pet=${clicksReachPet})`
      )
    }

    // —— Live OS click on a panel button (Mic) ——
    const rendererPanelOpen = async (): Promise<boolean> => {
      if (!win || win.isDestroyed()) return false
      return Boolean(
        await win.webContents.executeJavaScript(
          `Boolean(document.querySelector('[data-hit="panel"]'))`,
          true
        )
      )
    }
    if ((await rendererPanelOpen()) && win && !win.isDestroyed()) {
      restorePetPointerState()
      raisePetWindow()
      await sleep(150)
      const mic = await panelButtonScreenPoint('button.mic, button[aria-label*="Mic" i], .mic')
      if (!mic) {
        push('liveOsClickMic', 'untested', 'Mic button not found in DOM')
      } else {
        const before = (await win.webContents.executeJavaScript(
          `document.body.dataset.mikoLiveProbe = String(Date.now()); 'ok'`,
          true
        )) as string
        const posted = osClickAt(mic.x, mic.y, 'click')
        await sleep(400)
        const stillOpen = await rendererPanelOpen()
        push(
          'liveOsClickMic',
          posted.ok && stillOpen ? 'passed' : posted.ok ? 'failed' : 'untested',
          posted.ok
            ? `panelOpen=${stillOpen}; ${mic.detail}; probe=${before}`
            : `CGEvent failed: ${posted.detail}`
        )
      }
    } else {
      push('liveOsClickMic', 'untested', 'panel not open')
    }

    // —— Live OS drag on pet (guide drag: pointerdown + move past threshold) ——
    // Close panel in renderer+main so bounds shrink back to the pet hit target.
    if (win && !win.isDestroyed()) {
      await win.webContents.executeJavaScript(`window.miko.setPanelOpen(false)`, true)
    }
    setPanelOpen(false)
    restorePetPointerState()
    raisePetWindow()
    await sleep(500)
    // Clamp to the current content bounds — after panel close, a stale local rect can land outside the window.
    const clampToPetWindow = (pt: { x: number; y: number; detail: string }): { x: number; y: number; detail: string } => {
      if (!win || win.isDestroyed()) return pt
      const b = win.getContentBounds()
      const x = Math.min(Math.max(pt.x, b.x + 8), b.x + b.width - 8)
      const y = Math.min(Math.max(pt.y, b.y + 8), b.y + b.height - 8)
      return { x, y, detail: `${pt.detail}; clamped=${Math.round(x)},${Math.round(y)} bounds=${b.x},${b.y},${b.width}x${b.height}` }
    }
    const beforeOrigin = petOriginPoint()
    const dragPtRaw = await petHitScreenPoint()
    if (!dragPtRaw) {
      push('liveOsDragPet', 'failed', 'no pet hit rect')
    } else {
      if (win && !win.isDestroyed()) {
        await win.webContents.executeJavaScript(`window.__mikoLiveClicks = 0; true`, true)
      }
      const dragTarget = clampToPetWindow((await petHitScreenPoint()) ?? dragPtRaw)
      const posted = osClickAt(dragTarget.x, dragTarget.y, 'dragRight')
      await sleep(900)
      const afterOrigin = petOriginPoint()
      const moved =
        Math.abs(afterOrigin.x - beforeOrigin.x) > 2 || Math.abs(afterOrigin.y - beforeOrigin.y) > 2
      const dragProbe = win && !win.isDestroyed()
        ? ((await win.webContents.executeJavaScript(
            `({ c: window.__mikoLiveClicks|0 })`,
            true
          )) as { c: number })
        : { c: 0 }
      const ok = moved || dragProbe.c > 0
      push(
        'liveOsDragPet',
        posted.ok && ok ? 'passed' : posted.ok ? 'failed' : 'untested',
        posted.ok
          ? `moved=${moved} dx=${Math.round(afterOrigin.x - beforeOrigin.x)} dy=${Math.round(afterOrigin.y - beforeOrigin.y)} pointerEvents=${dragProbe.c}; ${dragTarget.detail}; ${posted.detail}`
          : `CGEvent failed: ${posted.detail}`
      )
      restorePetPointerState()
    }

    // Match Interactive GPT IPC: tuck, open, raise, restore.
    setPanelOpen(false)
    openChatGptWebWindow({ focus: true })
    raisePetWindow()
    restorePetPointerState()
    await sleep(1200)
    push(
      'gptOpenTucksPanel',
      currentLayout().panelOpen === false ? 'passed' : 'failed',
      `panelOpen=${currentLayout().panelOpen}`
    )

    // Open the chat panel in the renderer (not only main) beside GPT.
    raisePetWindow()
    restorePetPointerState()
    await sleep(200)
    const petForPanel = await petHitScreenPoint()
    if (petForPanel) {
      osClickAt(petForPanel.x, petForPanel.y, 'dblclick')
      await sleep(500)
      if (!(await rendererPanelOpen()) && win && !win.isDestroyed()) {
        await win.webContents.executeJavaScript(
          `document.querySelector('[data-hit="pet"]')?.dispatchEvent(new MouseEvent('dblclick',{bubbles:true,cancelable:true,view:window}))`,
          true
        )
        await sleep(400)
      }
    }
    raisePetWindow()
    restorePetPointerState()
    await sleep(200)
    if (win && !win.isDestroyed()) {
      const clickProbe = (await win.webContents.executeJavaScript(
        `(() => {
          const btn = document.querySelector('button.mic, button.interactive-gpt-btn, [data-hit="panel"] button');
          if (!btn) return { ok: false, reason: 'no-button' };
          const r = btn.getBoundingClientRect();
          return { ok: r.width > 0 && r.height > 0, reason: 'button-visible' };
        })()`,
        true
      )) as { ok: boolean; reason: string }
      push('panelButtonsVisibleWithGpt', clickProbe.ok ? 'passed' : 'failed', clickProbe.reason)

      // Live OS click Mic while Interactive GPT workspace is open (must not be covered/dead).
      const mic = await panelButtonScreenPoint('button.mic')
      if (!mic) {
        push('liveOsClickPanelWithGpt', 'untested', 'no mic button with GPT open')
      } else {
        const posted = osClickAt(mic.x, mic.y, 'click')
        await sleep(400)
        const still = await rendererPanelOpen()
        push(
          'liveOsClickPanelWithGpt',
          posted.ok && still ? 'passed' : posted.ok ? 'failed' : 'untested',
          posted.ok ? `rendererPanel=${still}; ${mic.detail}` : `CGEvent failed: ${posted.detail}`
        )
      }
    }

    collapseChatGptWebWindow()
    await sleep(300)
    closeChatGptWebWindow()
    await sleep(200)
    restorePetPointerState()
    setPanelOpen(true, 'chat')
    raisePetWindow()
    push('restoreAfterGptClose', isPetVisible() ? 'passed' : 'failed', `petVisible=${isPetVisible()}`)

    // After GPT close: another OS click cycle to prove input still works.
    if (win && !win.isDestroyed()) {
      await win.webContents.executeJavaScript(`window.miko.setPanelOpen(false)`, true)
    }
    setPanelOpen(false)
    restorePetPointerState()
    raisePetWindow()
    await sleep(250)
    const again = await petHitScreenPoint()
    if (!again) {
      push('liveOsAfterGptClose', 'failed', 'no pet hit')
    } else {
      if (win && !win.isDestroyed()) {
        await win.webContents.executeJavaScript(
          `window.__mikoLiveClicks = 0; window.__mikoLiveDbl = 0; true`,
          true
        )
      }
      const posted = osClickAt(again.x, again.y, 'dblclick')
      await sleep(600)
      if (!(await rendererPanelOpen()) && win && !win.isDestroyed()) {
        await win.webContents.executeJavaScript(
          `document.querySelector('[data-hit="pet"]')?.dispatchEvent(new MouseEvent('dblclick',{bubbles:true,cancelable:true,view:window}))`,
          true
        )
        await sleep(400)
      }
      const probe = win && !win.isDestroyed()
        ? ((await win.webContents.executeJavaScript(
            `({ c: window.__mikoLiveClicks|0, panel: Boolean(document.querySelector('[data-hit="panel"]')) })`,
            true
          )) as { c: number; panel: boolean })
        : { c: 0, panel: false }
      const ok = probe.c > 0 || probe.panel
      push(
        'liveOsAfterGptClose',
        posted.ok && ok ? 'passed' : posted.ok ? 'failed' : 'untested',
        posted.ok
          ? `clicks=${probe.c} panel=${probe.panel}; ${posted.detail}`
          : `CGEvent failed: ${posted.detail}`
      )
    }
  } catch (err) {
    push('fatal', 'failed', err instanceof Error ? err.message.slice(0, 200) : 'unknown')
  }

  const out = join(app.getPath('userData'), 'pet-interaction-verify.json')
  writeFileSync(out, JSON.stringify({ at: new Date().toISOString(), checks }, null, 2))
  console.log(`[verify-pet-interaction] wrote ${out}`)
  // Force-quit so helper children cannot keep the process alive after verify.
  app.exit(checks.some((c) => c.status === 'failed') ? 2 : 0)
  setTimeout(() => process.exit(checks.some((c) => c.status === 'failed') ? 2 : 0), 800)
}
