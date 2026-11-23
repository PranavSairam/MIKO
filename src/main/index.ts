import { app, Menu } from 'electron'
import { join } from 'path'
import { restoreFollow, startFollowLoop, isFollowEnabled, enableFollow } from './follow'
import { registerIpc } from './ipc'
import { createLivingPreview } from './living-preview'
import { createPetWindow, isPetVisible, setPanelOpenedListener, setPlacementListener, setQuitting } from './pet-window'
import { availablePets, currentPetChoice, syncTree } from './pets'
import { PETS } from '../shared/pets'
import { createPhase2Preview } from './phase2-preview'
import { createPresence } from './presence'
import { registerSummonShortcut } from './summon-shortcut'
import { createTray } from './tray'
import { IPC } from '../shared/api'
import { startKeys } from './keys'
import { postToPet } from './pet-window'
import { startListening, stopListening } from './speech'
import { destroyToy, playMode, setPlayMode } from './play'
import { closeProjector, openProjector } from './projector'
import { stopKnowledge } from './knowledge'
import { hideSwitcher, toggleSwitcher, warmSwitcher } from './switcher-window'
import { enableGptMode, exitGptMode, getGptModeState, pauseGptMode, resumeGptMode } from './gpt-mode'
import { assistantEnabled, chatgptAutoPaste, setAssistantEnabled, setChatgptAutoPaste, setVoiceAutoExecute, voiceAutoExecute } from './settings'
import { stopAllBridges } from './bridge'
import { startSelectionShortcut } from './selection-shortcut'
import { disarmPaste } from './selection'
import { startUpdater, stopUpdater } from './updater'
import { migrateSettingsIfNeeded } from './session-flush'
import { listApplications } from './apps'
import { logDiag } from './diagnostics'

app.setName('MIKO')
if (process.platform === 'win32') {
  app.setAppUserModelId('com.pranavsairam.miko')
}
// Packaged beta uses a distinct folder. On case-insensitive APFS,
// Application Support/MIKO collides with the lowercase "miko" npm-start profile
// (aliases, mail tokens, prefs) — never reuse that for distributed builds.
const cliUserData = process.argv.find((arg) => arg.startsWith('--user-data-dir='))
if (cliUserData) {
  app.setPath('userData', cliUserData.slice('--user-data-dir='.length))
} else if (app.isPackaged) {
  app.setPath('userData', join(app.getPath('appData'), 'MIKO-Beta'))
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
    stopUpdater()
    unregisterShortcut()
    stopKeys()
    stopSelection()
    disarmPaste()
    stopAllBridges()
    destroyToy()
    closeProjector()
    stopKnowledge()
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

    migrateSettingsIfNeeded()
    logDiag('startup', 'MIKO started', { version: app.getVersion(), packaged: app.isPackaged, arch: process.arch })
    if (process.platform === 'win32') {
      // Read the Windows Start app list now so the first "open Calculator" doesn't wait on PowerShell.
      void listApplications().catch(() => undefined)
    }
    const shortcut = registerSummonShortcut(app.getPath('userData'), () => presence.toggle())
    unregisterShortcut = shortcut.unregister
    registerIpc(presence, shortcut)
    restoreFollow()
    startFollowLoop()
    startUpdater()
    const tray = createTray({
      pets: () => ({ available: availablePets().map((id) => ({ id, name: PETS[id].name })), selected: currentPetChoice() }),
      choosePet: (id) => {
        presence.show()
        postToPet(IPC.petCommand, { kind: 'switch', pet: id })
      },
      openPetChooser: () => {
        presence.show()
        postToPet(IPC.petCommand, { kind: 'choose' })
      },
      playMode,
      setPlayMode: (mode) => {
        setPlayMode(mode)
        refresh()
      },
      openProjector: () => {
        presence.show()
        openProjector()
      },
      openPlay: () => {
        presence.show()
        postToPet(IPC.petCommand, { kind: 'play' })
      },
      openSetup: () => {
        presence.show()
        postToPet(IPC.uiHint, { openHelp: true })
      },
      listen: () => {
        presence.show()
        postToPet(IPC.uiHint, { listen: true })
      },
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
      gptModePhase: () => getGptModeState().phase,
      setGptMode: (action) => {
        if (action === 'enable') void enableGptMode(process.pid)
        else if (action === 'pause') pauseGptMode()
        else if (action === 'resume') resumeGptMode()
        else exitGptMode()
      },
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
    setPlacementListener(syncTree)
    setPanelOpenedListener(() => hideSwitcher(true))
    createPetWindow({
      onVisibility: () => {
        tray.refresh()
        syncTree()
      },
      onReady: () => presence.markReady(),
      onClose: () => presence.hide()
    })
    // Show MIKO as soon as it starts (⌘⇧R or the paw menu still hide it).
    presence.show()

    if (process.env['MIKO_VERIFY_OUTSTANDING'] === '1') {
      void import('./verify-outstanding').then(({ runOutstandingVerify }) =>
        runOutstandingVerify(() => presence.show())
      )
    }

    if (process.env['MIKO_VERIFY_INTERACTIVE_GPT'] === '1') {
      void import('./verify-interactive-gpt').then(({ runInteractiveGptAccessVerify }) =>
        runInteractiveGptAccessVerify(() => presence.show())
      )
    }

    if (process.env['MIKO_VERIFY_CHATGPT_WEB_DND'] === '1') {
      void import('./verify-chatgpt-web-dnd').then(({ runChatGptWebDndVerify }) =>
        runChatGptWebDndVerify(() => presence.show())
      )
    }

    if (process.env['MIKO_VERIFY_WA_GPT_TRANSFER'] === '1') {
      void import('./verify-wa-gpt-transfer').then(({ runWaGptTransferVerify }) =>
        runWaGptTransferVerify(() => presence.show())
      )
    }

    if (process.env['MIKO_VERIFY_PET_INTERACTION'] === '1') {
      void import('./verify-pet-interaction').then(({ runPetInteractionVerify }) =>
        runPetInteractionVerify(() => presence.show())
      )
    }

    if (process.env['MIKO_VERIFY_SEND_IT'] === '1') {
      void import('./verify-send-it').then(({ runSendItVerify }) =>
        runSendItVerify(() => presence.show())
      )
    }

    if (process.env['MIKO_VERIFY_WA_CONVERSATION'] === '1') {
      void import('./verify-wa-conversation').then(({ runWaConversationVerify }) =>
        runWaConversationVerify(() => presence.show())
      )
    }

    warmSwitcher()
    stopSelection = startSelectionShortcut(() => presence.show())
    stopKeys = startKeys({
      // Caps Lock + A (Mac) / Shift + A (Windows) held: show MIKO, listen until release, words go to the chat box.
      talkStart: () => {
        presence.show()
        void startListening(true, 'keys').then((result) => {
          if (result.ok) postToPet(IPC.keys, { kind: 'talk-start' })
          // Empty reason: keys let go before recognition started (quiet cancel).
          else if (result.reason || process.platform === 'darwin') {
            postToPet(IPC.speech, {
              phase: 'unavailable',
              ...(result.reason && process.platform === 'win32' ? { detail: result.reason } : {}),
              ...(result.help ? { help: result.help } : {})
            })
          }
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
          },
          // macOS routes ⌘C/⌘V/⌘X/⌘A/⌘Z to text fields only through an Edit menu.
          { role: 'editMenu' }
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
        },
        { role: 'editMenu' }
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
