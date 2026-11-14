import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'
import {
  DEFAULT_RULES,
  buildQuery,
  categorize,
  checkGoogleClient,
  inFilter,
  parseCorrections,
  classifyImportance,
  gmailQuery,
  mergeNewest,
  parseMailCommand,
  type MailSummary
} from './mail.ts'
import { decodeBase64Url, parseAddress, parseGmailMessage } from './gmail.ts'

const msg = (over: Partial<MailSummary> = {}): MailSummary => ({
  key: 'gmail:me@x.com:1',
  provider: 'gmail',
  account: 'me@x.com',
  id: '1',
  threadId: 't1',
  from: 'Imran',
  fromEmail: 'imran@co.com',
  to: 'me@x.com',
  subject: 'Hello',
  snippet: '',
  date: 1700000000000,
  unread: true,
  labels: ['INBOX', 'UNREAD'],
  directToMe: true,
  ...over
})

describe('parseMailCommand', () => {
  it('reads recent, unread and important intents', () => {
    for (const t of ['check mail', 'chk mail', 'Check my inbox.', 'recent mail', 'show my latest emails', 'latest emails'])
      assert.deepEqual(parseMailCommand(t), { kind: 'recent' }, t)
    assert.deepEqual(parseMailCommand('unread mail'), { kind: 'unread' })
    assert.deepEqual(parseMailCommand('show unread emails'), { kind: 'unread' })
    assert.deepEqual(parseMailCommand('important unread mail'), { kind: 'important', unreadOnly: true })
    assert.deepEqual(parseMailCommand('important mail'), { kind: 'important', unreadOnly: false })
  })
  it('reads searches', () => {
    assert.deepEqual(parseMailCommand('search mail invoice'), { kind: 'search', query: 'invoice' })
    assert.deepEqual(parseMailCommand('search my email for tax refund'), { kind: 'search', query: 'tax refund' })
    assert.deepEqual(parseMailCommand('emails from Imran'), { kind: 'search', query: 'from:Imran' })
    assert.deepEqual(parseMailCommand('Show mail from Imran Khan.'), { kind: 'search', query: 'from:"Imran Khan"' })
    assert.deepEqual(parseMailCommand('mail about interview'), { kind: 'search', query: 'interview' })
  })
  it('reads subject and date searches', () => {
    assert.deepEqual(parseMailCommand('mail with subject quarterly report'), { kind: 'search', query: 'subject:"quarterly report"' })
    assert.deepEqual(parseMailCommand('emails with subject invoice'), { kind: 'search', query: 'subject:invoice' })
    assert.deepEqual(parseMailCommand('emails from Imran last week'), { kind: 'search', query: 'from:Imran newer_than:7d' })
    assert.deepEqual(parseMailCommand('mail about interview today'), { kind: 'search', query: 'interview newer_than:1d' })
    assert.deepEqual(parseMailCommand('search mail invoice this month'), { kind: 'search', query: 'invoice newer_than:30d' })
    assert.deepEqual(parseMailCommand('search mail receipts before 2026-01-31'), { kind: 'search', query: 'receipts before:2026/01/31' })
    assert.deepEqual(parseMailCommand('emails from Asha after 2026/03/01'), { kind: 'search', query: 'from:Asha after:2026/03/01' })
    assert.deepEqual(parseMailCommand('mail from yesterday'), { kind: 'search', query: 'newer_than:2d older_than:1d' })
  })
  it('reads references to displayed results', () => {
    assert.deepEqual(parseMailCommand('open the second email'), { kind: 'open', index: 2 })
    assert.deepEqual(parseMailCommand('read email 3'), { kind: 'open', index: 3 })
    assert.deepEqual(parseMailCommand('open the last mail'), { kind: 'open', index: -1 })
    assert.deepEqual(parseMailCommand('open that email'), { kind: 'open', index: 0 })
  })
  it('sends mail questions to the mailbox, not the model', () => {
    assert.deepEqual(parseMailCommand('Do I have any unread emails?'), { kind: 'unread' })
    assert.deepEqual(parseMailCommand('any new mail?'), { kind: 'recent' })
    assert.deepEqual(parseMailCommand("What's in my inbox?"), { kind: 'recent' })
    assert.deepEqual(parseMailCommand('did I get any important emails?'), { kind: 'important', unreadOnly: false })
    assert.equal(parseMailCommand('how do I write a polite email?'), null)
  })
  it('parses tabs and reply commands', () => {
    assert.deepEqual(parseMailCommand('show action needed'), { kind: 'category', category: 'action' })
    assert.deepEqual(parseMailCommand('important fyi emails'), { kind: 'category', category: 'fyi' })
    assert.deepEqual(parseMailCommand('show promotions'), { kind: 'category', category: 'promotions' })
    assert.deepEqual(parseMailCommand('updates mail'), { kind: 'category', category: 'updates' })
    assert.deepEqual(parseMailCommand('reply to the second email'), { kind: 'reply', index: 2, instruction: '' })
    assert.deepEqual(parseMailCommand('Reply to email 3 saying I will send it tomorrow.'), { kind: 'reply', index: 3, instruction: 'I will send it tomorrow' })
    assert.deepEqual(parseMailCommand('reply to the last mail'), { kind: 'reply', index: -1, instruction: '' })
    assert.deepEqual(parseMailCommand('reply to this email'), { kind: 'reply', index: 0, instruction: '' })
    assert.deepEqual(parseMailCommand('draft a reply to the first email'), { kind: 'reply', index: 1, instruction: '' })
    assert.deepEqual(parseMailCommand('reply'), { kind: 'reply', index: 0, instruction: '' })
    assert.deepEqual(parseMailCommand('reply saying thursday works'), { kind: 'reply', index: 0, instruction: 'thursday works' })
    assert.deepEqual(parseMailCommand('cancel reply'), { kind: 'cancel-reply' })
    assert.deepEqual(parseMailCommand('discard the draft'), { kind: 'cancel-reply' })
    assert.equal(parseMailCommand('reply to the purple email'), null)
  })
  it('ignores app and other commands', () => {
    for (const t of ['open mail', 'open calculator', 'move left', 'ask gpt what is mail']) assert.equal(parseMailCommand(t), null, t)
  })
})

