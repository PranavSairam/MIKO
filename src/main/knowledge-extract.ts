import { createHash } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { KNOWLEDGE_LIMITS, formatBytes, type KnowledgeFileKind, type TextBlock } from '../shared/knowledge.ts'

/**
 * Text extraction for Knowledge. Runs inside the knowledge worker thread (never the UI) and can
 * also be called directly from tests. It reports what it found honestly: scanned (image-only)
 * PDFs, password-protected files, empty and unreadable files are statuses, not silent empties.
 * There is no OCR.
 */

export type ExtractStatus = 'ok' | 'empty' | 'scanned' | 'encrypted' | 'unreadable' | 'too-large' | 'unsupported'

export interface ExtractResult {
  status: ExtractStatus
  detail: string
  blocks: TextBlock[]
  /** sha256 of the original file bytes (stable identity for dedupe and change detection). */
  hash: string
  size: number
  pages?: number
  chars: number
  truncated: boolean
}

type Limits = typeof KNOWLEDGE_LIMITS

function result(status: ExtractStatus, detail: string, extra: Partial<ExtractResult> = {}): ExtractResult {
  return { status, detail, blocks: [], hash: '', size: 0, chars: 0, truncated: false, ...extra }
}

/** Keep the total extracted text within maxChars (cutting the last block). */
function capBlocks(blocks: TextBlock[], maxChars: number): { blocks: TextBlock[]; chars: number; truncated: boolean } {
  const out: TextBlock[] = []
  let chars = 0
  for (const b of blocks) {
    if (chars >= maxChars) return { blocks: out, chars, truncated: true }
    const room = maxChars - chars
    if (b.text.length > room) {
      out.push({ ...b, text: b.text.slice(0, room) })
      return { blocks: out, chars: maxChars, truncated: true }
    }
    out.push(b)
    chars += b.text.length
  }
  return { blocks: out, chars, truncated: false }
}

function decodeText(buf: Buffer): string | null {
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) return buf.subarray(2).toString('utf16le')
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
    const swapped = Buffer.from(buf.subarray(2))
    swapped.swap16()
    return swapped.toString('utf16le')
  }
  const sample = buf.subarray(0, 8192)
  let control = 0
  for (const byte of sample) if (byte === 0 || (byte < 9 && byte !== 0)) control += 1
  if (sample.length && control / sample.length > 0.01) return null
  return buf.toString('utf8').replace(/^﻿/, '')
}

async function extractPdf(buf: Buffer, limits: Limits): Promise<{ blocks: TextBlock[]; pages: number; status?: ExtractStatus; detail?: string }> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const task = pdfjs.getDocument({
    data: new Uint8Array(buf),
    disableFontFace: true,
    useSystemFonts: false,
    stopAtErrors: false,
    verbosity: 0
  })
  let doc: Awaited<typeof task.promise>
  try {
    doc = await task.promise
  } catch (error) {
    const name = (error as { name?: string })?.name ?? ''
    if (name === 'PasswordException') return { blocks: [], pages: 0, status: 'encrypted', detail: 'This PDF is password-protected. MIKO can’t read it.' }
    return { blocks: [], pages: 0, status: 'unreadable', detail: 'This PDF looks damaged or isn’t a real PDF.' }
  }
  const pages = doc.numPages
  const count = Math.min(pages, limits.maxPdfPages)
  const blocks: TextBlock[] = []
  let total = 0
  let badPages = 0
  for (let n = 1; n <= count; n++) {
    let text = ''
    try {
      const page = await doc.getPage(n)
      const content = await page.getTextContent()
      for (const item of content.items) {
        if (!('str' in item)) continue
        text += item.str
        text += item.hasEOL ? '\n' : ' '
      }
      page.cleanup()
    } catch {
      badPages += 1
      continue
    }
    text = text.replace(/[ ]+\n/g, '\n')
    total += text.replace(/\s/g, '').length
    if (text.trim()) blocks.push({ text, page: n })
    if (total > limits.maxChars * 1.2) break
  }
  await task.destroy().catch(() => undefined)
  if (badPages === count) return { blocks: [], pages, status: 'unreadable', detail: 'This PDF’s pages couldn’t be read (it may be damaged).' }
  // Almost no text across the pages: an image-only (scanned) PDF.
  if (total < Math.max(20, 8 * count)) {
    return {
      blocks: [],
      pages,
      status: 'scanned',
      detail: 'This PDF has no readable text (it looks scanned). MIKO doesn’t do OCR, so it can’t be searched.'
    }
  }
  const notes = [pages > count ? `Only the first ${count} of ${pages} pages were indexed.` : '', badPages ? `${badPages} page(s) couldn’t be read.` : '']
  return { blocks, pages, detail: notes.filter(Boolean).join(' ') }
}

