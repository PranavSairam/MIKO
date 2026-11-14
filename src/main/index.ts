import { app, Menu } from 'electron'
import { join } from 'path'
import { restoreFollow, startFollowLoop, isFollowEnabled, enableFollow } from './follow'
import { registerIpc } from './ipc'
import { createLivingPreview } from './living-preview'
import { createPetWindow, isPetVisible, setQuitting } from './pet-window'
import { createPhase2Preview } from './phase2-preview'
import { createPresence } from './presence'
import { registerSummonShortcut } from './summon-shortcut'
import { createTray } from './tray'
import { IPC } from '../shared/api'
import { startKeys } from './keys'
import { postToPet } from './pet-window'
import { startListening, stopListening } from './speech'
import { toggleSwitcher, warmSwitcher } from './switcher-window'
import { assistantEnabled, chatgptAutoPaste, setAssistantEnabled, setChatgptAutoPaste, setVoiceAutoExecute, voiceAutoExecute } from './settings'
import { stopAllBridges } from './bridge'
import { startSelectionShortcut } from './selection-shortcut'
import { disarmPaste } from './selection'

app.setName('MIKO')
if (process.platform === 'win32') {
  app.setAppUserModelId('com.miko.pet')
}

const phase2Preview = process.argv.includes('--phase2-preview')
const livingPreview = process.argv.includes('--living-preview')
if (phase2Preview) {
  app.setPath('userData', join(app.getPath('userData'), 'phase2-preview'))
} else if (livingPreview) {
  app.setPath('userData', join(app.getPath('userData'), 'living-preview'))
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else if (phase2Preview) {
  app.on('second-instance', () => {
    createPhase2Preview()
  })
  app.on('window-all-closed', () => {
    app.quit()
  })
  void app.whenReady().then(() => {
    createPhase2Preview()
    setPreviewMenu()
  })
} else if (livingPreview) {
  app.on('second-instance', () => {
    createLivingPreview()
  })
  app.on('window-all-closed', () => {
    app.quit()
  })
  void app.whenReady().then(() => {
    createLivingPreview()
    setPreviewMenu()
  })
} else {
  let refresh = (): void => undefined
  let unregisterShortcut = (): void => undefined
  let stopKeys = (): void => undefined
  let stopSelection = (): void => undefined
  const presence = createPresence(() => refresh())

  app.on('second-instance', () => {
    presence.show()
  })

  app.on('before-quit', () => {
    setQuitting(true)
    unregisterShortcut()
    stopKeys()
    stopSelection()
    disarmPaste()
    stopAllBridges()
  })

  app.on('window-all-closed', () => {
    // The tray keeps MIKO alive. Quit is explicit.
  })

  app.on('activate', () => {
    presence.show()
  })

  void app.whenReady().then(() => {
    if (process.platform === 'darwin' && app.dock) {
      app.dock.hide()
    }

    const shortcut = registerSummonShortcut(app.getPath('userData'), () => presence.toggle())
    unregisterShortcut = shortcut.unregister
    registerIpc(presence)
    restoreFollow()
    startFollowLoop()
    const tray = createTray({
      show: () => presence.show(),
      hide: () => presence.hide(),
      isVisible: isPetVisible,
      detail: () => shortcut.detail,
      following: isFollowEnabled,
      setFollowing: (enabled) => {
        const result = enableFollow(enabled)
        refresh()
        return result
      },
      autoPaste: chatgptAutoPaste,
      setAutoPaste: setChatgptAutoPaste,
      bridge: assistantEnabled,
      setBridge: (enabled) => {
        setAssistantEnabled(enabled)
        if (!enabled) stopAllBridges()
      },
      voiceAuto: voiceAutoExecute,
      setVoiceAuto: (enabled) => {
        setVoiceAutoExecute(enabled)
        postToPet(IPC.voiceAuto, enabled)
      }
    })
    refresh = tray.refresh
    createPetWindow({
      onVisibility: () => tray.refresh(),
      onReady: () => presence.markReady(),
      onClose: () => presence.hide()
    })
    // Show MIKO as soon as it starts (⌘⇧R or the paw menu still hide it).
    presence.show()

    warmSwitcher()
    stopSelection = startSelectionShortcut(() => presence.show())
    stopKeys = startKeys({
      // Caps Lock + A held: show MIKO, listen until release, put the words in the chat box.
      talkStart: () => {
        presence.show()
        void startListening(true).then((result) => {
          if (result.ok) postToPet(IPC.keys, { kind: 'talk-start' })
          else postToPet(IPC.speech, { phase: 'unavailable' })
        })
      },
      talkStop: () => stopListening(),
      switcher: () => toggleSwitcher(),
      permission: () => postToPet(IPC.keys, { kind: 'permission' })
    })

    if (process.platform === 'darwin') {
      Menu.setApplicationMenu(
        Menu.buildFromTemplate([
          {
            label: 'MIKO',
            submenu: [
              { label: 'Show', click: () => presence.show() },
              { label: 'Hide', click: () => presence.hide() },
              { type: 'separator' },
              { role: 'quit' }
            ]
          }
        ])
      )
    } else {
      Menu.setApplicationMenu(null)
    }
  })
}

function setPreviewMenu(): void {
  if (process.platform === 'darwin') {
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([
        {
          label: 'MIKO',
          submenu: [{ role: 'quit' }]
        }
      ])
    )
  } else {
    Menu.setApplicationMenu(null)
  }
}

app.on('web-contents-created', (_event, contents) => {
  contents.on('will-attach-webview', (event) => {
    event.preventDefault()
  })
})
