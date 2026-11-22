import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  assistantUnavailableMessage,
  deviceNoun,
  downloadOpenedMessage,
  installerNoun,
  isWindowsPlatform,
  prefsUpdateHelp,
  restartBlockedReason,
  settingsFolderLabel,
  unsignedUpdateInstructions
} from './platform-copy.ts'

describe('platform copy', () => {
  it('detects Windows and uses PC / AppData / exe wording', () => {
    assert.equal(isWindowsPlatform('win32'), true)
    assert.equal(deviceNoun('win32'), 'this PC')
    assert.equal(settingsFolderLabel('win32'), 'AppData\\Roaming\\MIKO-Beta')
    assert.equal(installerNoun('win32'), '.exe installer')
    assert.match(unsignedUpdateInstructions('win32'), /\.exe|SmartScreen/i)
    assert.match(downloadOpenedMessage('win32'), /\.exe|SmartScreen/i)
    assert.match(restartBlockedReason('win32'), /\.exe/i)
    assert.match(assistantUnavailableMessage('win32'), /Codex CLI on this PC/i)
    assert.match(prefsUpdateHelp('win32', 'manual'), /SmartScreen|AppData/i)
  })

  it('keeps Mac Finder / DMG / Gatekeeper wording on darwin', () => {
    assert.equal(deviceNoun('darwin'), 'this Mac')
    assert.match(unsignedUpdateInstructions('darwin'), /Gatekeeper|MIKO\.app/i)
    assert.match(downloadOpenedMessage('darwin'), /DMG|Finder|Gatekeeper/i)
    assert.match(assistantUnavailableMessage('darwin'), /ChatGPT\.app|this Mac/i)
  })
})
