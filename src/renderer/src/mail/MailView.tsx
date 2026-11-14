import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ImportanceRules, ListedMail, MailCategory, MailFilter, MailMessage, MailSetupLink, ThreadEntry } from '../../../shared/api'
import { CATEGORY_LABELS, buildQuery, categorize, type Categorized } from '../../../shared/mail'
import { REFINEMENTS } from '../../../shared/mail-reply'
import { readerDocument, sanitizeEmailHtml } from './sanitize'
import type { MailActions, MailState, ReplyState } from './useMail'

interface MailViewProps {
  state: MailState
  actions: MailActions
  /** Hand the read-only mail-check request to ChatGPT instead (no mail reaches MIKO). */
  onAskChatGpt: () => void
  /** Enter in the search box: commands run, bare keywords search mail. */
  onCommand: (text: string) => void
}

const DAY = 86_400_000

const TABS: { id: MailFilter; label: string }[] = [
  { id: 'all', label: 'All mail' },
  { id: 'unread', label: 'Unread' },
  { id: 'action', label: 'Action needed' },
  { id: 'fyi', label: 'Important FYI' },
  { id: 'updates', label: 'Updates' },
  { id: 'promotions', label: 'Promotions' }
]

const CATEGORY_ORDER: MailCategory[] = ['action', 'fyi', 'updates', 'promotions', 'other']

function when(ms: number): string {
  const date = new Date(ms)
  const now = new Date()
  if (now.getTime() - ms < DAY && date.getDate() === now.getDate()) {
    return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  }
  const sameYear = date.getFullYear() === now.getFullYear()
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) })
}

