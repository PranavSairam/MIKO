import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'
import { arcSlots, filterApps, orderByWindows, parseRunning, parseTabs, type RunningApp } from './switcher.ts'

const app = (pid: number, name: string): RunningApp => ({ pid, name, bundleId: `b.${pid}`, path: `/A/${name}.app`, hidden: false, active: false })

describe('orderByWindows', () => {
  it('puts apps with windows first, front to back, then the rest by name', () => {
    const ordered = orderByWindows([app(1, 'A'), app(2, 'B'), app(3, 'C')], [3, 1])
    assert.deepEqual(ordered.map((item) => item.pid), [3, 1, 2])
  })
  it('ignores duplicate and unknown pids', () => {
    const ordered = orderByWindows([app(1, 'Zed'), app(2, 'Alpha')], [9, 1, 1])
    assert.deepEqual(ordered.map((item) => item.pid), [1, 2])
  })
})

describe('filterApps', () => {
  it('ranks prefix matches before substring matches, case-insensitive', () => {
    const found = filterApps([{ name: 'Google Chrome' }, { name: 'Chess' }, { name: 'Notes' }], 'CH')
    assert.deepEqual(found.map((item) => item.name), ['Chess', 'Google Chrome'])
  })
  it('returns everything for an empty query', () => {
    assert.equal(filterApps([{ name: 'A' }, { name: 'B' }], '  ').length, 2)
  })
})

describe('arcSlots', () => {
  it('lays out a symmetric single arc with the middle highest', () => {
    const slots = arcSlots(5, 700, 380)
    assert.equal(slots.length, 5)
    for (let i = 0; i < 5; i += 1) assert.ok(Math.abs(slots[i].x - 350 - (350 - slots[4 - i].x)) < 0.01)
    assert.ok(slots.every((slot) => slot.y >= slots[2].y))
  })
  it('uses two arcs for many apps', () => {
    const slots = arcSlots(20, 700, 380)
    assert.equal(slots.length, 20)
    assert.equal(new Set(slots.map((slot) => Math.round(slot.radius))).size, 2)
  })
  it('keeps a small hand of cards close together', () => {
    const few = arcSlots(3, 700, 380)
    const many = arcSlots(12, 700, 380)
    assert.ok(few[2].x - few[0].x < many[11].x - many[0].x)
    assert.ok(Math.abs(few[2].angle - few[0].angle) < Math.abs(many[11].angle - many[0].angle))
  })
  it('handles zero and one', () => {
    assert.deepEqual(arcSlots(0, 700, 380), [])
    assert.equal(arcSlots(1, 700, 380)[0].x, 350)
  })
})

describe('parsers', () => {
  it('drops malformed running rows', () => {
    assert.deepEqual(parseRunning('[{"pid":"x"}]'), [])
    assert.deepEqual(parseRunning('not json'), [])
    const ok = parseRunning('[{"pid":5,"name":"Notes","bundleId":"com.apple.Notes","path":"/A/Notes.app","hidden":false,"active":true}]')
    assert.equal(ok[0].pid, 5)
  })
  it('keeps good tab rows and drops rows without a url', () => {
    const tabs = parseTabs('[{"window":1,"tab":2,"title":"T","url":"https://a"},{"window":1,"tab":3,"title":"X"}]')
    assert.deepEqual(tabs, [{ window: 1, tab: 2, title: 'T', url: 'https://a' }])
  })
})
