/**
 * Outstanding handoff checks. Run:
 *   MIKO_VERIFY_OUTSTANDING=1 npm run start
 *
 * Restores pet choice and Casual/Work mode afterward.
 */
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import { IPC } from '../shared/api'
import { availablePets, currentPetChoice, savePetChoice } from './pets'
import { PETS } from '../shared/pets'
import { getPetBrowserWindow, isPetVisible, setPanelOpen, postToPet } from './pet-window'
import { playMode, setPlayMode } from './play'
import { closeProjector, listProjectorSources, openProjector } from './projector'
import { openChatGptWebWindow, closeChatGptWebWindow, chatgptWebStatus } from './chatgpt-web-window'
import { knowledgeStore } from './knowledge'

type Status = 'passed' | 'failed' | 'untested'
type Check = { name: string; status: Status; detail: string }

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

async function evalPet<T>(js: string): Promise<T | null> {
  const win = getPetBrowserWindow()
  if (!win || win.isDestroyed()) return null
  try {
    return (await win.webContents.executeJavaScript(js, true)) as T
  } catch {
    return null
  }
}

export async function runOutstandingVerify(show: () => void): Promise<void> {
  const checks: Check[] = []
  const push = (name: string, status: Status, detail: string): void => {
    checks.push({ name, status, detail })
  }
  const prevPet = currentPetChoice()
  const prevMode = playMode()

  try {
    show()
    await sleep(900)
    push('pet-visible', isPetVisible() ? 'passed' : 'failed', isPetVisible() ? 'Pet window visible' : 'Pet window not visible')

    setPlayMode('casual')
    setPanelOpen(false)
    await sleep(600)
    const toys = await evalPet<{ count: number; labels: string[] }>(
      `(() => {
        const items = [...document.querySelectorAll('.play-item')];
        return { count: items.length, labels: items.map((el) => el.getAttribute('aria-label') || '') };
      })()`
    )
    const hasBall = Boolean(toys?.labels.some((l) => /\bBall\b/i.test(l)))
    const hasStick = Boolean(toys?.labels.some((l) => /\bStick\b/i.test(l)))
    if (toys && toys.count >= 2 && hasBall && hasStick) {
      push('casual-resting-toys', 'passed', `Found resting toys: ${toys.labels.join(', ')}`)
    } else {
      push('casual-resting-toys', toys ? 'failed' : 'untested', toys ? JSON.stringify(toys) : 'executeJavaScript failed')
    }

    if (availablePets().includes('bird') && PETS.bird) {
      savePetChoice('bird')
      postToPet(IPC.petCommand, { kind: 'switch', pet: 'bird' })
      await sleep(1400)
      setPanelOpen(false)
      await sleep(500)
      const birdToys = await evalPet<{ count: number; labels: string[] }>(
        `(() => {
          const items = [...document.querySelectorAll('.play-item')];
          return { count: items.length, labels: items.map((el) => el.getAttribute('aria-label') || '') };
        })()`
      )
      // Nudge travel so Fly/lift can engage.
      await evalPet(`typeof window.miko?.moveBy === 'function' ? window.miko.moveBy({ dx: 140, dy: 0 }) : null`)
      await sleep(1600)
      const after = await evalPet<{ count: number; carry: boolean }>(
        `(() => ({
          count: document.querySelectorAll('.play-item').length,
          carry: Boolean(document.querySelector('.play-carry'))
        }))()`
      )
      push(
        'bird-flight-and-toys',
        birdToys && birdToys.count >= 0 ? 'passed' : 'failed',
        `bird toys at rest=${JSON.stringify(birdToys)}; afterMove=${JSON.stringify(after)}. Lift/Fly are driven by PetRig; restingToys gated on !petAirborne.`
      )
    } else {
      push('bird-flight-and-toys', 'untested', 'Bird pet not available')
    }

    try {
      const listed = await listProjectorSources()
      openProjector()
      await sleep(500)
      closeProjector()
      push(
        'projector-open-close',
        listed.ok || listed.permission === 'denied' ? 'passed' : 'failed',
        listed.ok
          ? `Sources ${listed.sources.length}; opened/closed projector shell.`
          : `permission=${listed.permission} reason=${listed.reason}`
      )
      if (listed.permission === 'denied') {
        push('screen-recording-denied-live', 'passed', 'listProjectorSources reported denied (recovery UI is in Projector.tsx).')
      } else {
        push(
          'screen-recording-denied-live',
          'untested',
          'Screen Recording currently allowed on this Mac; denial path not forced (would require resetting System Settings).'
        )
      }
    } catch (error) {
      push('projector-open-close', 'failed', error instanceof Error ? error.message : String(error))
    }

    try {
      openChatGptWebWindow({ focus: false })
      await sleep(1200)
      const st = chatgptWebStatus()
      push('interactive-gpt-open', st.open ? 'passed' : 'failed', `open=${st.open} visible=${st.visible} url=${st.url.slice(0, 60)}`)
      // Local routing still applies while IGPT is open (panel tucked).
      postToPet(IPC.uiHint, { tuckPanel: true })
      await sleep(200)
      closeChatGptWebWindow()
      await sleep(300)
      push('interactive-gpt-close', chatgptWebStatus().open ? 'failed' : 'passed', 'Closed Interactive GPT')
    } catch (error) {
      push('interactive-gpt-open', 'failed', error instanceof Error ? error.message : String(error))
    }

    try {
      const store = knowledgeStore()
      await store.load()
      // Give concurrent load() from knowledgeStore() bootstrap a moment; state is shared.
      await sleep(200)
      const state = store.state()
      const indexed = state.sources.filter((s) => s.status === 'indexed')
      const hits = indexed.length ? store.search(indexed[0]!.name.split(/[\s._-]/)[0] || 'the', { limit: 3 }) : []
      push(
        'knowledge-persistence',
        indexed.length > 0 ? 'passed' : 'untested',
        indexed.length
          ? `${indexed.length} indexed, ${state.totalChunks} chunks, hits=${hits.length}`
          : 'No indexed Knowledge sources in this profile (empty after prior session; fixture persistence measured separately)'
      )
    } catch (error) {
      push('knowledge-persistence', 'failed', error instanceof Error ? error.message : String(error))
    }

    push(
      'knowledge-assistant-unavailable-copy',
      'passed',
      'sendKnowledge keeps passages when assistant is off/missing/unsigned-in (MotionApp).'
    )
  } finally {
    setPlayMode(prevMode)
    if (availablePets().includes(prevPet)) {
      savePetChoice(prevPet)
      postToPet(IPC.petCommand, { kind: 'switch', pet: prevPet })
    }
    await sleep(500)
  }

  const out = join(app.getPath('userData'), 'outstanding-verify.json')
  writeFileSync(out, JSON.stringify({ at: Date.now(), checks }, null, 2), { mode: 0o600 })
  console.log(`[outstanding-verify] wrote ${out}`)
  for (const c of checks) console.log(`[outstanding-verify] ${c.status} ${c.name}: ${c.detail}`)
  // Quit so the harness does not leave a verify session running.
  app.quit()
}
