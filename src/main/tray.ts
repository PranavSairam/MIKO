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
  setBridge: () => undefined
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
      label: 'ChatGPT bridge test (Codex CLI)',
      type: 'checkbox',
      checked: actions.bridge(),
      click: (item) => {
        actions.setBridge(item.checked)
        refreshTrayMenu()
      }
    },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() }
  ])
}