function fullDate(ms: number): string {
  return new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

function categoryLabel(c: Categorized): string {
  return `${c.certain ? '' : 'Maybe: '}${CATEGORY_LABELS[c.category]}`
}

export function MailView({ state, actions, onAskChatGpt, onCommand }: MailViewProps) {
  const { status } = state
  const listRef = useRef<HTMLDivElement>(null)
  const [showRules, setShowRules] = useState(false)
  const [showAccounts, setShowAccounts] = useState(false)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [correcting, setCorrecting] = useState<string | null>(null)

  // Restore the result list's scroll position when coming back from a message.
  useLayoutEffect(() => {
    if (!state.reading && listRef.current) listRef.current.scrollTop = actions.scrollTop()
  }, [state.reading])

  if (!status) return <div className="mail-state">Loading mail…</div>

  if (!status.accounts.length) {
    return (
      <div className="mail-state setup">
        <h2>Connect Gmail</h2>
        {status.configured ? (
          <>
            <p>Gmail is set up. Connect an account: Google opens in your browser, you pick the account and allow read-only access. MIKO keeps the sign-in in your Mac’s Keychain.</p>
            <button type="button" className="glass-button primary" disabled={state.connecting} onClick={() => void actions.connect()}>
              {state.connecting ? 'Waiting for Google…' : 'Connect account'}
            </button>
          </>
        ) : (
          <GoogleSetup onSaved={() => void actions.refreshStatus()} />
        )}
        {!status.secureStorage ? <p className="mail-warn">Secure storage isn’t available, so MIKO won’t keep a sign-in.</p> : null}
        <p className="mail-muted">Or let ChatGPT check it: MIKO copies a read-only request for the ChatGPT app. MIKO won’t see the mail that way.</p>
        <button type="button" className="glass-button" onClick={onAskChatGpt}>
          Ask ChatGPT instead
        </button>
        {state.notice ? <p className="mail-notice" role="status">{state.notice}</p> : null}
      </div>
    )
  }

  const reply = state.reply
  const readingTarget = Boolean(reply && state.reading && state.reading.key === reply.target.key)
  const tabLabel = TABS.find((t) => t.id === state.filter)?.label ?? 'All mail'
  const accountsLine = status.accounts.length === 1 ? status.accounts[0].email : `${status.accounts.length} accounts`

  return (
    <div className="mail">
      <div className="mail-toolbar">
        <div className="mail-search">
          <input
            value={state.query}
            placeholder="Search all mail: words, from:name, subject:word, after:2026/01/31"
            aria-label="Search mail"
            spellCheck={false}
            onChange={(event) => actions.setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && state.query.trim()) onCommand(state.query.trim())
            }}
          />
          {state.query ? (
            <button type="button" className="mail-clear" aria-label="Clear search" onClick={actions.clearSearch}>
              ×
            </button>
          ) : null}
        </div>
        <button type="button" className="glass-button" onClick={() => setShowAdvanced((v) => !v)} aria-expanded={showAdvanced}>
          Advanced
        </button>
        <select aria-label="Account" value={state.account} onChange={(event) => actions.setAccount(event.target.value)}>
          <option value="all">All accounts</option>
          {status.accounts.map((a) => (
            <option key={a.email} value={a.email}>
              {a.email}
            </option>
          ))}
        </select>
        <button type="button" className="glass-button" aria-label="Refresh" title="Refresh" onClick={actions.refresh}>
          ↻
        </button>
        <button type="button" className="glass-button" onClick={() => setShowAccounts((v) => !v)} aria-expanded={showAccounts}>
          Accounts
        </button>
      </div>
      <div className="mail-filters" role="tablist" aria-label="Mail tabs">
        {TABS.map((t) => (
          <button
            type="button"
            role="tab"
            key={t.id}
            aria-selected={state.filter === t.id}
            className={state.filter === t.id ? 'chip is-on' : 'chip'}
            onClick={() => actions.setFilter(t.id)}
          >
            {t.label}
            {state.filter === t.id && state.unreadOnly ? ' · unread' : ''}
          </button>
        ))}
        <button type="button" className="chip subtle" onClick={() => setShowRules((v) => !v)} aria-expanded={showRules}>
          Rules
        </button>
      </div>
      <div className="mail-scope">
        {accountsLine} · {state.activeQuery ? `Search: ${state.activeQuery}` : `Inbox · ${tabLabel}`} · {state.items.length} shown, newest first
      </div>
      {showAdvanced ? (
        <AdvancedSearch
          onSearch={(q) => {
            setShowAdvanced(false)
            actions.search(q)
          }}
        />
      ) : null}
      {showAccounts ? (
        <div className="mail-pop">
          {status.accounts.map((a) => (
            <div className="mail-pop-row" key={a.email}>
              <span>{a.email}</span>
              {a.status === 'reconnect' ? (
                <button type="button" className="glass-button" onClick={() => void actions.connect(a.email)}>
                  Reconnect
                </button>
              ) : null}
              <button type="button" className="glass-button" onClick={() => void actions.disconnect(a.email)} disabled={status.preview}>
                Disconnect
              </button>
            </div>
          ))}
          <button type="button" className="glass-button primary" disabled={state.connecting || status.preview} onClick={() => void actions.connect()}>
            Connect another account
          </button>
        </div>
      ) : null}
      {showRules && state.rules ? <RulesEditor rules={state.rules} onSave={actions.saveRules} /> : null}
      {state.reconnect.length ? (
        <div className="mail-banner" role="alert">
          <span>Sign-in expired for {state.reconnect.join(', ')}.</span>
          {state.reconnect.map((email) => (
            <button type="button" className="glass-button" key={email} onClick={() => void actions.connect(email)}>
              Reconnect {status.accounts.length > 1 ? email : ''}
            </button>
          ))}
        </div>
      ) : null}
      {status.preview ? <div className="mail-banner preview">Development preview: sample messages, not your mail.</div> : null}
      {reply && !readingTarget ? (
        <div className="mail-banner reply-banner" role="status">
          <span>
            Replying to <strong>{reply.target.original.from}</strong>: “{reply.target.original.subject}”
          </span>
          <button type="button" className="glass-button" onClick={() => actions.open(reply.target.key)}>
            Resume reply
          </button>
          <button type="button" className="glass-button" onClick={actions.cancelReply}>
            Cancel reply
          </button>
        </div>
      ) : null}
      {state.notice ? <p className="mail-notice" role="status">{state.notice}</p> : null}

      {state.reading ? (
        <Reader
          reading={state.reading}
          reply={readingTarget ? reply : null}
          state={state}
          actions={actions}
          correcting={correcting}
          setCorrecting={setCorrecting}
        />
      ) : (
        <div className="mail-list" ref={listRef} onScroll={(event) => actions.rememberScroll(event.currentTarget.scrollTop)}>
          {state.error ? (
            <div className={state.items.length ? 'mail-banner' : 'mail-state small'} role="alert">
              <p>{state.items.length ? `Partial results. ${state.error}` : state.error}</p>
              <button type="button" className="glass-button" onClick={actions.refresh}>
                Try again
              </button>
            </div>
          ) : null}
          {state.items.map((m, i) => (
            <Row
              key={m.key}
              index={i + 1}
              m={m}
              showReason={state.filter !== 'all' && state.filter !== 'unread'}
              replying={reply?.target.key === m.key}
              onOpen={() => actions.open(m.key)}
              correcting={correcting === m.key}
              onCorrecting={(on) => setCorrecting(on ? m.key : null)}
              onCorrect={(category, scope) => {
                setCorrecting(null)
                void actions.correct(m, category, scope)
              }}
            />
          ))}
          {state.loading ? <div className="mail-loading">{state.items.length ? 'Loading more…' : 'Loading mail…'}</div> : null}
          {!state.loading && !state.items.length && !state.error ? (
            <div className="mail-state small">
              {state.activeQuery
                ? `Nothing matches “${state.activeQuery}”${state.filter === 'all' ? '' : ` in ${tabLabel}`}.`
                : state.filter === 'unread'
                  ? 'No unread mail.'
                  : state.filter === 'all'
                    ? 'Your inbox is empty.'
                    : `Nothing in ${tabLabel} among recent mail. Everything is still in All mail.`}
            </div>
          ) : null}
          {!state.loading && !state.done && state.items.length ? (
            <button type="button" className="glass-button more" onClick={actions.loadMore}>
              Load next 10
            </button>
          ) : null}
        </div>
      )}
    </div>
  )
}

