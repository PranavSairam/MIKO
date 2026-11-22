import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { Menu, Tray, app, dialog, nativeImage } from 'electron'
import trayMacDev from '../../resources/tray-mac.png?asset'
import trayWinDev from '../../resources/tray-win.png?asset'

/** Resolve tray PNG for both electron-vite preview and packaged extraResources. */
function trayIconPath(): string {
  const name = process.platform === 'darwin' ? 'tray-mac.png' : 'tray-win.png'
  const candidates = [
    process.platform === 'darwin' ? trayMacDev : trayWinDev,
    join(__dirname, '../../resources', name),
    join(process.cwd(), 'resources', name),
    ...(process.resourcesPath
      ? [join(process.resourcesPath, 'resources', name), join(process.resourcesPath, name)]
      : [])
  ]
  return candidates.find((path) => typeof path === 'string' && path && existsSync(path)) || candidates[0] || ''
}

export interface TrayActions {
  show: () => void
  hide: () => void
  isVisible: () => boolean
  detail: () => string
  following: () => boolean
  setFollowing: (enabled: boolean) => Promise<{ ok: boolean; reason: string }>
  voiceAuto: () => boolean
  setVoiceAuto: (enabled: boolean) => void
  bridge: () => boolean
  setBridge: (enabled: boolean) => void
  autoPaste: () => boolean
  setAutoPaste: (enabled: boolean) => void
  /** GPT Mode: off | paused | active */
  gptModePhase?: () => 'off' | 'paused' | 'active'
  setGptMode?: (action: 'enable' | 'pause' | 'resume' | 'exit') => void
  /** Pets whose assets exist, and the one on screen. */
  pets?: () => { available: { id: string; name: string }[]; selected: string }
  choosePet?: (id: string) => void
  openPetChooser?: () => void
  openSetup?: () => void
  /** Shows MIKO and starts the mic (works without any keyboard shortcut). */
  listen?: () => void
}

let tray: Tray | null = null
let actions: TrayActions = {
  show: () => undefined,
  hide: () => undefined,
  isVisible: () => false,
  detail: () => '',
  following: () => false,
  setFollowing: () => Promise.resolve({ ok: false, reason: '' }),
  voiceAuto: () => true,
  setVoiceAuto: () => undefined,
  bridge: () => false,
  setBridge: () => undefined,
  autoPaste: () => true,
  setAutoPaste: () => undefined
}

export function createTray(next: TrayActions): { refresh: () => void } {
  actions = next
  const icon = nativeImage.createFromPath(trayIconPath())
  if (process.platform === 'darwin') icon.setTemplateImage(true)
  if (icon.isEmpty()) {
    throw new Error('MIKO tray icon failed to load')
  }

  tray = new Tray(icon)
  refreshTrayMenu()

  if (process.platform === 'win32') {
    tray.on('click', () => {
      tray?.popUpContextMenu(buildMenu())
    })
  }

  app.on('before-quit', () => {
    tray?.destroy()
    tray = null
  })

  return { refresh: refreshTrayMenu }
}

export function refreshTrayMenu(): void {
  if (!tray || tray.isDestroyed()) return
  tray.setContextMenu(buildMenu())
}

/** "Pet" submenu: one radio item per pet whose asset exists, plus the chooser. */
function petMenu(): Electron.MenuItemConstructorOptions[] {
  const pets = actions.pets?.()
  if (!pets) return []
  return [
    { type: 'separator' },
    {
      label: 'Pet',
      submenu: [
        ...pets.available.map(
          (pet): Electron.MenuItemConstructorOptions => ({
            label: pet.name,
            type: 'radio',
            checked: pet.id === pets.selected,
            click: () => actions.choosePet?.(pet.id)
          })
        ),
        { type: 'separator' },
        { label: 'Choose your pet…', click: () => actions.openPetChooser?.() }
      ]
    }
  ]
}

function buildMenu(): Menu {
  const visible = actions.isVisible()
  const detail = actions.detail()
  tray?.setToolTip(detail ? `MIKO — ${detail}` : 'MIKO')
  return Menu.buildFromTemplate([
    { label: 'Show', enabled: !visible, click: () => actions.show() },
    { label: 'Hide', enabled: visible, click: () => actions.hide() },
    { label: detail || 'Summon shortcut', enabled: false },
    ...(actions.listen ? [{ label: 'Talk to MIKO (mic)', click: () => actions.listen?.() } as const] : []),
    {
      label: 'Follow active app',
      type: 'checkbox',
      checked: actions.following(),
      click: (item) => {
        const next = item.checked
        void actions.setFollowing(next).then((result) => {
          if (!result.ok) {
            item.checked = false
            dialog.showMessageBox({ type: 'info', message: 'MIKO can\u2019t follow yet', detail: result.reason })
          }
          refreshTrayMenu()
        })
      }
    },
    {
      label: 'Execute voice commands automatically',
      type: 'checkbox',
      checked: actions.voiceAuto(),
      click: (item) => {
        actions.setVoiceAuto(item.checked)
        refreshTrayMenu()
      }
    },
    {
      label: 'Auto-paste into ChatGPT',
      type: 'checkbox',
      checked: actions.autoPaste(),
      click: (item) => {
        actions.setAutoPaste(item.checked)
        refreshTrayMenu()
      }
    },
    {
      label: 'MIKO assistant (Codex, ChatGPT sign-in)',
      type: 'checkbox',
      checked: actions.bridge(),
      click: (item) => {
        actions.setBridge(item.checked)
        refreshTrayMenu()
      }
    },
    {
      label: 'GPT Mode (messages → ChatGPT app)',
      type: 'checkbox',
      checked: (actions.gptModePhase?.() ?? 'off') !== 'off',
      click: (item) => {
        if (item.checked) actions.setGptMode?.('enable')
        else actions.setGptMode?.('exit')
        refreshTrayMenu()
      }
    },
    ...((actions.gptModePhase?.() ?? 'off') !== 'off'
      ? [
          {
            label:
              actions.gptModePhase?.() === 'active'
                ? 'Pause GPT Mode'
                : 'Resume GPT Mode',
            click: () => {
              if (actions.gptModePhase?.() === 'active') actions.setGptMode?.('pause')
              else actions.setGptMode?.('resume')
              refreshTrayMenu()
            }
          } as const
        ]
      : []),
    ...petMenu(),
    { type: 'separator' },
    ...(actions.openSetup
      ? [{ label: 'Setup & Help…', click: () => actions.openSetup?.() } as const]
      : []),
    { label: 'Quit', click: () => app.quit() }
  ])
}
