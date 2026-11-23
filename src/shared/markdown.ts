/**
 * A small, safe Markdown subset for assistant answers: paragraphs, bullet and numbered lists,
 * ### headings, fenced code, `code`, **bold**, *italic*, and source citations like [S1] or [S1, S3].
 * Output is a plain tree rendered as React text nodes: no HTML is ever interpreted and links stay text.
 */

export type MdInline =
  | { t: 'text'; v: string }
  | { t: 'strong'; v: string }
  | { t: 'em'; v: string }
  | { t: 'code'; v: string }
  | { t: 'cite'; id: string }

export type MdBlock =
  | { type: 'p'; inline: MdInline[] }
  | { type: 'h'; inline: MdInline[] }
  | { type: 'ul'; items: MdInline[][] }
  | { type: 'ol'; items: MdInline[][] }
  | { type: 'code'; text: string }

const CITE = /\[(S\d{1,3}(?:\s*[,;]\s*S\d{1,3})*)\]/gi
const INLINE = /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(__[^_\n]+__)|(\*[^*\n]+\*)|(\[S\d{1,3}(?:\s*[,;]\s*S\d{1,3})*\])/gi

export function parseInline(text: string): MdInline[] {
  const out: MdInline[] = []
  let last = 0
  for (const m of text.matchAll(INLINE)) {
    const at = m.index ?? 0
    if (at > last) out.push({ t: 'text', v: text.slice(last, at) })
    const tok = m[0]
    if (m[1]) out.push({ t: 'code', v: tok.slice(1, -1) })
    else if (m[2] || m[3]) out.push({ t: 'strong', v: tok.slice(2, -2) })
    else if (m[4]) out.push({ t: 'em', v: tok.slice(1, -1) })
    else for (const id of tok.slice(1, -1).split(/[,;]/)) out.push({ t: 'cite', id: id.trim().toUpperCase() })
    last = at + tok.length
  }
  if (last < text.length) out.push({ t: 'text', v: text.slice(last) })
  return out
}

export function parseMarkdown(source: string): MdBlock[] {
  const lines = source.replace(/\r\n/g, '\n').split('\n')
  const blocks: MdBlock[] = []
  let para: string[] = []
  let list: { type: 'ul' | 'ol'; items: string[] } | null = null
  const flushPara = (): void => {
    if (para.length) blocks.push({ type: 'p', inline: parseInline(para.join('\n')) })
    para = []
  }
  const flushList = (): void => {
    if (list) blocks.push({ type: list.type, items: list.items.map(parseInline) })
    list = null
  }
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    if (/^\s*```/.test(line)) {
      flushPara()
      flushList()
      const body: string[] = []
      i++
      while (i < lines.length && !/^\s*```/.test(lines[i]!)) body.push(lines[i++]!)
      blocks.push({ type: 'code', text: body.join('\n') })
      continue
    }
    const bullet = /^\s*[-*•]\s+(.*)$/.exec(line)
    const numbered = /^\s*\d{1,3}[.)]\s+(.*)$/.exec(line)
    const heading = /^\s*#{1,6}\s+(.*)$/.exec(line)
    if (bullet || numbered) {
      flushPara()
      const type = bullet ? 'ul' : 'ol'
      if (list && list.type !== type) flushList()
      if (!list) list = { type, items: [] }
      list.items.push((bullet ?? numbered)![1]!)
      continue
    }
    if (heading) {
      flushPara()
      flushList()
      blocks.push({ type: 'h', inline: parseInline(heading[1]!) })
      continue
    }
    if (!line.trim()) {
      flushPara()
      flushList()
      continue
    }
    // A continuation line of a list item (indented) stays with the item.
    if (list && /^\s{2,}\S/.test(line)) {
      list.items[list.items.length - 1] += ' ' + line.trim()
      continue
    }
    flushList()
    para.push(line)
  }
  flushPara()
  flushList()
  return blocks
}

/** Citation ids used in a text ([S1], [S2, S4] …), in first-seen order. */
export function citedIds(text: string): string[] {
  const seen: string[] = []
  for (const m of text.matchAll(CITE)) {
    for (const id of m[1]!.split(/[,;]/)) {
      const clean = id.trim().toUpperCase()
      if (!seen.includes(clean)) seen.push(clean)
    }
  }
  return seen
}
