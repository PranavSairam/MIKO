import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'

const read = (path: string): string => readFileSync(new URL(path, import.meta.url), 'utf8')

describe('Windows installer for a non-technical user (static)', () => {
  const yml = read('../../electron-builder.yml')
  const nsh = read('../../build/installer.nsh')

  it('installs per user without admin, with a Start menu shortcut, then starts MIKO', () => {
    assert.match(yml, /oneClick: true/)
    assert.match(yml, /perMachine: false/)
    assert.match(yml, /allowElevation: false/)
    assert.match(yml, /createStartMenuShortcut: true/)
    assert.match(yml, /runAfterFinish: true/)
  })

  it('desktop shortcut is opt-in; user data survives upgrades and uninstall', () => {
    assert.match(yml, /createDesktopShortcut: false/)
    assert.match(yml, /deleteAppDataOnUninstall: false/)
    assert.match(yml, /include: build\/installer\.nsh/)
    // Only a real uninstall (not an upgrade) removes what MIKO created and explains the kept data.
    assert.match(nsh, /\$\{ifNot\} \$\{isUpdated\}[\s\S]*Delete "\$DESKTOP\\MIKO\.lnk"[\s\S]*IfSilent \+2\s*\n\s*MessageBox/)
    assert.doesNotMatch(nsh, /RMDir[^\n]*APPDATA/i, 'never deletes user data')
  })

  it('never packages personal settings or credentials', () => {
    const files = yml.slice(yml.indexOf('files:'), yml.indexOf('extraResources:'))
    assert.doesNotMatch(files, /userData|miko-settings|\.env|secrets/i)
    const handoff = read('../../scripts/make-win-handoff.mjs')
    assert.match(handoff, /miko-settings\\\.json/)
    assert.match(handoff, /Cookies/)
  })

  it('START-HERE has three short steps; nothing claims automatic updates', () => {
    const start = read('../../docs/handoff/START-HERE.txt')
    assert.deepEqual(start.match(/^\d\. /gm), ['1. ', '2. ', '3. '])
    for (const text of [start, read('../../docs/handoff/TROUBLESHOOTING.txt')]) {
      assert.doesNotMatch(text, /updates? automatically|auto-?update/i)
    }
  })
})

describe('first open and Help & Setup (static)', () => {
  const setup = read('../renderer/src/components/SetupTutorial.tsx')
  const help = read('../renderer/src/components/HelpSetup.tsx')
  const system = read('../main/system-options.ts')
  const index = read('../main/index.ts')

  it('the five steps are in order and every step can be skipped', () => {
    assert.match(setup, /const ORDER: SetupStepId\[\] = \['meet', 'try', 'voice', 'chatgpt', 'ready'\]/)
    assert.match(setup, /Skip for now/)
    assert.match(setup, /MIKO never sees your password/)
  })

  it('Help & Setup has every entry the handoff needs', () => {
    for (const label of ['Test microphone', 'Show / hide shortcut', 'Open Interactive GPT', 'What works on', 'Send feedback', 'Open logs folder']) {
      assert.ok(help.includes(label), label)
    }
    assert.match(help, /Continue setup/)
    // Honest update wording when no update source is configured.
    assert.match(help, /there’s no automatic update service set up/)
  })

  it('start at sign-in and the desktop shortcut only change when the owner picks them', () => {
    assert.doesNotMatch(index, /setLoginItemSettings|setSystemOptions|writeShortcutLink/)
    assert.match(system, /launchAtLogin = packaged && app\.getLoginItemSettings\(\)\.openAtLogin/)
  })
})