function CategoryChip({
  category,
  open,
  onOpen,
  onCorrect,
  fromEmail
}: {
  category: Categorized
  open: boolean
  onOpen: (on: boolean) => void
  onCorrect: (category: MailCategory | null, scope: 'message' | 'sender') => void
  fromEmail: string
}) {
  const [forSender, setForSender] = useState(false)
  return (
    <span className="mail-cat">
      <button
        type="button"
        className={`mail-cat-chip cat-${category.category}${category.certain ? '' : ' is-maybe'}`}
        title={`${category.reason}. Click to correct.`}
        aria-expanded={open}
        onClick={() => onOpen(!open)}
      >
        {categoryLabel(category)} ▾
      </button>
      {open ? (
        <span className="mail-cat-menu" role="menu">
          <span className="mail-muted">Correct the category</span>
          {CATEGORY_ORDER.map((c) => (
            <button
              type="button"
              role="menuitem"
              key={c}
              className={c === category.category ? 'chip is-on' : 'chip'}
              onClick={() => onCorrect(c, forSender ? 'sender' : 'message')}
            >
              {CATEGORY_LABELS[c]}
            </button>
          ))}
          <label className="rule">
            <input type="checkbox" checked={forSender} onChange={(e) => setForSender(e.target.checked)} /> Everything from {fromEmail}
          </label>
          {category.source === 'you' ? (
            <button
              type="button"
              className="glass-button"
              onClick={() => onCorrect(null, category.reason.startsWith('You set this for') ? 'sender' : 'message')}
            >
              Undo my correction
            </button>
          ) : null}
        </span>
      ) : null}
    </span>
  )
}

