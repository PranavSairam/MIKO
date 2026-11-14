import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'
import { addChat, parseChatUrl, removeChat, renameChat, resolveChat, type SavedChat } from './chatgpt.ts'

describe('parseChatUrl', () => {
  it('accepts conversations, Projects and custom GPTs on chatgpt.com', () => {
    assert.deepEqual(parseChatUrl('https://chatgpt.com/c/6735a1b2-0c1d-8000-9e1f-0123456789ab'), {
      ok: true,
      kind: 'conversation',
      url: 'https://chatgpt.com/c/6735a1b2-0c1d-8000-9e1f-0123456789ab'
    })
    assert.equal(parseChatUrl('https://chatgpt.com/g/g-p-67a0b1c2d3e4-major-project/project').ok, true)
    assert.equal((parseChatUrl('https://chatgpt.com/g/g-p-67a0b1c2d3e4-major-project/project') as { kind: string }).kind, 'project')
    assert.equal((parseChatUrl('https://chatgpt.com/g/g-abc123XYZ-freshnet-helper') as { kind: string }).kind, 'gpt')
    assert.equal((parseChatUrl('https://chatgpt.com/g/g-p-67a0b1c2d3e4-x/c/6735a1b2-0c1d') as { kind: string }).kind, 'conversation')
  })
  it('drops query strings and fragments', () => {
    assert.deepEqual(parseChatUrl('  https://chatgpt.com/c/6735a1b2-0c1d?model=gpt#x  '), {
      ok: true,
      kind: 'conversation',
      url: 'https://chatgpt.com/c/6735a1b2-0c1d'
    })
  })
  it('rejects other hosts, http, credentials, ports and unsupported paths', () => {
    for (const bad of [
      'https://evil.com/c/6735a1b2-0c1d',
      'https://chatgpt.com.evil.com/c/6735a1b2-0c1d',
      'http://chatgpt.com/c/6735a1b2-0c1d',
      'https://user:pass@chatgpt.com/c/6735a1b2-0c1d',
      'https://chatgpt.com:8443/c/6735a1b2-0c1d',
      'https://chatgpt.com/settings',
      'https://chatgpt.com/',
      'javascript:alert(1)',
      'not a url'
    ]) {
      assert.equal(parseChatUrl(bad).ok, false, bad)
    }
  })
})

describe('saved chats', () => {
  const url = 'https://chatgpt.com/c/6735a1b2-0c1d'
  const list: SavedChat[] = [
    { name: 'FreshNet', url },
    { name: 'Major project', url: 'https://chatgpt.com/g/g-p-67a0b1c2d3e4-major/project' },
    { name: 'Major exam prep', url }
  ]
  it('adds, refusing duplicate names case-insensitively and bad URLs', () => {
    const added = addChat([], '  Freshnet  ', url)
    assert.equal(added.ok, true)
    assert.deepEqual(added.ok && added.list, [{ name: 'Freshnet', url }])
    const dup = addChat(list, 'freshnet', url)
    assert.equal(dup.ok, false)
    assert.match(!dup.ok ? dup.reason : '', /already/)
    assert.equal(addChat(list, 'New', 'https://example.com/c/1').ok, false)
    assert.equal(addChat(list, '   ', url).ok, false)
  })
  it('renames and removes', () => {
    const renamed = renameChat(list, 'freshnet', 'FreshNet v2')
    assert.equal(renamed.ok && renamed.list[0].name, 'FreshNet v2')
    assert.equal(renameChat(list, 'FreshNet', 'major project').ok, false)
    assert.equal(renameChat(list, 'FreshNet', 'freshnet').ok, true)
    const removed = removeChat(list, 'FRESHNET')
    assert.equal(removed.ok && removed.list.length, 2)
    assert.equal(removeChat(list, 'nope').ok, false)
  })
  it('resolves names, asking when ambiguous', () => {
    assert.deepEqual(resolveChat(list, 'freshnet'), { kind: 'one', chat: list[0] })
    assert.deepEqual(resolveChat(list, 'major project'), { kind: 'one', chat: list[1] })
    assert.deepEqual(resolveChat(list, 'major'), { kind: 'many', chats: [list[1], list[2]] })
    assert.deepEqual(resolveChat(list, 'biology'), { kind: 'none' })
  })
})
