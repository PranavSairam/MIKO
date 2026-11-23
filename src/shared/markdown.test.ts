import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { citedIds, parseInline, parseMarkdown } from './markdown.ts'

describe('safe Markdown subset', () => {
  it('parses bullets, numbered lists, headings and code fences', () => {
    const blocks = parseMarkdown('### Plan\n- one\n- two\n\n1. first\n2. second\n\n```\nraw <b>\n```\nDone.')
    assert.deepEqual(
      blocks.map((b) => b.type),
      ['h', 'ul', 'ol', 'code', 'p']
    )
    assert.equal(blocks[3]!.type === 'code' && blocks[3]!.text, 'raw <b>')
  })

  it('keeps HTML as literal text', () => {
    const [p] = parseMarkdown('<img src=x onerror=alert(1)> hi')
    assert.deepEqual(p, { type: 'p', inline: [{ t: 'text', v: '<img src=x onerror=alert(1)> hi' }] })
  })

  it('parses bold, italic, code and citations', () => {
    assert.deepEqual(parseInline('**Due** *soon* `x` [S1, S3]'), [
      { t: 'strong', v: 'Due' },
      { t: 'text', v: ' ' },
      { t: 'em', v: 'soon' },
      { t: 'text', v: ' ' },
      { t: 'code', v: 'x' },
      { t: 'text', v: ' ' },
      { t: 'cite', id: 'S1' },
      { t: 'cite', id: 'S3' }
    ])
  })

  it('lists citation ids once, in order', () => {
    assert.deepEqual(citedIds('A [S2]. B [S1][S2]. C [s3; S1].'), ['S2', 'S1', 'S3'])
  })
})
