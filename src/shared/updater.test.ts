import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  UPDATE_CHANNEL,
  emptyUpdateStatus,
  isNewerVersion,
  parseLatestManifest,
  SETTINGS_SCHEMA_VERSION
} from './updater.ts'

describe('updater shared types', () => {
  it('defaults to the private beta channel and manual-friendly empty status', () => {
    assert.equal(UPDATE_CHANNEL, 'beta')
    assert.equal(SETTINGS_SCHEMA_VERSION, 2)
    const s = emptyUpdateStatus({ currentVersion: '0.1.0' })
    assert.equal(s.channel, 'beta')
    assert.equal(s.phase, 'idle')
    assert.equal(s.mode, 'manual')
    assert.equal(s.unsigned, true)
    assert.equal(s.currentVersion, '0.1.0')
  })

  it('compares dotted versions for manual latest.json checks', () => {
    assert.equal(isNewerVersion('0.1.1', '0.1.0'), true)
    assert.equal(isNewerVersion('0.1.0', '0.1.0'), false)
    assert.equal(isNewerVersion('0.1.0', '0.1.1'), false)
    assert.equal(isNewerVersion('0.2.0', '0.1.9'), true)
  })

  it('parses latest.json manifests and rejects bad shapes', () => {
    assert.deepEqual(parseLatestManifest({ version: '0.1.2', downloadUrl: 'https://example.com/a.dmg' }), {
      version: '0.1.2',
      downloadUrl: 'https://example.com/a.dmg'
    })
    assert.equal(parseLatestManifest({ version: '0.1.2' }), null)
    assert.equal(parseLatestManifest({ version: '0.1.2', downloadUrl: 'ftp://nope' }), null)
  })
})