describe('gmailQuery', () => {
  it('limits tabs to the inbox; searches everywhere except spam and trash', () => {
    assert.equal(gmailQuery('all', ''), 'in:inbox')
    assert.equal(gmailQuery('unread', ''), 'in:inbox is:unread')
    assert.equal(gmailQuery('action', ''), 'in:inbox')
    assert.equal(gmailQuery('fyi', ''), 'in:inbox')
    assert.equal(gmailQuery('updates', ''), 'in:inbox category:updates')
    assert.equal(gmailQuery('promotions', ''), 'in:inbox category:promotions')
    assert.equal(gmailQuery('all', 'invoice'), 'invoice -in:spam -in:trash')
    assert.equal(gmailQuery('unread', 'from:Imran'), 'from:Imran is:unread -in:spam -in:trash')
    assert.equal(gmailQuery('promotions', 'sale'), 'sale category:promotions -in:spam -in:trash')
  })
})

describe('buildQuery', () => {
  it('turns Advanced search fields into Gmail operators', () => {
    assert.equal(buildQuery({ words: 'tax refund', from: 'Imran Khan', subject: 'invoice', after: '2026-01-31', before: '2026-03-01' }), 'tax refund from:"Imran Khan" subject:invoice after:2026/01/31 before:2026/03/01')
    assert.equal(buildQuery({ from: 'asha@example.org' }), 'from:asha@example.org')
    assert.equal(buildQuery({ after: '31/01/2026', words: ' ' }), '')
  })
})

