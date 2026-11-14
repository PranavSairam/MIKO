import { useCallback, useEffect, useRef, useState } from 'react'
import type { ImportanceRules, ListedMail, MailCategory, MailCorrections, MailFilter, MailMessage, MailStatusInfo, ThreadEntry } from '../../../shared/api'
import { CATEGORY_LABELS, EMPTY_CORRECTIONS, categorize, type MailIntent } from '../../../shared/mail'
import { bodyText, draftPrompt, missingDetail, parseDraft, replyContext, replyRecipient, replySubject, type DraftRequest } from '../../../shared/mail-reply'

const SEARCH_DEBOUNCE_MS = 350
/** Text that starts like a command waits for Enter instead of live-searching (so "reply to the second email" keeps the results it refers to). */
const COMMAND_LEAD = /^(?:reply|respond|answer|open|read|cancel|discard|draft|write|show|check|chk|search|find|look)\b/i

export interface ReplyTarget {
  key: string
  account: string
  threadId: string
  /** Display: "Name <email>" or just the email. */
  to: string
  toEmail: string
  subject: string
  original: { subject: string; from: string; date: number }
}

export interface ReplyState {
  target: ReplyTarget
  /** The email context offered to the model; the owner can trim it. */
  context: string
  /** The owner has sent the context at least once (the first-draft notice is done). */
  reviewed: boolean
  instruction: string
  draft: string
  followUp: string
  question: string
  answer: string
  status: 'idle' | 'drafting' | 'done' | 'question' | 'failed'
  error: string
  requestId: string
  /** The last request, for Regenerate. */
  last: DraftRequest | null
  drafts: number
}

export interface MailState {
  status: MailStatusInfo | null
  account: string
  filter: MailFilter
  unreadOnly: boolean
  /** What's in the search box. */
  query: string
  /** The query the current results are for. */
  activeQuery: string
  items: ListedMail[]
  done: boolean
  loading: boolean
  error: string
  reconnect: string[]
  notice: string
  connecting: boolean
  reading: { key: string; message: MailMessage | null; thread: ThreadEntry[]; loading: boolean; error: string } | null
  rules: ImportanceRules | null
  corrections: MailCorrections
  reply: ReplyState | null
}

export interface MailActions {
  refreshStatus: () => Promise<MailStatusInfo | null>
  connect: (hint?: string) => Promise<void>
  disconnect: (email: string) => Promise<void>
  setAccount: (account: string) => void
  setFilter: (filter: MailFilter, unreadOnly?: boolean) => void
  setQuery: (query: string) => void
  /** Run a search right away (Advanced search, commands). */
  search: (query: string) => void
  clearSearch: () => void
  loadMore: () => void
  refresh: () => void
  open: (key: string) => void
  back: () => void
  openOriginal: (key: string) => Promise<void>
  copyMessage: () => Promise<void>
  saveRules: (rules: ImportanceRules) => Promise<void>
  correct: (m: ListedMail | MailMessage, category: MailCategory | null, scope: 'message' | 'sender') => Promise<void>
  /** Apply a chat/voice mail intent. Returns a short line for the panel. */
  applyIntent: (intent: MailIntent) => string
  rememberScroll: (top: number) => void
  scrollTop: () => number
  // Reply mode
  startReply: (key: string, instruction?: string) => void
  setReply: (patch: Partial<Pick<ReplyState, 'context' | 'instruction' | 'draft' | 'followUp' | 'answer'>>) => void
  resetContext: () => void
  draftReply: () => Promise<void>
  refine: (change: string) => Promise<void>
  regenerate: () => Promise<void>
  answerQuestion: () => Promise<void>
  stopDrafting: () => void
  cancelReply: () => void
  copyReply: () => Promise<void>
  /** Dictated text goes into the reply box. Returns false when no reply is open. */
  dictate: (text: string) => boolean
  replyActive: () => boolean
}

/** Local date with the time zone, as the owner reads it. */
function localDate(ms: number): string {
  return new Date(ms).toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' })
}

