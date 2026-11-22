import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  SETUP_TUTORIAL_VERSION,
  applySetupUpdate,
  defaultSetupState,
  displayAccelerator,
  parseSetupState,
  parseSetupUpdate
} from './setup.ts'

describe('first-run setup state', () => {
  it('defaults safely for missing and malformed values', () => {
    assert.deepEqual(parseSetupState(null), defaultSetupState())
    assert.deepEqual(parseSetupState({ status: 'wat', currentStep: 'secret' }), defaultSetupState())
  })

  it('starts, advances, completes, skips and restarts the tutorial', () => {
    const started = applySetupUpdate(defaultSetupState(), { action: 'start' }, 100)
    assert.equal(started.status, 'in-progress')
    assert.equal(started.currentStep, 'welcome')

    const voice = applySetupUpdate(started, { action: 'go', step: 'voice' }, 200)
    assert.equal(voice.currentStep, 'voice')
    assert.equal(voice.completedAt, null)

    const complete = applySetupUpdate(voice, { action: 'complete' }, 300)
    assert.equal(complete.status, 'completed')
    assert.equal(complete.currentStep, 'done')
    assert.equal(complete.completedAt, 300)

    const tutorial = applySetupUpdate(complete, { action: 'restart-tutorial' }, 400)
    assert.equal(tutorial.status, 'in-progress')
    assert.equal(tutorial.currentStep, 'show-hide')

    const skipped = applySetupUpdate(tutorial, { action: 'skip' }, 500)
    assert.equal(skipped.status, 'skipped')
    assert.equal(skipped.completedAt, 500)
  })

  it('validates updates and preserves a future stored tutorial version', () => {
    assert.equal(parseSetupUpdate({ action: 'go', step: 'assistant' })?.action, 'go')
    assert.equal(parseSetupUpdate({ action: 'go', step: 'bogus' }), null)
    assert.equal(parseSetupUpdate({ action: 'delete' }), null)
    const parsed = parseSetupState({
      tutorialVersion: SETUP_TUTORIAL_VERSION + 1,
      status: 'completed',
      currentStep: 'done',
      completedAt: 42
    })
    assert.equal(parsed.tutorialVersion, SETUP_TUTORIAL_VERSION + 1)
  })

  it('shows the real Windows and macOS summon key names', () => {
    assert.equal(displayAccelerator('CommandOrControl+Shift+R', 'win32'), 'Ctrl+Shift+R')
    assert.equal(displayAccelerator('CommandOrControl+Shift+R', 'darwin'), 'Command+Shift+R')
  })
})
