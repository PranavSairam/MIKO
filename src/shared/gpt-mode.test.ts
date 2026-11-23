/**
 * Deterministic GPT Mode helpers — no live ChatGPT / AX.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  clampGptLiveZoom,
  deliveryStatusLabel,
  emptyGptModeState,
  fitGptLiveScale,
  gptBannerKind,
  gptModeBanner,
  isExcludedCaptureOwner,
  isForeignLiveSource,
  isGptModeLocalControl,
  isTerminalGptStatus,
  normalizeGptLiveCrop,
  parseGptModeLocalAction,
  phaseAfterLoad
} from './gpt-mode.ts'

describe('GPT Mode helpers', () => {
  it('starts paused after relaunch when opted in', () => {
    assert.equal(phaseAfterLoad(true), 'paused')
    assert.equal(phaseAfterLoad(false), 'off')
  })

  it('uses short Connected / Paused / Needs attention banners', () => {
    const active = { ...emptyGptModeState(), phase: 'active' as const, optedIn: true }
    const paused = { ...emptyGptModeState(), phase: 'paused' as const, optedIn: true }
    const attention = {
      ...emptyGptModeState(),
      phase: 'active' as const,
      optedIn: true,
      lastStatus: 'delivery-unverified' as const
    }
    assert.equal(gptModeBanner(active), 'GPT Mode · Connected')
    assert.equal(gptModeBanner(paused), 'GPT Mode · Paused')
    assert.equal(gptBannerKind(attention), 'needs-attention')
    assert.equal(gptModeBanner(attention), 'GPT Mode · Needs attention')
    assert.equal(gptModeBanner(emptyGptModeState()), '')
  })

  it('keeps enable/disable/pause/new chat/cancel local', () => {
    assert.equal(parseGptModeLocalAction('exit GPT mode'), 'exit')
    assert.equal(parseGptModeLocalAction('pause'), 'pause')
    assert.equal(parseGptModeLocalAction('resume GPT mode'), 'resume')
    assert.equal(parseGptModeLocalAction('enable GPT mode'), 'enable')
    assert.equal(parseGptModeLocalAction('new chat'), 'new-chat')
    assert.equal(parseGptModeLocalAction('cancel that'), 'cancel')
    assert.equal(parseGptModeLocalAction('stop listening'), 'cancel')
    assert.equal(isGptModeLocalControl('turn on GPT mode'), true)
    assert.equal(isGptModeLocalControl('explain neural networks'), false)
    assert.equal(parseGptModeLocalAction('explain neural networks'), null)
  })

  it('labels delivery statuses and marks terminals', () => {
    assert.equal(deliveryStatusLabel('delivery-unverified'), 'Delivery unverified')
    assert.equal(isTerminalGptStatus('preparing'), false)
    assert.equal(isTerminalGptStatus('delivery-unverified'), true)
    assert.equal(isTerminalGptStatus('cancelled'), true)
  })

  it('excludes Cursor, MIKO, desktop, and Codex helpers from silent capture', () => {
    assert.equal(isExcludedCaptureOwner('Cursor', 'PET_BOT'), true)
    assert.equal(isExcludedCaptureOwner('MIKO', ''), true)
    assert.equal(isExcludedCaptureOwner('', 'Entire Screen'), true)
    assert.equal(isExcludedCaptureOwner('Codex (Aperitif Renderer)', 'x'), true)
    assert.equal(isExcludedCaptureOwner('ChatGPT', 'New chat'), false)
    assert.equal(isExcludedCaptureOwner('ChatGPT', 'Build MIKO Phases'), false)
  })

  it('treats WhatsApp and similar apps as foreign live sources', () => {
    assert.equal(isForeignLiveSource('Other app', 'WhatsApp'), true)
    assert.equal(isForeignLiveSource('Notes', 'Sticky'), true)
    assert.equal(isForeignLiveSource('ChatGPT', 'Build MIKO Phases'), false)
  })

  it('clamps viewer zoom and fits aspect ratio', () => {
    assert.equal(clampGptLiveZoom(0.1), 0.5)
    assert.equal(clampGptLiveZoom(9), 3)
    assert.equal(fitGptLiveScale(2000, 1000, 1000, 1000), 0.5)
    assert.deepEqual(normalizeGptLiveCrop({ x: 0.1, y: 0.2, width: 0.5, height: 0.4 }), {
      x: 0.1,
      y: 0.2,
      width: 0.5,
      height: 0.4
    })
  })
})

describe('GPT Mode: everyday open/close words', () => {
  it('“open GPT mode” enables it (never an app called “GPT Mode”)', () => {
    for (const t of ['Open GPT mode', 'activate GPT mode', 'switch on chatgpt mode', 'go into GPT mode']) {
      assert.equal(parseGptModeLocalAction(t), 'enable', t)
    }
  })
  it('“close GPT mode” exits it', () => {
    for (const t of ['close GPT mode', 'switch off GPT mode', 'deactivate GPT mode']) {
      assert.equal(parseGptModeLocalAction(t), 'exit', t)
    }
  })
})
