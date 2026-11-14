import { useCallback, useEffect, useRef, useState } from 'react'
import type { ImportanceRules, ListedMail, MailFilter, MailMessage, MailStatusInfo } from '../../../shared/api'
import type { MailIntent } from '../../../shared/mail'

const SEARCH_DEBOUNCE_MS = 350

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
  reading: { key: string; message: MailMessage | null; loading: boolean; error: string } | null
  rules: ImportanceRules | null
}

export interface MailActions {
  refreshStatus: () => Promise<MailStatusInfo | null>
  connect: (hint?: string) => Promise<void>
  disconnect: (email: string) => Promise<void>
  setAccount: (account: string) => void
  setFilter: (filter: MailFilter, unreadOnly?: boolean) => void
  setQuery: (query: string) => void
  clearSearch: () => void
  loadMore: () => void
  refresh: () => void
  open: (key: string) => void
  back: () => void
  openOriginal: (key: string) => Promise<void>
  saveRules: (rules: ImportanceRules) => Promise<void>
  /** Apply a chat/voice mail intent. Returns a short line for the panel. */
  applyIntent: (intent: MailIntent) => string
  rememberScroll: (top: number) => void
  scrollTop: () => number
}

export function useMail(): [MailState, MailActions] {
  const [status, setStatus] = useState<MailStatusInfo | null>(null)
  const [account, setAccountState] = useState('all')
  const [filter, setFilterState] = useState<MailFilter>('recent')
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
  const seq = useRef(0)
  const listId = useRef('')
  const debounce = useRef<number | null>(null)
  const scroll = useRef(0)
  const itemsRef = useRef<ListedMail[]>([])
  itemsRef.current = items
  const statusRef = useRef<MailStatusInfo | null>(null)
  statusRef.current = status
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
    void Promise.all([refreshStatus(), window.miko.mailRules().then(setRules)]).then(([next]) => {
      if (next && next.accounts.length) void load(false)
    })
  }, [refreshStatus, load])

  const setQuery = useCallback(
    (next: string) => {
      setQueryState(next)
      if (debounce.current) window.clearTimeout(debounce.current)
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
    setReading({ key, message: null, loading: true, error: '' })
    void window.miko.mailRead(key).then((result) => {
      setReading((prev) => {
        if (!prev || prev.key !== key) return prev
        if (result.ok) return { key, message: result.message, loading: false, error: '' }
        if (result.reconnect) setReconnect((r) => (r.includes(result.reconnect as string) ? r : [...r, result.reconnect as string]))
        return { key, message: null, loading: false, error: result.reason }
      })
    })
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
    saveRules: async (next) => {
      const saved = await window.miko.mailSetRules(next)
      if (saved) setRules(saved)
      if (params.current.filter === 'important') void load(false)
    },
    applyIntent: (intent) => {
      const say = (text: string): string => {
        setNotice(text)
        return text
      }
      if (intent.kind !== 'open' && !statusRef.current?.accounts.length) return say('Connect a mail account first.')
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
        browse('recent', false)
        return say('Showing your latest 10 messages, newest first.')
      }
      if (intent.kind === 'unread') {
        browse('unread', false)
        return say('Showing unread mail.')
      }
      if (intent.kind === 'important') {
        browse('important', intent.unreadOnly)
        return say(intent.unreadOnly ? 'Showing important unread mail.' : 'Showing important mail.')
      }
      if (intent.kind === 'search') {
        runSearchNow(intent.query)
        return say(`Searching all mail for “${intent.query}”.`)
      }
      const list = itemsRef.current
      if (!list.length) return say('There are no messages on screen yet. Say “check mail” first.')
      if (intent.index === 0) return say('Which one? Say “open the second email”, for example.')
      const index = intent.index === -1 ? list.length : intent.index
      const target = list[index - 1]
      if (!target) return say(`There are only ${list.length} messages on screen.`)
      open(target.key)
      return say(`Opening message ${index}: “${target.subject}”.`)
    },
    rememberScroll: (top) => {
      scroll.current = top
    },
    scrollTop: () => scroll.current
  }

  return [
    { status, account, filter, unreadOnly, query, activeQuery, items, done, loading, error, reconnect, notice, connecting, reading, rules },
    actions
  ]
}
