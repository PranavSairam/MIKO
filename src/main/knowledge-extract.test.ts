import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { extractFile } from './knowledge-extract.ts'
import { chunkBlocks, KNOWLEDGE_LIMITS } from '../shared/knowledge.ts'

const dir = join(import.meta.dirname, '..', '..', 'test', 'fixtures', 'knowledge')
const f = (name: string): string => join(dir, name)

describe('document extraction (real files)', () => {
  it('reads plain text and hashes it', async () => {
    const r = await extractFile(f('falcon-status.txt'), 'txt')
    assert.equal(r.status, 'ok')
    assert.match(r.blocks.map((b) => b.text).join('\n'), /14 March 2027/)
    assert.match(r.hash, /^[0-9a-f]{64}$/)
  })

  it('reads Markdown and keeps headings for chunks', async () => {
    const r = await extractFile(f('handbook.md'), 'md')
    assert.equal(r.status, 'ok')
    const chunk = chunkBlocks(r.blocks).find((c) => c.text.includes('three days'))
    assert.equal(chunk?.heading, 'Remote work')
  })

  it('reads a text PDF page by page', async () => {
    const r = await extractFile(f('vendor-contract.pdf'), 'pdf')
    assert.equal(r.status, 'ok')
    assert.equal(r.pages, 3)
    const p2 = r.blocks.find((b) => b.page === 2)
    assert.match(p2?.text ?? '', /payable within 45 days/)
  })

  it('reports an image-only PDF as scanned (no OCR)', async () => {
    const r = await extractFile(f('scanned.pdf'), 'pdf')
    assert.equal(r.status, 'scanned')
    assert.match(r.detail, /OCR/)
  })

  it('reports a password-protected PDF', async () => {
    const r = await extractFile(f('locked.pdf'), 'pdf')
    assert.equal(r.status, 'encrypted')
  })

  it('reports a damaged PDF as unreadable', async () => {
    const r = await extractFile(f('corrupt.pdf'), 'pdf')
    assert.equal(r.status, 'unreadable')
  })

  it('reads DOCX with headings', async () => {
    const r = await extractFile(f('travel-policy.docx'), 'docx')
    assert.equal(r.status, 'ok')
    const chunk = chunkBlocks(r.blocks).find((c) => c.text.includes('$180'))
    assert.equal(chunk?.heading, 'Hotels')
  })

  it('reports password-protected or old Word files', async () => {
    const r = await extractFile(f('locked.docx'), 'docx')
    assert.equal(r.status, 'encrypted')
  })

  it('reports empty and binary files honestly', async () => {
    assert.equal((await extractFile(f('empty.txt'), 'txt')).status, 'empty')
    assert.equal((await extractFile(f('binary.txt'), 'txt')).status, 'unreadable')
  })

  it('refuses files over the size limit before reading them', async () => {
    const r = await extractFile(f('falcon-status.txt'), 'txt', { ...KNOWLEDGE_LIMITS, maxFileBytes: { ...KNOWLEDGE_LIMITS.maxFileBytes, txt: 10 } })
    assert.equal(r.status, 'too-large')
  })

  it('caps extracted text and says it was cut', async () => {
    const r = await extractFile(f('falcon-status.txt'), 'txt', { ...KNOWLEDGE_LIMITS, maxChars: 60 })
    assert.equal(r.status, 'ok')
    assert.equal(r.truncated, true)
    assert.ok(r.chars <= 60)
  })
})