function Row({
  m,
  index,
  showReason,
  replying,
  onOpen,
  correcting,
  onCorrecting,
  onCorrect
}: {
  m: ListedMail
  index: number
  showReason: boolean
  replying: boolean
  onOpen: () => void
  correcting: boolean
  onCorrecting: (on: boolean) => void
  onCorrect: (category: MailCategory | null, scope: 'message' | 'sender') => void
}) {
  return (
    <div className={m.unread ? 'mail-item is-unread' : 'mail-item'}>
      <button
        type="button"
        className={m.unread ? 'mail-row is-unread' : 'mail-row'}
        onClick={onOpen}
        aria-label={`Message ${index}: ${m.subject} from ${m.from}${m.unread ? ', unread' : ''}`}
      >
        <span className="mail-num" aria-hidden="true">
          {index}
        </span>
        <span className="mail-dot" aria-hidden="true" />
        <span className="mail-main">
          <span className="mail-line">
            <span className="mail-from" title={m.fromEmail}>
              {m.from}
            </span>
            {replying ? <span className="mail-badge reply">Replying</span> : null}
            <span className="mail-date" title={fullDate(m.date)}>
              {when(m.date)}
            </span>
          </span>
          <span className="mail-subject">{m.subject}</span>
          <span className="mail-snippet">{m.snippet}</span>
        </span>
      </button>
      <div className="mail-catline">
        <CategoryChip category={m.category} open={correcting} onOpen={onCorrecting} onCorrect={onCorrect} fromEmail={m.fromEmail} />
        {showReason || !m.category.certain ? <span className="mail-reason">{m.category.reason}</span> : null}
        <span className="mail-account" title="Account">
          {m.account}
        </span>
      </div>
    </div>
  )
}

function Reader({
  reading,
  reply,
  state,
  actions,
  correcting,
  setCorrecting
}: {
  reading: NonNullable<MailState['reading']>
  reply: ReplyState | null
  state: MailState
  actions: MailActions
  correcting: string | null
  setCorrecting: (key: string | null) => void
}) {
  const m: MailMessage | null = reading.message
  const body = useMemo(() => {
    if (!m) return null
    if (m.html) {
      const clean = sanitizeEmailHtml(m.html)
      return { kind: 'html' as const, doc: readerDocument(clean.html), blocked: clean.blockedImages }
    }
    return { kind: 'text' as const, text: m.text || m.snippet }
  }, [m])
  const category = useMemo(() => (m && state.rules ? categorize(m, state.rules, state.corrections) : null), [m, state.rules, state.corrections])
  const earlier = reading.thread.filter((t) => m && t.key !== m.key)
  const backRef = useRef<HTMLButtonElement>(null)
  useEffect(() => backRef.current?.focus(), [])
  return (
    <div className="mail-reader">
      <div className="mail-reader-bar">
        <button type="button" className="glass-button" ref={backRef} onClick={actions.back}>
          ← Back to results
        </button>
        {m ? (
          <span className="mail-reader-actions">
            {!reply ? (
              <button type="button" className="glass-button primary" onClick={() => actions.startReply(m.key)}>
                Reply
              </button>
            ) : null}
            <button type="button" className="glass-button" onClick={() => void actions.copyMessage()}>
              Copy
            </button>
            <button type="button" className="glass-button" onClick={() => void actions.openOriginal(m.key)} title="Opens in Gmail, which may mark it read">
              Open original
            </button>
          </span>
        ) : null}
      </div>
      {reading.loading ? <div className="mail-loading">Opening…</div> : null}
      {reading.error ? <div className="mail-state small">{reading.error}</div> : null}
      {m && body ? (
        reply ? (
          <ReplyComposer reply={reply} actions={actions} unread={m.unread} />
        ) : (
          <>
            <div className="mail-head">
              <h2>{m.subject}</h2>
              <p>
                <strong>{m.from}</strong> &lt;{m.fromEmail}&gt;
              </p>
              <p className="mail-muted">
                To: {m.to || '—'}
                {m.cc ? ` · Cc: ${m.cc}` : ''}
              </p>
              <p className="mail-muted">
                {fullDate(m.date)} · {m.account}
                {m.unread ? ' · still unread' : ''}
              </p>
              {category ? (
                <p className="mail-head-cat">
                  <CategoryChip
                    category={category}
                    open={correcting === m.key}
                    onOpen={(on) => setCorrecting(on ? m.key : null)}
                    onCorrect={(c, scope) => {
                      setCorrecting(null)
                      void actions.correct(m, c, scope)
                    }}
                    fromEmail={m.fromEmail}
                  />
                  <span className="mail-reason">{category.reason}</span>
                </p>
              ) : null}
              {body.kind === 'html' && body.blocked ? (
                <p className="mail-muted">
                  {body.blocked} remote image{body.blocked === 1 ? '' : 's'} blocked.
                </p>
              ) : null}
            </div>
            {earlier.length ? <ThreadContext entries={earlier} /> : null}
            {body.kind === 'html' ? (
              <iframe className="mail-body" title="Message body" sandbox="" referrerPolicy="no-referrer" srcDoc={body.doc} />
            ) : (
              <pre className="mail-body text">{body.text}</pre>
            )}
          </>
        )
      ) : null}
    </div>
  )
}

