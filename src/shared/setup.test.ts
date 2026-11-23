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
    assert.equal(started.currentStep, 'meet')

    const voice = applySetupUpdate(started, { action: 'go', step: 'voice' }, 200)
    assert.equal(voice.currentStep, 'voice')
    assert.equal(voice.completedAt, null)

    const complete = applySetupUpdate(voice, { action: 'complete' }, 300)
    assert.equal(complete.status, 'completed')
    assert.equal(complete.currentStep, 'done')
    assert.equal(complete.completedAt, 300)

    const tutorial = applySetupUpdate(complete, { action: 'restart-tutorial' }, 400)
    assert.equal(tutorial.status, 'in-progress')
    assert.equal(tutorial.currentStep, 'try')

    const skipped = applySetupUpdate(tutorial, { action: 'skip' }, 500)
    assert.equal(skipped.status, 'skipped')
    assert.equal(skipped.completedAt, 500)
    // Skip keeps the place; starting again resumes there.
    assert.equal(skipped.currentStep, 'try')
    assert.equal(applySetupUpdate(skipped, { action: 'start' }, 600).currentStep, 'try')
    // A finished tutorial starts over from Meet MIKO.
    assert.equal(applySetupUpdate(complete, { action: 'start' }, 700).currentStep, 'meet')
  })

  it('validates updates and preserves a future stored tutorial version', () => {
    assert.equal(parseSetupUpdate({ action: 'go', step: 'chatgpt' })?.action, 'go')
    // Step names from earlier builds still resume at the matching new step.
    assert.deepEqual(parseSetupUpdate({ action: 'go', step: 'assistant' }), { action: 'go', step: 'chatgpt' })
    assert.equal(parseSetupState({ status: 'in-progress', currentStep: 'microphone' }).currentStep, 'voice')
    assert.equal(parseSetupState({ status: 'in-progress', currentStep: 'show-hide' }).currentStep, 'try')
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
