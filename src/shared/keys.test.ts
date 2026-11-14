import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'
import { parseKeyEvent } from './keys.ts'

describe('parseKeyEvent', () => {
  it('reads helper events', () => {
    assert.deepEqual(parseKeyEvent('{"event":"talk-start"}'), { kind: 'talk-start' })
    assert.deepEqual(parseKeyEvent('{"event":"talk-stop"}'), { kind: 'talk-stop' })
    assert.deepEqual(parseKeyEvent('{"event":"switcher"}'), { kind: 'switcher' })
  })
  it('reads a permission problem', () => {
    assert.deepEqual(parseKeyEvent('{"error":"permission"}'), { kind: 'permission' })
  })
  it('rejects anything else', () => {
    assert.equal(parseKeyEvent('garbage'), null)
    assert.equal(parseKeyEvent('{"event":"rm -rf"}'), null)
    assert.equal(parseKeyEvent(''), null)
    assert.equal(parseKeyEvent('[]'), null)
  })
})
