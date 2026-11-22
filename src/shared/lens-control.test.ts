import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  isFinderOwner,
  isSpotifyOwner,
  mapLensPointToScreen,
  parseCaptureWindowId,
  sanitizeLensFilePath
} from './lens-control.ts'

describe('lens-control mapLensPointToScreen', () => {
  it('maps stage center through fit zoom into window center', () => {
    const mapped = mapLensPointToScreen({
      clientX: 100,
      clientY: 100,
      stageLeft: 0,
      stageTop: 0,
      scrollLeft: 0,
      scrollTop: 0,
      zoom: 0.5,
      captureWidth: 2000,
      captureHeight: 1000,
      crop: null,
      window: { x: 100, y: 50, width: 1000, height: 500 }
    })
    assert.ok(mapped)
    // local = 200,200 in capture → 10% x, 20% y of window
    assert.equal(Math.round(mapped!.x), 100 + Math.round(0.1 * 1000))
    assert.equal(Math.round(mapped!.y), 50 + Math.round(0.2 * 500))
  })

  it('applies crop offset before mapping', () => {
    const mapped = mapLensPointToScreen({
      clientX: 0,
      clientY: 0,
      stageLeft: 0,
      stageTop: 0,
      scrollLeft: 0,
      scrollTop: 0,
      zoom: 1,
      captureWidth: 1000,
      captureHeight: 1000,
      crop: { x: 0.2, y: 0.1, width: 0.5, height: 0.5 },
      window: { x: 0, y: 0, width: 500, height: 500 }
    })
    assert.ok(mapped)
    assert.equal(Math.round(mapped!.captureX), 200)
    assert.equal(Math.round(mapped!.captureY), 100)
    assert.equal(Math.round(mapped!.x), 100)
    assert.equal(Math.round(mapped!.y), 50)
  })

  it('rejects clicks outside the cropped content', () => {
    const mapped = mapLensPointToScreen({
      clientX: 900,
      clientY: 10,
      stageLeft: 0,
      stageTop: 0,
      scrollLeft: 0,
      scrollTop: 0,
      zoom: 1,
      captureWidth: 800,
      captureHeight: 600,
      crop: null,
      window: { x: 0, y: 0, width: 800, height: 600 }
    })
    assert.equal(mapped, null)
  })
})

describe('lens-control helpers', () => {
  it('parses Electron window source ids', () => {
    assert.equal(parseCaptureWindowId('window:48291:0'), 48291)
    assert.equal(parseCaptureWindowId('screen:0:0'), null)
  })

  it('detects Finder owners', () => {
    assert.equal(isFinderOwner('Finder', 'Documents'), true)
    assert.equal(isFinderOwner('Other app', 'dist'), false)
    assert.equal(isFinderOwner('', '', 'com.apple.finder'), true)
  })

  it('detects Spotify owners', () => {
    assert.equal(isSpotifyOwner('Spotify', 'Spotify'), true)
    assert.equal(isSpotifyOwner('', '', 'com.spotify.client'), true)
    assert.equal(isSpotifyOwner('Google Chrome', 'Spotify Web Player'), false)
  })

  it('rejects unsafe paths', () => {
    assert.equal(sanitizeLensFilePath('/tmp/ok.txt'), '/tmp/ok.txt')
    assert.equal(sanitizeLensFilePath('../etc/passwd'), null)
    assert.equal(sanitizeLensFilePath(''), null)
  })
})