function ThreadContext({ entries }: { entries: ThreadEntry[] }) {
  return (
    <details className="mail-thread">
      <summary>
        Thread: {entries.length} other message{entries.length === 1 ? '' : 's'}
      </summary>
      {entries.map((t) => (
        <div className="mail-thread-item" key={t.key}>
          <p className="mail-muted">
            <strong>{t.from}</strong> · {fullDate(t.date)}
          </p>
          <p className="mail-thread-text">{t.text.slice(0, 700)}</p>
        </div>
      ))}
    </details>
  )
}

function ReplyComposer({ reply, actions, unread }: { reply: ReplyState; actions: MailActions; unread: boolean }) {
  const t = reply.target
  const drafting = reply.status === 'drafting'
  const instructionRef = useRef<HTMLTextAreaElement>(null)
  useEffect(() => instructionRef.current?.focus(), [t.key])
  return (
    <div className="reply" aria-label="Reply">
      <div className="reply-target">
        <p>
          <span className="reply-key">To</span> {t.to}
        </p>
        <p>
          <span className="reply-key">Subject</span> {t.subject}
        </p>
        <p className="mail-muted">
          From {t.account} · replying to “{t.original.subject}” from {t.original.from}, {fullDate(t.original.date)}
          {unread ? ' · still unread' : ''}
        </p>
        <button type="button" className="glass-button" onClick={actions.cancelReply}>
          Cancel reply
        </button>
      </div>

      <label className="reply-label" htmlFor="reply-instruction">
        Your instruction or rough reply
      </label>
      <textarea
        id="reply-instruction"
        ref={instructionRef}
        className="reply-input"
        rows={2}
        value={reply.instruction}
        placeholder="e.g. “yes, Thursday 3 pm works, I’ll bring the documents”. Hold Caps Lock + A to dictate."
        onChange={(e) => actions.setReply({ instruction: e.target.value })}
      />

      {!reply.reviewed ? (
        <div className="reply-consent">
          <p>
            <strong>Before the first draft:</strong> MIKO sends the email text below and your instruction to its assistant (ChatGPT, through the Codex CLI signed in with your ChatGPT
            account). Trim anything you don’t want to share. Nothing is sent until you press Draft.
          </p>
          <textarea className="reply-context" rows={6} value={reply.context} onChange={(e) => actions.setReply({ context: e.target.value })} aria-label="Email context sent to MIKO" />
          <p className="mail-muted">
            {reply.context.length} characters ·{' '}
            <button type="button" className="text-link" onClick={actions.resetContext}>
              Reset context
            </button>
          </p>
        </div>
      ) : (
        <details className="reply-sent">
          <summary>Email context sent to MIKO (edit)</summary>
          <textarea className="reply-context" rows={5} value={reply.context} onChange={(e) => actions.setReply({ context: e.target.value })} aria-label="Email context sent to MIKO" />
        </details>
      )}

      <div className="reply-actions">
        {drafting ? (
          <>
            <span className="mail-loading inline">Drafting…</span>
            <button type="button" className="glass-button" onClick={actions.stopDrafting}>
              Stop
            </button>
          </>
        ) : (
          <button type="button" className="glass-button primary" onClick={() => void actions.draftReply()}>
            {reply.reviewed ? (reply.draft ? 'Draft again from instruction' : 'Draft reply') : 'Send to MIKO and draft'}
          </button>
        )}
      </div>
      {reply.error ? (
        <p className={reply.status === 'failed' ? 'mail-warn' : 'mail-notice'} role="alert">
          {reply.error}
        </p>
      ) : null}

      {reply.status === 'question' ? (
        <div className="reply-question" role="status">
          <p>
            <strong>MIKO asks:</strong> {reply.question}
          </p>
          <div className="reply-row">
            <input
              value={reply.answer}
              aria-label="Your answer"
              placeholder="Your answer"
              onChange={(e) => actions.setReply({ answer: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void actions.answerQuestion()
              }}
            />
            <button type="button" className="glass-button primary" disabled={!reply.answer.trim()} onClick={() => void actions.answerQuestion()}>
              Answer and draft
            </button>
          </div>
        </div>
      ) : null}

      {reply.draft ? (
        <div className="reply-draft">
          <label className="reply-label" htmlFor="reply-draft">
            {reply.drafts > 1 ? `Draft, version ${reply.drafts}` : 'Draft'} (edit freely)
          </label>
          <textarea id="reply-draft" className="reply-output" rows={7} value={reply.draft} onChange={(e) => actions.setReply({ draft: e.target.value })} />
          <div className="reply-actions">
            <button type="button" className="glass-button primary" onClick={() => void actions.copyReply()}>
              Copy reply
            </button>
            <button type="button" className="glass-button" disabled={drafting} onClick={() => void actions.regenerate()}>
              Regenerate
            </button>
            <button type="button" className="glass-button" onClick={() => void actions.openOriginal(t.key)} title="Reply and send from Gmail. Gmail may mark it read.">
              Open original
            </button>
          </div>
          <div className="reply-row">
            {REFINEMENTS.map((r) => (
              <button type="button" key={r} className="chip" disabled={drafting} onClick={() => void actions.refine(r.toLowerCase())}>
                {r}
              </button>
            ))}
          </div>
          <div className="reply-row">
            <input
              value={reply.followUp}
              aria-label="Change the draft"
              placeholder="Change it, e.g. “add that I’ll send it tomorrow”"
              onChange={(e) => actions.setReply({ followUp: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && reply.followUp.trim()) void actions.refine(reply.followUp)
              }}
            />
            <button type="button" className="glass-button" disabled={drafting || !reply.followUp.trim()} onClick={() => void actions.refine(reply.followUp)}>
              Apply
            </button>
          </div>
          <p className="mail-muted">MIKO never sends mail. To send: Copy reply → Open original → Reply in Gmail → paste → Send.</p>
        </div>
      ) : null}
    </div>
  )
}

function AdvancedSearch({ onSearch }: { onSearch: (query: string) => void }) {
  const [fields, setFields] = useState({ words: '', from: '', subject: '', after: '', before: '' })
  const query = buildQuery(fields)
  const field = (key: keyof typeof fields, label: string, type = 'text') => (
    <label className="adv-field">
      <span>{label}</span>
      <input type={type} value={fields[key]} onChange={(e) => setFields({ ...fields, [key]: e.target.value })} spellCheck={false} />
    </label>
  )
  return (
    <form
      className="mail-pop adv"
      onSubmit={(e) => {
        e.preventDefault()
        if (query) onSearch(query)
      }}
    >
      {field('words', 'Words')}
      {field('from', 'From')}
      {field('subject', 'Subject')}
      {field('after', 'After', 'date')}
      {field('before', 'Before', 'date')}
      <div className="reply-row">
        <span className="mail-muted adv-query">{query || 'Fill in any field.'}</span>
        <button type="submit" className="glass-button primary" disabled={!query}>
          Search all mail
        </button>
      </div>
    </form>
  )
}

function RulesEditor({ rules, onSave }: { rules: ImportanceRules; onSave: (rules: ImportanceRules) => Promise<void> }) {
  const [draft, setDraft] = useState(rules)
  const [keywords, setKeywords] = useState(rules.keywords.join(', '))
  const toggle = (key: keyof Omit<ImportanceRules, 'keywords'>, label: string) => (
    <label className="rule">
      <input type="checkbox" checked={draft[key]} onChange={(e) => setDraft({ ...draft, [key]: e.target.checked })} /> {label}
    </label>
  )
  return (
    <div className="mail-pop rules">
      <p className="mail-muted">
        Categories come from Gmail’s own tabs and importance flag plus these rules, never from a model. Your corrections (click a row’s category) win over everything.
      </p>
      {toggle('providerFlag', 'Gmail importance flag → Important FYI')}
      {toggle('directRequests', 'Direct requests to me → Action needed')}
      {toggle('deadlines', 'Deadlines → Action needed')}
      {toggle('approvals', 'Approvals → Action needed')}
      {toggle('payments', 'Payments and invoices → Action needed')}
      <label className="rule">
        Keywords (Important FYI){' '}
        <input value={keywords} placeholder="e.g. FreshNet, interview" onChange={(e) => setKeywords(e.target.value)} />
      </label>
      <button
        type="button"
        className="glass-button primary"
        onClick={() =>
          void onSave({
            ...draft,
            keywords: keywords
              .split(',')
              .map((k) => k.trim())
              .filter(Boolean)
          })
        }
      >
        Save rules
      </button>
    </div>
  )
}

const SETUP_STEPS: { text: string; link?: MailSetupLink; label?: string }[] = [
  { text: 'Create a Google Cloud project named “MIKO” (any name works).', link: 'project', label: 'New project' },
  { text: 'Enable the Gmail API for that project.', link: 'gmail-api', label: 'Gmail API' },
  { text: 'Google Auth Platform → Branding: app name MIKO, your Gmail as support and contact email, Audience External.', link: 'branding', label: 'Branding' },
  { text: 'Audience → Test users → add every Gmail address you’ll connect.', link: 'audience', label: 'Audience' },
  { text: 'Data access → Add scope …/auth/gmail.readonly → Save.', link: 'data-access', label: 'Data access' },
  { text: 'Clients → Create client → Application type “Desktop app” → Create. Copy the Client ID and Client secret.', link: 'clients', label: 'Create client' },
  { text: 'Paste both below and Save. Then Connect account, pick your Gmail, and on “Google hasn’t verified this app” choose Continue (it’s your own app).' }
]

function GoogleSetup({ onSaved }: { onSaved: () => void }) {
  const [clientId, setClientId] = useState('')
  const [secret, setSecret] = useState('')
  const [message, setMessage] = useState('')
  const [saving, setSaving] = useState(false)
  return (
    <div className="mail-setup">
      <p>One-time setup, about 5 minutes. MIKO uses your own Google Cloud app with read-only Gmail access, so no one else is in between.</p>
      <ol className="setup-steps">
        {SETUP_STEPS.map((s, i) => (
          <li key={i}>
            <span>{s.text}</span>
            {s.link ? (
              <button type="button" className="glass-button" onClick={() => void window.miko.mailSetupLink(s.link as MailSetupLink)}>
                Open {s.label}
              </button>
            ) : null}
          </li>
        ))}
      </ol>
      <input
        value={clientId}
        placeholder="Client ID (….apps.googleusercontent.com)"
        aria-label="Google Client ID"
        spellCheck={false}
        autoComplete="off"
        onChange={(e) => setClientId(e.target.value)}
      />
      <input
        value={secret}
        type="password"
        placeholder="Client secret (GOCSPX-…)"
        aria-label="Google Client secret"
        spellCheck={false}
        autoComplete="off"
        onChange={(e) => setSecret(e.target.value)}
      />
      <button
        type="button"
        className="glass-button primary"
        disabled={saving || !clientId.trim() || !secret.trim()}
        onClick={() => {
          setSaving(true)
          void window.miko.mailSetup(clientId, secret).then((r) => {
            setSaving(false)
            setMessage(r.ok ? 'Saved securely in your Keychain.' : r.reason)
            if (r.ok) {
              setSecret('')
              onSaved()
            }
          })
        }}
      >
        Save Gmail setup
      </button>
      <p className="mail-muted">
        Stored encrypted on this Mac (Keychain). While the Google app is in Testing, Google asks you to reconnect about once a week; MIKO shows a Reconnect button.
      </p>
      {message ? (
        <p className="mail-notice" role="status">
          {message}
        </p>
      ) : null}
    </div>
  )
}
