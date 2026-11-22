import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { APP_NAME, APP_VERSION, buildId, formatVersionLine } from './build-info.ts'

describe('build info', () => {
  it('formats a settings version line', () => {
    assert.equal(APP_NAME, 'MIKO')
    assert.match(APP_VERSION, /^\d+\.\d+\.\d+$/)
    assert.match(buildId('20261119T120000Z'), /20261119/)
    assert.match(formatVersionLine({ buildId: 'test', packaged: true }), /packaged/)
  })
})
