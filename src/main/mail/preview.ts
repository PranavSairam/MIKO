import type { MailMessage } from '../../shared/mail'

/**
 * Sample mailbox for development previews only (MIKO_MAIL_PREVIEW=1 in an
 * unpackaged build). Never shown in normal use; every subject is prefixed
 * so it cannot be mistaken for real mail.
 */

export const PREVIEW_ACCOUNTS = ['preview@example.com', 'work.preview@example.com']

const SENDERS = [
  ['Imran Khan', 'imran@example.org'],
  ['Asha Rao', 'asha@example.org'],
  ['Billing Team', 'billing@example.net'],
  ['Deals Weekly', 'deals@example.shop'],
  ['Priya Nair', 'priya@example.org']
]

const SUBJECTS = [
  ['Interview schedule for Thursday', 'Could you confirm the 3 pm slot for the interview?'],
  ['Invoice #442 overdue', 'Your invoice is overdue; payment was due last week.'],
  ['Please approve the trip budget', 'Needs your sign-off by Friday.'],
  ['Weekend sale ends tonight', '40% off everything, shop now.'],
  ['Notes from the FreshNet sync', 'Summary of what we decided on the FreshNet launch.'],
  ['Lunch?', 'Free on Tuesday?'],
  ['Report due Friday', 'Reminder: the quarterly report is due Friday.'],
  ['Your receipt', 'Thanks for your order.']
]

let cache: MailMessage[] | null = null

export function previewMessages(): MailMessage[] {
  if (cache) return cache
  const out: MailMessage[] = []
  const now = Date.UTC(2026, 10, 14, 9, 0)
  for (let i = 0; i < 34; i += 1) {
    const account = PREVIEW_ACCOUNTS[i % 3 === 2 ? 1 : 0]
    const [fromName, fromEmail] = SENDERS[i % SENDERS.length]
    const [subject, snippet] = SUBJECTS[i % SUBJECTS.length]
    const promo = subject.startsWith('Weekend sale')
    const update = subject.startsWith('Your receipt') || (subject.startsWith('Invoice') && i % 2 === 1)
    const labels = [
      'INBOX',
      ...(i % 2 === 0 ? ['UNREAD'] : []),
      ...(i % 7 === 0 ? ['IMPORTANT'] : []),
      ...(promo ? ['CATEGORY_PROMOTIONS'] : update ? ['CATEGORY_UPDATES'] : ['CATEGORY_PERSONAL'])
    ]
    const id = (0x18f0000000 + i * 4099).toString(16)
    out.push({
      key: `gmail:${account}:${id}`,
      provider: 'gmail',
      account,
      id,
      threadId: id,
      from: fromName,
      fromEmail,
      to: i % 4 === 3 ? `team@example.org` : `Me <${account}>`,
      cc: '',
      replyTo: fromEmail === 'billing@example.net' ? 'Billing Desk <billing-desk@example.net>' : '',
      subject: `[Sample] ${subject} (${i + 1})`,
      snippet,
      date: now - i * 3_600_000 * 5,
      unread: labels.includes('UNREAD'),
      labels,
      directToMe: i % 4 !== 3,
      html:
        i % 3 === 0
          ? `<div><p>Hello,</p><p>${snippet}</p><p><a href="https://example.org/x">Details</a></p><img src="https://example.org/track.png" width="1" height="1"><script>alert('x')</script><p onclick="steal()">Thanks</p></div>`
          : '',
      text: `Hello,\n\n${snippet}\n\nThanks,\n${fromName}`
    })
  }
  // An automated sender (no-reply) for the "may not accept replies" note.
  const auto = out[3]
  out[3] = {
    ...auto,
    from: 'Jobs Alerts',
    fromEmail: 'notifications-noreply@example.com',
    replyTo: '',
    subject: '[Sample] New jobs for you this week',
    snippet: '5 new jobs match your preferences.',
    text: 'Hello,\n\n5 new jobs match your preferences.\n\nYou are receiving this because you subscribed.',
    html: '',
    labels: ['INBOX', 'CATEGORY_UPDATES'],
    unread: false
  }
  // One message only findable by search beyond the first pages.
  const old = out[out.length - 1]
  out[out.length - 1] = {
    ...old,
    subject: '[Sample] Tax refund processed',
    snippet: 'Your tax refund has been processed.',
    text: 'Hello,\n\nYour tax refund has been processed.\n\nThanks',
    html: '',
    labels: ['INBOX'],
    unread: false
  }
  cache = out
  return out
}

/** Thread for a sample message: message 1 is a reply to an earlier sample sent by "me". */
export function previewThread(message: MailMessage): MailMessage[] {
  const first = previewMessages()[0]
  if (message.threadId !== first.threadId) return []
  const earlier: MailMessage = {
    ...first,
    key: `gmail:${first.account}:${first.id}0`,
    id: `${first.id}0`,
    from: 'Me',
    fromEmail: first.account,
    to: `${first.from} <${first.fromEmail}>`,
    subject: '[Sample] Interview availability',
    snippet: 'I can do Thursday afternoon.',
    text: 'Hi Imran,\n\nI can do Thursday afternoon, any time after 2 pm.\n\nThanks',
    html: '',
    date: first.date - 2 * 86_400_000,
    unread: false,
    labels: ['SENT']
  }
  return [earlier, first]
}

/** Tiny evaluator for the Gmail queries MIKO builds (terms, from:, is:unread, in:inbox, -in:spam/-in:trash). */
export function previewMatches(message: MailMessage, query: string): boolean {
  const tokens = query.match(/-?\w+:"[^"]*"|-?\w+:\S+|"[^"]*"|\S+/g) ?? []
  return tokens.every((token) => {
    const lower = token.toLowerCase()
    if (lower === 'in:inbox') return message.labels.includes('INBOX')
    if (lower === 'is:unread') return message.unread
    if (lower === '-in:spam' || lower === '-in:trash') return true
    if (lower === 'category:updates') return message.labels.includes('CATEGORY_UPDATES')
    if (lower === 'category:promotions') return message.labels.includes('CATEGORY_PROMOTIONS')
    const now = Date.UTC(2026, 10, 14, 9, 0)
    const days = /^(newer_than|older_than):(\d+)d$/.exec(lower)
    if (days) {
      const age = now - message.date
      return days[1] === 'newer_than' ? age <= Number(days[2]) * 86_400_000 : age > Number(days[2]) * 86_400_000
    }
    const on = /^(after|before):(\d{4})\/(\d{2})\/(\d{2})$/.exec(lower)
    if (on) {
      const t = Date.UTC(Number(on[2]), Number(on[3]) - 1, Number(on[4]))
      return on[1] === 'after' ? message.date >= t : message.date < t
    }
    if (lower.startsWith('subject:')) return message.subject.toLowerCase().includes(lower.slice(8).replace(/"/g, ''))
    if (lower.startsWith('from:')) {
      const who = lower.slice(5).replace(/"/g, '')
      return `${message.from} ${message.fromEmail}`.toLowerCase().includes(who)
    }
    const term = lower.replace(/"/g, '')
    return `${message.subject} ${message.snippet} ${message.from} ${message.text}`.toLowerCase().includes(term)
  })
}