function newRequestId(): string {
  return `mr-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function targetFor(message: MailMessage): ReplyTarget {
  const to = replyRecipient(message)
  return {
    key: message.key,
    account: message.account,
    threadId: message.threadId,
    to: to.name ? `${to.name} <${to.email}>` : to.email,
    toEmail: to.email,
    subject: replySubject(message.subject),
    original: { subject: message.subject, from: message.from, date: message.date }
  }
}

export function useMail(): [MailState, MailActions] {
  const [status, setStatus] = useState<MailStatusInfo | null>(null)
  const [account, setAccountState] = useState('all')
  const [filter, setFilterState] = useState<MailFilter>('all')
  const [unreadOnly, setUnreadOnly] = useState(false)
  const [query, setQueryState] = useState('')
  const [activeQuery, setActiveQuery] = useState('')
  const [items, setItems] = useState<ListedMail[]>([])
  const [done, setDone] = useState(true)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [reconnect, setReconnect] = useState<string[]>([])
  const [notice, setNotice] = useState('')
  const [connecting, setConnecting] = useState(false)
  const [reading, setReading] = useState<MailState['reading']>(null)
  const [rules, setRules] = useState<ImportanceRules | null>(null)
  const [corrections, setCorrections] = useState<MailCorrections>(EMPTY_CORRECTIONS)
  const [reply, setReplyState] = useState<ReplyState | null>(null)
  const seq = useRef(0)
  const listId = useRef('')
  const debounce = useRef<number | null>(null)
  const scroll = useRef(0)
  const itemsRef = useRef<ListedMail[]>([])
  itemsRef.current = items
  const statusRef = useRef<MailStatusInfo | null>(null)
  statusRef.current = status
  const readingRef = useRef<MailState['reading']>(null)
  readingRef.current = reading
  const replyRef = useRef<ReplyState | null>(null)
  replyRef.current = reply
  const rulesRef = useRef<ImportanceRules | null>(null)
  rulesRef.current = rules
  /** A reply asked for before its message finished loading. */
  const pendingReply = useRef<{ key: string; instruction: string } | null>(null)
  const params = useRef({ account, filter, unreadOnly, activeQuery })
  params.current = { account, filter, unreadOnly, activeQuery }

  const refreshStatus = useCallback(async () => {
    const next = await window.miko.mailStatus()
    setStatus(next)
    return next
  }, [])

  /** Load the first page for the current parameters. Responses for older requests are dropped. */
  const load = useCallback(async (more: boolean, override?: Partial<typeof params.current>) => {
    const p = { ...params.current, ...override }
    const current = more ? seq.current : ++seq.current
    if (!more) {
      listId.current = `l${current}`
      scroll.current = 0
    }
    setLoading(true)
    setError('')
    const result = await window.miko.mailList({
      listId: listId.current,
      more,
      filter: p.filter,
      query: p.activeQuery,
      account: p.account,
      unreadOnly: p.unreadOnly
    })
    if (current !== seq.current) return // stale: the query or filter changed meanwhile
    setLoading(false)
    if (!result) {
      setError('Mail isn’t available.')
      return
    }
    setItems((prev) => (more ? [...prev, ...result.items.filter((m) => !prev.some((x) => x.key === m.key))] : result.items))
    setDone(result.done)
    setReconnect(result.errors.filter((e) => e.kind === 'reconnect').map((e) => e.account))
    const other = result.errors.find((e) => e.kind === 'error')
    if (other) setError(other.message)
  }, [])

  useEffect(() => {
    void Promise.all([
      refreshStatus(),
      window.miko.mailRules().then(setRules),
      window.miko.mailCorrections().then((c) => c && setCorrections(c))
    ]).then(([next]) => {
      if (next && next.accounts.length) void load(false)
    })
  }, [refreshStatus, load])

  const patchReply = useCallback((patch: Partial<ReplyState>) => {
    setReplyState((prev) => (prev ? { ...prev, ...patch } : prev))
  }, [])

  // Draft results from MIKO's assistant (only for the current reply request).
  useEffect(() => {
    return window.miko.onBridge((u) => {
      const current = replyRef.current
      if (!current || u.requestId !== current.requestId) return
      if (u.phase === 'running') return
      if (u.phase !== 'done') {
        patchReply({ status: 'failed', error: u.reason || 'The draft didn’t finish.' })
        return
      }
      const result = parseDraft(u.reply ?? '')
      if (result.kind === 'question') patchReply({ status: 'question', question: result.text, answer: '', reviewed: true })
      else if (result.kind === 'draft') patchReply({ status: 'done', draft: result.text, question: '', reviewed: true, drafts: current.drafts + 1, followUp: '' })
      else patchReply({ status: 'failed', error: 'MIKO returned an empty draft. Try Regenerate.' })
    })
  }, [patchReply])

  // Bind a requested reply once its message has loaded.
  useEffect(() => {
    const pending = pendingReply.current
    if (!pending || !reading || reading.key !== pending.key) return
    if (reading.loading) return
    pendingReply.current = null
    if (!reading.message) return
    const message = reading.message
    setReplyState({
      target: targetFor(message),
      context: replyContext(message, reading.thread, localDate),
      reviewed: false,
      instruction: pending.instruction,
      draft: '',
      followUp: '',
      question: '',
      answer: '',
      status: 'idle',
      error: '',
      requestId: '',
      last: null,
      drafts: 0
    })
  }, [reading])

  const setQuery = useCallback(
    (next: string) => {
      setQueryState(next)
      if (debounce.current) window.clearTimeout(debounce.current)
      debounce.current = null
      if (COMMAND_LEAD.test(next.trim())) return
      debounce.current = window.setTimeout(() => {
        debounce.current = null
        setActiveQuery(next.trim())
        setReading(null)
        void load(false, { activeQuery: next.trim() })
      }, SEARCH_DEBOUNCE_MS)
    },
    [load]
  )

  const runSearchNow = useCallback(
    (next: string) => {
      if (debounce.current) window.clearTimeout(debounce.current)
      setQueryState(next)
      setActiveQuery(next)
      setReading(null)
      void load(false, { activeQuery: next })
    },
    [load]
  )

  const setFilter = useCallback(
    (next: MailFilter, unread = false) => {
      setFilterState(next)
      setUnreadOnly(unread)
      setReading(null)
      void load(false, { filter: next, unreadOnly: unread })
    },
    [load]
  )

  const open = useCallback((key: string) => {
    if (readingRef.current?.key === key && readingRef.current.message) {
      // Already open: re-run the binding effect for a pending reply.
      setReading({ ...readingRef.current })
      return
    }
    setReading({ key, message: null, thread: [], loading: true, error: '' })
    void window.miko.mailRead(key).then((result) => {
      setReading((prev) => {
        if (!prev || prev.key !== key) return prev
        if (result.ok) return { key, message: result.message, thread: result.thread ?? [], loading: false, error: '' }
        if (result.reconnect) setReconnect((r) => (r.includes(result.reconnect as string) ? r : [...r, result.reconnect as string]))
        return { key, message: null, thread: [], loading: false, error: result.reason }
      })
    })
  }, [])

  const startReply = useCallback(
    (key: string, instruction = '') => {
      const current = replyRef.current
      if (current && current.target.key === key) {
        if (instruction) patchReply({ instruction })
        if (readingRef.current?.key !== key) open(key)
        return
      }
      if (current?.status === 'drafting') window.miko.bridgeCancel(current.requestId)
      setReplyState(null)
      pendingReply.current = { key, instruction }
      open(key)
    },
    [open, patchReply]
  )

  /** Send a draft request to MIKO's background assistant (one-off; never the main conversation). */
  const send = useCallback(
    async (req: DraftRequest) => {
      const status = await window.miko.bridgeStatus()
      if (!status?.enabled) {
        patchReply({ status: 'failed', error: 'MIKO assistant is off. Turn it on in the paw menu to draft replies.' })
        return
      }
      if (!status.available || !status.signedIn) {
        patchReply({ status: 'failed', error: status.available ? 'Sign in to ChatGPT in the ChatGPT app first.' : 'The ChatGPT app’s Codex CLI wasn’t found.' })
        return
      }
      if (status.busy) {
        patchReply({ status: 'failed', error: 'MIKO is still answering something else. Wait for it, then try again.' })
        return
      }
      const requestId = newRequestId()
      patchReply({ status: 'drafting', requestId, error: '', question: '', last: req })
      const sent = await window.miko.bridgeSend(requestId, draftPrompt(req), { fresh: true })
      if (!sent.ok) {
        setReplyState((prev) => (prev && prev.requestId === requestId ? { ...prev, status: 'failed', error: sent.reason } : prev))
      }
    },
    [patchReply]
  )

  const baseRequest = (r: ReplyState): DraftRequest => ({
    account: r.target.account,
    to: r.target.to,
    subject: r.target.subject,
    context: r.context,
    instruction: r.instruction.trim()
  })

  const stopDrafting = useCallback(() => {
    const r = replyRef.current
    if (!r || r.status !== 'drafting') return
    window.miko.bridgeCancel(r.requestId)
    patchReply({ status: r.draft ? 'done' : 'idle', requestId: '', error: 'Drafting stopped.' })
  }, [patchReply])

  const cancelReply = useCallback(() => {
    const r = replyRef.current
    if (r?.status === 'drafting') window.miko.bridgeCancel(r.requestId)
    const pending = pendingReply.current
    pendingReply.current = null
    setReplyState(null)
    if (r || pending) setNotice('Reply cancelled. Nothing was sent.')
  }, [])

  const actions: MailActions = {
    refreshStatus,
    connect: async (hint) => {
      setConnecting(true)
      setNotice('Finish signing in to Google in your browser…')
      const result = await window.miko.mailConnect(hint)
      setConnecting(false)
      setNotice(result.ok ? `Connected ${result.email} (read-only).` : result.reason)
      const next = await refreshStatus()
      if (result.ok && next?.accounts.length) void load(false)
    },
    disconnect: async (email) => {
      const ok = await window.miko.mailDisconnect(email)
      setNotice(ok ? `Disconnected ${email}.` : `Couldn’t disconnect ${email}.`)
      if (params.current.account === email) setAccountState('all')
      if (replyRef.current?.target.account === email) cancelReply()
      const next = await refreshStatus()
      setReading(null)
      if (next?.accounts.length) void load(false, { account: 'all' })
      else setItems([])
    },
    setAccount: (next) => {
      setAccountState(next)
      setReading(null)
      void load(false, { account: next })
    },
    setFilter,
    setQuery,
    search: runSearchNow,
    clearSearch: () => runSearchNow(''),
    loadMore: () => void load(true),
    refresh: () => {
      setReading(null)
      void load(false)
    },
    open,
    back: () => setReading(null),
    openOriginal: async (key) => {
      const ok = await window.miko.mailOpenOriginal(key)
      setNotice(ok ? 'Opened in Gmail. Gmail may mark it as read.' : 'Couldn’t open the original message.')
    },
    copyMessage: async () => {
      const m = readingRef.current?.message
      if (!m) return
      const ok = await window.miko.copyText(`From: ${m.from} <${m.fromEmail}>\nSubject: ${m.subject}\n\n${bodyText(m)}`)
      setNotice(ok ? 'Copied the message text.' : 'Couldn’t copy.')
    },
    saveRules: async (next) => {
      const saved = await window.miko.mailSetRules(next)
      if (saved) setRules(saved)
      if (params.current.filter !== 'all' && params.current.filter !== 'unread') void load(false)
    },
    correct: async (m, category, scope) => {
      const saved = await window.miko.mailCorrect({ key: m.key, fromEmail: m.fromEmail, category, scope })
      if (!saved) {
        setNotice('Couldn’t save that correction.')
        return
      }
      setCorrections(saved)
      const r = rulesRef.current
      if (r) setItems((list) => list.map((x) => ({ ...x, category: categorize(x, r, saved) })))
      const label = category ? CATEGORY_LABELS[category] : ''
      setNotice(
        category
          ? scope === 'sender'
            ? `Mail from ${m.fromEmail} now counts as ${label}.`
            : `Marked as ${label}.`
          : 'Correction removed; MIKO’s rules apply again.'
      )
    },
    applyIntent: (intent) => {
      const say = (text: string): string => {
        setNotice(text)
        return text
      }
      if (intent.kind === 'open' || intent.kind === 'reply' || intent.kind === 'cancel-reply') {
        // A command typed in the search box: keep the results it refers to, and put the box back.
        if (debounce.current) window.clearTimeout(debounce.current)
        debounce.current = null
        setQueryState(params.current.activeQuery)
      }
      if (intent.kind === 'cancel-reply') {
        if (!replyRef.current && !pendingReply.current) return say('There’s no reply in progress.')
        cancelReply()
        return 'Reply cancelled. Nothing was sent.'
      }
      if (intent.kind !== 'open' && intent.kind !== 'reply' && !statusRef.current?.accounts.length) return say('Connect a mail account first.')
      const browse = (next: MailFilter, unread: boolean): void => {
        if (debounce.current) window.clearTimeout(debounce.current)
        setQueryState('')
        setActiveQuery('')
        setFilterState(next)
        setUnreadOnly(unread)
        setReading(null)
        void load(false, { filter: next, unreadOnly: unread, activeQuery: '' })
      }
      if (intent.kind === 'recent') {
        browse('all', false)
        return say('Showing your latest 10 messages, newest first.')
      }
      if (intent.kind === 'unread') {
        browse('unread', false)
        return say('Showing unread mail.')
      }
      if (intent.kind === 'important') {
        browse('action', intent.unreadOnly)
        return say(`Showing Action needed${intent.unreadOnly ? ' (unread)' : ''}. Important FYI has the rest.`)
      }
      if (intent.kind === 'category') {
        browse(intent.category, false)
        return say(`Showing ${CATEGORY_LABELS[intent.category]}.`)
      }
      if (intent.kind === 'search') {
        runSearchNow(intent.query)
        return say(`Searching all mail for “${intent.query}”.`)
      }
      const list = itemsRef.current
      if (intent.kind === 'reply' && intent.index === 0) {
        const open = readingRef.current?.message
        if (open) {
          startReply(open.key, intent.instruction)
          return say(`Replying to “${open.subject}” from ${open.from}. Check the email, then draft.`)
        }
        if (!list.length) return say('There are no messages on screen yet. Say “check mail” first.')
        return say('Which one? Say “reply to the second email”, for example.')
      }
      if (!list.length) return say('There are no messages on screen yet. Say “check mail” first.')
      if (intent.index === 0) return say('Which one? Say “open the second email”, for example.')
      const index = intent.index === -1 ? list.length : intent.index
      const target = list[index - 1]
      if (!target) return say(`There are only ${list.length} messages on screen.`)
      if (intent.kind === 'reply') {
        startReply(target.key, intent.instruction)
        return say(`Replying to message ${index}: “${target.subject}” from ${target.from}. Check it, then draft.`)
      }
      open(target.key)
      return say(`Opening message ${index}: “${target.subject}”.`)
    },
    rememberScroll: (top) => {
      scroll.current = top
    },
    scrollTop: () => scroll.current,
    startReply,
    setReply: (patch) => patchReply(patch),
    resetContext: () => {
      const r = readingRef.current
      if (r?.message && replyRef.current?.target.key === r.key) patchReply({ context: replyContext(r.message, r.thread, localDate) })
    },
    draftReply: async () => {
      const r = replyRef.current
      if (!r || r.status === 'drafting') return
      const missing = missingDetail(r.instruction)
      if (missing) {
        patchReply({ status: 'question', question: missing, answer: '' })
        return
      }
      if (!r.context.trim()) {
        patchReply({ status: 'failed', error: 'The email context is empty. Use Reset context, or write the reply yourself.' })
        return
      }
      await send(baseRequest(r))
    },
    refine: async (change) => {
      const r = replyRef.current
      const wanted = change.trim()
      if (!r || r.status === 'drafting' || !wanted) return
      if (!r.draft.trim()) {
        patchReply({ status: 'failed', error: 'Draft a reply first.' })
        return
      }
      await send({ ...baseRequest(r), previous: r.draft, change: wanted })
    },
    regenerate: async () => {
      const r = replyRef.current
      if (!r || r.status === 'drafting') return
      // Same request again, with the current context and instruction.
      const last = r.last
      await send(last?.previous && last.change ? { ...baseRequest(r), previous: last.previous, change: last.change } : baseRequest(r))
    },
    answerQuestion: async () => {
      const r = replyRef.current
      if (!r || !r.answer.trim()) return
      const instruction = r.instruction.trim() ? `${r.instruction.trim()}\n(You asked: “${r.question}” My answer: ${r.answer.trim()})` : r.answer.trim()
      const next = { ...r, instruction, question: '', answer: '' }
      setReplyState(next)
      replyRef.current = next
      if (!next.context.trim()) return
      await send(baseRequest(next))
    },
    stopDrafting,
    cancelReply,
    copyReply: async () => {
      const r = replyRef.current
      if (!r?.draft.trim()) return
      const ok = await window.miko.copyText(r.draft)
      setNotice(ok ? 'Reply copied. Paste it into Gmail’s reply box; sending is up to you.' : 'Couldn’t copy.')
    },
    dictate: (text) => {
      const r = replyRef.current
      if (!r) return false
      const add = (current: string): string => (current.trim() ? `${current.trim()} ${text.trim()}` : text.trim())
      if (r.status === 'question') patchReply({ answer: add(r.answer) })
      else if (r.draft) patchReply({ followUp: add(r.followUp) })
      else patchReply({ instruction: add(r.instruction) })
      return true
    },
    replyActive: () => Boolean(replyRef.current)
  }

  return [
    { status, account, filter, unreadOnly, query, activeQuery, items, done, loading, error, reconnect, notice, connecting, reading, rules, corrections, reply },
    actions
  ]
}
