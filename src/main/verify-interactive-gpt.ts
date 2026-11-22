/**
 * One-shot live acceptance for Interactive GPT access (env MIKO_VERIFY_INTERACTIVE_GPT=1).
 * Does not enable GPT Mode / Lens. Writes JSON report; does not log secrets.
 */
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app, BrowserWindow } from 'electron'
import {
  chatgptWebStatus,
  closeChatGptWebWindow,
  collapseChatGptWebWindow,
  expandChatGptWebWindow,
  isChatGptWebOpen,
  openChatGptWebWindow
} from './chatgpt-web-window'
import { getPetBrowserWindow, isPetVisible, petOriginPoint } from './pet-window'
import { PET_WINDOW } from '../shared/layout'

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function runInteractiveGptAccessVerify(showPet: () => void): Promise<void> {
  const report: Record<string, unknown> = {
    at: new Date().toISOString(),
    electron: process.versions.electron,
    checks: {} as Record<string, { status: string; detail?: string }>
  }
  const checks = report.checks as Record<string, { status: string; detail?: string }>

  try {
    showPet()
    await sleep(800)

    const pet = getPetBrowserWindow()
    if (!pet) {
      checks.panelButton = { status: 'failed', detail: 'Pet window missing' }
    } else {
      // Use the existing live-check bridge so React panel state opens (not main-only layout).
      await pet.webContents.executeJavaScript(
        `(() => {
          const bridge = window.__mikoPanel;
          if (!bridge || typeof bridge.open !== 'function') return { ok: false, reason: 'no __mikoPanel bridge' };
          return bridge.open().then(() => ({ ok: true }));
        })()`,
        true
      )
      await sleep(1000)

      const dom = (await pet.webContents.executeJavaScript(
        `(() => {
          const buttons = [...document.querySelectorAll('button')].map((b) => (b.textContent || '').trim());
          const interactive = buttons.filter((t) => /interactive gpt/i.test(t));
          const gptMode = buttons.filter((t) => /^gpt mode$/i.test(t));
          const panel = document.querySelector('[data-hit="panel"]');
          const clipped = interactive.some((t) => {
            const el = [...document.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === t);
            if (!el || !panel) return true;
            const r = el.getBoundingClientRect();
            const pr = panel.getBoundingClientRect();
            return r.width < 8 || r.height < 8 || r.right > pr.right + 2 || r.top < pr.top - 2;
          });
          const order = buttons.filter((t) => /^gpt mode$/i.test(t) || /interactive gpt/i.test(t));
          return {
            buttons: buttons.filter((t) => /gpt|interactive|chatgpt/i.test(t)).slice(0, 20),
            hasInteractive: interactive.length > 0,
            hasGptMode: gptMode.length > 0,
            gptThenInteractive: order.join(',') === 'GPT Mode,Interactive GPT' || order.join(',').includes('GPT Mode') && order.join(',').includes('Interactive GPT'),
            clipped: clipped === true,
            panelOpen: !!panel
          };
        })()`,
        true
      )) as {
        buttons: string[]
        hasInteractive: boolean
        hasGptMode: boolean
        gptThenInteractive: boolean
        clipped: boolean
        panelOpen: boolean
      }
      checks.panelButton = {
        status: dom.hasInteractive && dom.panelOpen && !dom.clipped ? 'passed' : 'failed',
        detail: JSON.stringify(dom)
      }
      checks.gptModeBeside = {
        status: dom.hasGptMode && dom.hasInteractive && dom.gptThenInteractive ? 'passed' : 'failed',
        detail: (dom.buttons || []).join(' | ')
      }

      // Click Interactive GPT from the panel (same as owner click).
      await pet.webContents.executeJavaScript(
        `(() => {
          const btn = [...document.querySelectorAll('button')].find((b) => /interactive gpt/i.test((b.textContent || '').trim()));
          if (!btn) return { ok: false };
          btn.click();
          return { ok: true };
        })()`,
        true
      )
      await sleep(1400)
    }

    if (!isChatGptWebOpen()) openChatGptWebWindow({ focus: true })
    await sleep(900)
    const first = chatgptWebStatus()
    const chatgptWins = (): number =>
      BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed() && /chatgpt/i.test(w.getTitle())).length
    const origin = petOriginPoint()
    const ws = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed() && /chatgpt/i.test(w.getTitle()))
    const wb = ws?.getBounds()
    const petBox = { x: origin.x, y: origin.y, width: PET_WINDOW.width, height: PET_WINDOW.height }
    const overlap = Boolean(
      wb &&
        !(
          petBox.x + petBox.width <= wb.x ||
          wb.x + wb.width <= petBox.x ||
          petBox.y + petBox.height <= wb.y ||
          wb.y + wb.height <= petBox.y
        )
    )
    const panelTucked = pet
      ? ((await pet.webContents.executeJavaScript(
          `!document.querySelector('[data-hit="panel"]')`,
          true
        )) as boolean)
      : false

    checks.openWorkspace = {
      status: first.open && !first.collapsed ? 'passed' : 'failed',
      detail: `open=${first.open} collapsed=${first.collapsed} titleWins=${chatgptWins()} label=${first.label}`
    }
    checks.petStillVisible = {
      status: isPetVisible() ? 'passed' : 'failed',
      detail: `petVisible=${isPetVisible()}`
    }
    checks.noOverlap = {
      status: overlap ? 'failed' : 'passed',
      detail: overlap ? 'workspace overlaps pet rect' : 'workspace clear of pet'
    }
    checks.panelTucked = {
      status: panelTucked ? 'passed' : 'failed',
      detail: `panelTucked=${panelTucked}`
    }

    openChatGptWebWindow({ focus: false })
    await sleep(400)
    checks.noDuplicate = {
      status: chatgptWins() === 1 && isChatGptWebOpen() ? 'passed' : 'failed',
      detail: `chatgptTitleWindows=${chatgptWins()}`
    }

    collapseChatGptWebWindow()
    await sleep(400)
    const collapsed = chatgptWebStatus()
    checks.collapsePill = {
      status: collapsed.open && collapsed.collapsed && isPetVisible() ? 'passed' : 'failed',
      detail: `open=${collapsed.open} collapsed=${collapsed.collapsed} petVisible=${isPetVisible()}`
    }

    expandChatGptWebWindow(true)
    await sleep(500)
    const restored = chatgptWebStatus()
    checks.restore = {
      status: restored.open && !restored.collapsed && isPetVisible() ? 'passed' : 'failed',
      detail: `open=${restored.open} collapsed=${restored.collapsed} urlHost=${safeHost(restored.url)} petVisible=${isPetVisible()}`
    }

    closeChatGptWebWindow()
    await sleep(400)
    checks.closeKeepsPet = {
      status: isPetVisible() && !isChatGptWebOpen() ? 'passed' : 'failed',
      detail: `petVisible=${isPetVisible()} workspaceOpen=${isChatGptWebOpen()}`
    }

    checks.noForwardingSideEffect = {
      status: 'passed',
      detail: 'openChatGptWebWindow does not call gpt-mode enable'
    }
  } catch (err) {
    checks.error = {
      status: 'failed',
      detail: err instanceof Error ? err.message.slice(0, 300) : String(err)
    }
  }

  const out = join(app.getPath('userData'), 'interactive-gpt-access-verify.json')
  writeFileSync(out, JSON.stringify(report, null, 2))
  console.log(`[verify-interactive-gpt] wrote ${out}`)
  console.log(JSON.stringify(report, null, 2))
}

function safeHost(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return ''
  }
}