describe('categorize', () => {
  it('uses Gmail categories, action cues and the importance flag, with reasons', () => {
    const promo = categorize(msg({ subject: 'Sale ends tonight, invoice inside', labels: ['INBOX', 'CATEGORY_PROMOTIONS'] }), DEFAULT_RULES)
    assert.deepEqual([promo.category, promo.certain, promo.source], ['promotions', true, 'gmail'])
    assert.equal(categorize(msg({ labels: ['INBOX', 'CATEGORY_UPDATES'], subject: 'Your order shipped' }), DEFAULT_RULES).category, 'updates')
    const bill = categorize(msg({ labels: ['INBOX', 'CATEGORY_UPDATES'], subject: 'Invoice #442 overdue' }), DEFAULT_RULES)
    assert.deepEqual([bill.category, bill.certain], ['action', false])
    const ask = categorize(msg({ subject: 'Report due Friday', snippet: 'Could you send it?' }), DEFAULT_RULES)
    assert.deepEqual([ask.category, ask.certain], ['action', true])
    assert.match(ask.reason, /Direct request/)
    assert.match(ask.reason, /Deadline/)
    const one = categorize(msg({ subject: 'Report due Friday' }), DEFAULT_RULES)
    assert.deepEqual([one.category, one.certain], ['action', false])
    const fyi = categorize(msg({ labels: ['INBOX', 'IMPORTANT'], subject: 'Notes from the sync' }), DEFAULT_RULES)
    assert.deepEqual([fyi.category, fyi.certain], ['fyi', true])
    assert.equal(categorize(msg({ subject: 'FreshNet launch' }), { ...DEFAULT_RULES, keywords: ['freshnet'] }).category, 'fyi')
    const other = categorize(msg({ subject: 'Lunch?' }), DEFAULT_RULES)
    assert.deepEqual([other.category, other.certain], ['other', false])
    assert.equal(categorize(msg({ snippet: 'Could you join?', directToMe: false }), DEFAULT_RULES).category, 'other')
  })
  it('applies the owner’s corrections, per message before per sender', () => {
    const m = msg({ subject: 'Lunch?' })
    const corrections = parseCorrections({ messages: { [m.key]: 'action' }, senders: { 'imran@co.com': 'promotions' } })
    assert.deepEqual(categorize(m, DEFAULT_RULES, corrections), { category: 'action', reason: 'You set this', certain: true, source: 'you' })
    assert.equal(categorize(msg({ key: 'gmail:me@x.com:2' }), DEFAULT_RULES, corrections).category, 'promotions')
  })
  it('drops malformed corrections', () => {
    assert.deepEqual(parseCorrections({ messages: { bad: 'action', 'gmail:me@x.com:1': 'nope' }, senders: { 'Upper@X.com': 'fyi', 'a@b.c': 'fyi' } }), {
      messages: {},
      senders: { 'a@b.c': 'fyi' }
    })
  })
  it('keeps every message in All mail and Unread by state', () => {
    assert.equal(inFilter('all', msg(), 'other'), true)
    assert.equal(inFilter('unread', msg({ unread: false }), 'action'), false)
    assert.equal(inFilter('action', msg(), 'fyi'), false)
  })
})

describe('classifyImportance', () => {
  it('uses the Gmail flag first, then transparent rules with reasons', () => {
    assert.deepEqual(classifyImportance(msg({ labels: ['INBOX', 'IMPORTANT'] }), DEFAULT_RULES), {
      important: true,
      source: 'provider',
      reasons: ['Gmail marked it important']
    })
    const due = classifyImportance(msg({ subject: 'Report due Friday' }), DEFAULT_RULES)
    assert.equal(due.important, true)
    assert.equal(due.source, 'rules')
    assert.match(due.reasons[0], /deadline/i)
    assert.match(classifyImportance(msg({ snippet: 'Could you review the draft?' }), DEFAULT_RULES).reasons[0], /request/i)
    assert.match(classifyImportance(msg({ subject: 'Please approve the budget' }), DEFAULT_RULES).reasons.join(' '), /approval/i)
    assert.match(classifyImportance(msg({ subject: 'Invoice #442 overdue' }), DEFAULT_RULES).reasons.join(' '), /payment/i)
  })
  it('skips promotions and indirect requests, and respects switched-off rules', () => {
    assert.equal(classifyImportance(msg({ subject: 'Sale ends Friday, invoice inside', labels: ['INBOX', 'CATEGORY_PROMOTIONS'] }), DEFAULT_RULES).important, false)
    assert.equal(classifyImportance(msg({ snippet: 'Could you join?', directToMe: false }), DEFAULT_RULES).important, false)
    assert.equal(classifyImportance(msg({ subject: 'Report due Friday' }), { ...DEFAULT_RULES, deadlines: false }).important, false)
    assert.equal(classifyImportance(msg({ labels: ['INBOX', 'IMPORTANT'] }), { ...DEFAULT_RULES, providerFlag: false }).important, false)
    assert.match(classifyImportance(msg({ subject: 'FreshNet launch' }), { ...DEFAULT_RULES, keywords: ['freshnet'] }).reasons[0], /freshnet/i)
  })
})

