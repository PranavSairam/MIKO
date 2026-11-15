import { Menu, Tray, app, dialog, nativeImage } from 'electron'
import trayMac from '../../resources/tray-mac.png?asset'
import trayWin from '../../resources/tray-win.png?asset'

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
  /** Pets whose assets exist, and the one on screen. */
  pets?: () => { available: { id: string; name: string }[]; selected: string }
  choosePet?: (id: string) => void
  openPetChooser?: () => void
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
  const icon =
    process.platform === 'darwin' ? nativeImage.createFromPath(trayMac) : nativeImage.createFromPath(trayWin)
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
    ...petMenu(),
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() }
  ])
}