interface MammothLike {
  convertToMarkdown?: (input: { buffer: Buffer }) => Promise<{ value: string }>
  extractRawText: (input: { buffer: Buffer }) => Promise<{ value: string }>
}

async function extractDocx(buf: Buffer): Promise<{ text: string; status?: ExtractStatus; detail?: string }> {
  if (buf.subarray(0, 8).equals(Buffer.from('D0CF11E0A1B11AE1', 'hex'))) {
    return { text: '', status: 'encrypted', detail: 'This Word file is password-protected or in the old .doc format. Save it as an unprotected .docx to add it.' }
  }
  if (buf[0] !== 0x50 || buf[1] !== 0x4b) return { text: '', status: 'unreadable', detail: 'This doesn’t look like a real .docx file.' }
  const mod = (await import('mammoth')) as unknown as MammothLike & { default?: MammothLike }
  const mammoth = mod.default ?? mod
  try {
    // Markdown keeps headings (they become chunk headings); fall back to raw text.
    if (mammoth.convertToMarkdown) {
      const md = await mammoth.convertToMarkdown({ buffer: buf })
      return { text: md.value.replace(/\\([\\`*_{}[\]()#+\-.!$])/g, '$1').replace(/__(.+?)__/g, '$1') }
    }
    return { text: (await mammoth.extractRawText({ buffer: buf })).value }
  } catch {
    return { text: '', status: 'unreadable', detail: 'This .docx file couldn’t be read (it may be damaged).' }
  }
}

export async function extractFile(path: string, kind: KnowledgeFileKind, limits: Limits = KNOWLEDGE_LIMITS): Promise<ExtractResult> {
  let size = 0
  try {
    const info = await stat(path)
    if (!info.isFile()) return result('unreadable', 'Not a file.')
    size = info.size
  } catch {
    return result('unreadable', 'The file couldn’t be opened (moved, deleted or no permission).')
  }
  const max = limits.maxFileBytes[kind]
  if (size > max) return result('too-large', `Too large (${formatBytes(size)}; the limit for this format is ${formatBytes(max)}).`, { size })
  if (size === 0) return result('empty', 'The file is empty.', { size })
  let buf: Buffer
  try {
    buf = await readFile(path)
  } catch {
    return result('unreadable', 'The file couldn’t be read (no permission?).', { size })
  }
  const hash = createHash('sha256').update(buf).digest('hex')
  let blocks: TextBlock[] = []
  let pages: number | undefined
  let note = ''
  if (kind === 'txt' || kind === 'md') {
    const text = decodeText(buf)
    if (text === null) return result('unreadable', 'This doesn’t look like a text file.', { size, hash })
    blocks = [{ text }]
  } else if (kind === 'pdf') {
    const out = await extractPdf(buf, limits)
    if (out.status) return result(out.status, out.detail ?? '', { size, hash, pages: out.pages })
    blocks = out.blocks
    pages = out.pages
    note = out.detail ?? ''
  } else {
    const out = await extractDocx(buf)
    if (out.status) return result(out.status, out.detail ?? '', { size, hash })
    blocks = [{ text: out.text }]
  }
  if (!blocks.some((b) => b.text.trim())) return result('empty', 'No text found in this file.', { size, hash, pages })
  const capped = capBlocks(blocks, limits.maxChars)
  const cut = capped.truncated ? `Only the first ${capped.chars.toLocaleString('en-US')} characters were indexed.` : ''
  return {
    status: 'ok',
    detail: [note, cut].filter(Boolean).join(' '),
    blocks: capped.blocks,
    hash,
    size,
    pages,
    chars: capped.chars,
    truncated: capped.truncated
  }
}