describe('mergeNewest', () => {
  it('merges accounts newest first and keeps the rest buffered', () => {
    const a = [msg({ key: 'a1', date: 50 }), msg({ key: 'a2', date: 10 })]
    const b = [msg({ key: 'b1', date: 40 }), msg({ key: 'b2', date: 30 })]
    const out = mergeNewest({ a, b }, 3)
    assert.deepEqual(out.take.map((m) => m.key), ['a1', 'b1', 'b2'])
    assert.deepEqual(out.rest.a.map((m) => m.key), ['a2'])
    assert.deepEqual(out.rest.b, [])
  })
})

describe('Gmail parsing', () => {
  it('decodes base64url and addresses', () => {
    assert.equal(decodeBase64Url('SGVsbG8sIOS4lueVjA'), 'Hello, 世界')
    assert.deepEqual(parseAddress('"Khan, Imran" <imran@co.com>'), { name: 'Khan, Imran', email: 'imran@co.com' })
    assert.deepEqual(parseAddress('plain@x.com'), { name: '', email: 'plain@x.com' })
  })
  it('builds a message with html and text bodies, scoped key, and direct-to-me', () => {
    const raw = {
      id: 'm1',
      threadId: 't1',
      labelIds: ['INBOX', 'UNREAD'],
      snippet: 'Hi &amp; hello',
      internalDate: '1700000000000',
      payload: {
        mimeType: 'multipart/alternative',
        headers: [
          { name: 'From', value: 'Imran <imran@co.com>' },
          { name: 'To', value: 'Me <ME@x.com>, team@x.com' },
          { name: 'Cc', value: 'boss@x.com' },
          { name: 'Subject', value: 'Plan' }
        ],
        parts: [
          { mimeType: 'text/plain', body: { data: 'SGk' } },
          { mimeType: 'text/html', body: { data: 'PGI-SGk8L2I-' } }
        ]
      }
    }
    const m = parseGmailMessage(raw, 'me@x.com')
    assert.equal(m.key, 'gmail:me@x.com:m1')
    assert.equal(m.unread, true)
    assert.equal(m.snippet, 'Hi & hello')
    assert.equal(m.directToMe, true)
    assert.equal(m.text, 'Hi')
    assert.equal(m.html, '<b>Hi</b>')
    assert.equal(m.cc, 'boss@x.com')
    assert.equal(m.date, 1700000000000)
  })
})

describe('checkGoogleClient', () => {
  it('accepts a Desktop app client id and secret', () => {
    assert.deepEqual(checkGoogleClient(' 123456789012-abc123def456.apps.googleusercontent.com ', ' GOCSPX-AbC_12-xyz '), {
      ok: true,
      clientId: '123456789012-abc123def456.apps.googleusercontent.com',
      clientSecret: 'GOCSPX-AbC_12-xyz'
    })
  })
  it('rejects anything that is not a Google OAuth client', () => {
    assert.equal(checkGoogleClient('my-client', 'GOCSPX-x').ok, false)
    assert.equal(checkGoogleClient('123-abc.apps.googleusercontent.com.evil.com', 'GOCSPX-x').ok, false)
    assert.equal(checkGoogleClient('123-abc.apps.googleusercontent.com', '').ok, false)
    assert.equal(checkGoogleClient('123-abc.apps.googleusercontent.com', 'has spaces inside').ok, false)
  })
})
