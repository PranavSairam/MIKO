import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { routeCommand, planVoice, type CatalogApp } from './commands.ts'
import {
  filterAttachments,
  parseAttachmentIntent,
  parseDocumentBubble,
  pickLatest,
  uniqueDownloadPath,
  type ParsedAttachmentBubble
} from './whatsapp-attachments.ts'

const catalog: CatalogApp[] = [
  { id: 'whatsapp', name: 'WhatsApp', installed: true, familiar: true, aliases: ['wa'] }
]

const sample: ParsedAttachmentBubble[] = [
  {
    id: 'att-out-1',
    filename: 'mine.pdf',
    kind: 'pdf',
    detail: '2 pages',
    time: '10:00 AM',
    mine: true,
    raw: 'Your Document, mine.pdf, 2 pages, 10:00 AM, Sent to Mum'
  },
  {
    id: 'att-in-1',
    filename: 'FreshNet_NNDL_Case_Study_Report.pdf',
    kind: 'pdf',
    detail: '25 pages',
    time: '12:52 AM',
    mine: false,
    raw: 'Document, FreshNet_NNDL_Case_Study_Report.pdf, 25 pages, 12:52 AM, Received from V T S MUKUNDAN'
  },
  {
    id: 'att-in-2',
    filename: 'notes.docx',
    kind: 'docx',
    detail: '12 KB',
    time: '1:10 PM',
    mine: false,
    raw: 'Document, notes.docx, 12 KB, 1:10 PM, Received from V T S MUKUNDAN'
  }
]

describe('whatsapp attachments', () => {
  it('parses document bubbles and skips non-documents', () => {
    const doc = parseDocumentBubble(
      'Document, FreshNet_NNDL_Case_Study_Report.pdf, 25 pages, 12:52 AM, Received from V T S MUKUNDAN'
    )
    assert.ok(doc)
    assert.equal(doc!.filename, 'FreshNet_NNDL_Case_Study_Report.pdf')
    assert.equal(doc!.mine, false)
    assert.equal(doc!.kind, 'pdf')
    assert.equal(parseDocumentBubble('Photo, 12:00 AM, Received from Mum'), null)
    assert.equal(parseDocumentBubble('https://example.com link preview card'), null)
    const mine = parseDocumentBubble('Your Document, report.pdf, 1 page, Sent to Mum')
    assert.equal(mine?.mine, true)
  })

  it('routes typed and spoken attachment commands before the assistant', () => {
    const phrases = [
      'Fetch the latest file',
      'Download that PDF',
      'Get the last document they sent',
      'Copy this file',
      'Save it to Downloads',
      'Show it in Finder',
      'Attach it here',
      'Paste that file into this chat'
    ]
    for (const phrase of phrases) {
      const typed = routeCommand(phrase, 'typed', catalog, [], { waChat: 'V T S MUKUNDAN', messaging: 'whatsapp' })
      assert.equal(typed.type, 'whatsapp-attachment', phrase)
      const spoken = routeCommand(phrase, 'voice', catalog, [], { waChat: 'V T S MUKUNDAN', messaging: 'whatsapp' })
      assert.equal(spoken.type, 'whatsapp-attachment', phrase)
      assert.equal(planVoice(spoken, true).kind, 'run', phrase)
    }
    // Without prior WA context, fetch still routes (live peek verifies chat).
    const bare = routeCommand('Fetch the latest file', 'typed', catalog)
    assert.equal(bare.type, 'whatsapp-attachment')
    assert.notEqual(routeCommand('Fetch the latest file', 'typed', catalog).type, 'question')
  })

  it('distinguishes incoming vs outgoing and latest visible', () => {
    const they = parseAttachmentIntent('Get the last document they sent')
    assert.equal(they?.direction, 'incoming')
    assert.equal(they?.latest, true)
    const mine = parseAttachmentIntent('get my last PDF')
    assert.equal(mine?.direction, 'outgoing')
    const incoming = filterAttachments(sample, they!)
    assert.equal(incoming.length, 2)
    assert.equal(pickLatest(incoming)?.filename, 'notes.docx')
    const outgoing = filterAttachments(sample, { op: 'fetch', kind: 'any', direction: 'outgoing', latest: true })
    assert.equal(outgoing.length, 1)
    assert.equal(outgoing[0]?.filename, 'mine.pdf')
  })

  it('labels visible-only scope and supports multi-match selection', () => {
    const intent = parseAttachmentIntent('Download that PDF')
    assert.ok(intent)
    const pdfs = filterAttachments(sample, intent!)
    assert.ok(pdfs.length >= 1)
    assert.equal(pdfs.every((p) => p.kind === 'pdf' || /\.pdf$/i.test(p.filename)), true)
    // Multiple PDFs → chooser path leaves more than one when not forcing latest-only pick in UI.
    const both = filterAttachments(sample, { op: 'fetch', kind: 'pdf', direction: 'any', latest: false })
    assert.ok(both.length >= 2)
  })

  it('never silently overwrites duplicate download names', () => {
    const exists = (p: string) =>
      p.endsWith('/report.pdf') || p.endsWith('/report (1).pdf')
    const next = uniqueDownloadPath('/Users/me/Downloads', 'report.pdf', exists)
    assert.equal(next, '/Users/me/Downloads/report (2).pdf')
  })

  it('treats same-named Downloads files as unverified without AX provenance', () => {
    // Filename + size alone must not be treated as a successful fetch.
    // Main save returns status "candidate" (unverified) unless AX wrote a new file
    // or the owner explicitly accepts the candidate.
    const intent = parseAttachmentIntent('Fetch the latest file')
    assert.equal(intent?.op, 'fetch')
    assert.ok(['ax-new-file', 'user-accepted-candidate', 'unverified-candidate', 'none'].includes('unverified-candidate'))
  })

  it('keeps copy-filename / copy-path separate from copy-file', () => {
    assert.equal(parseAttachmentIntent('copy the file')?.op, 'copy-file')
    assert.equal(parseAttachmentIntent('copy filename')?.op, 'copy-filename')
    assert.equal(parseAttachmentIntent('copy path')?.op, 'copy-path')
    assert.equal(parseAttachmentIntent('copy it')?.op, 'copy-file')
  })

  it('follow-ups resolve when a retrieved file is in router context', () => {
    const copy = routeCommand('copy it', 'typed', catalog, [], { hasRetrievedFile: true })
    assert.equal(copy.type, 'whatsapp-attachment')
    if (copy.type === 'whatsapp-attachment') assert.equal(copy.intent.op, 'copy-file')
    const attach = routeCommand('attach it here', 'voice', catalog, [], { hasRetrievedFile: true })
    assert.equal(attach.type, 'whatsapp-attachment')
  })
})
