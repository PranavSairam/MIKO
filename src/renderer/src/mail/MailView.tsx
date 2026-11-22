import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react'
import type { ImportanceRules, ListedMail, MailCategory, MailFilter, MailMessage, MailSetupLink, ThreadEntry } from '../../../shared/api'
import { CATEGORY_LABELS, buildQuery, categorize, type Categorized } from '../../../shared/mail'
import { REFINEMENTS } from '../../../shared/mail-reply'
import { readerDocument, sanitizeEmailHtml } from './sanitize'
import type { MailActions, MailState, ReplyState } from './useMail'

/**
 * Mail panel, one step at a time:
 *   inbox   → header (account, refresh, settings), one search field, All / Unread / Important + More
 *   message → Back, sender/subject/date, the body, Reply and Open in Gmail
 *   reply   → "What would you like to say?" → Create draft → the editable draft, one change field,
 *             Copy reply, Open in Gmail, and a small More menu
 * Advanced search, category rules and accounts live in Mail settings.
 */

interface MailViewProps {
  state: MailState
  actions: MailActions
  /** Hand the read-only mail-check request to ChatGPT instead (no mail reaches MIKO). */
  onAskChatGpt: () => void
  /** Enter in the search box: commands run, bare keywords search mail. */
  onCommand: (text: string) => void
}

const DAY = 86_400_000

const MAIN_FILTERS: { id: MailFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'unread', label: 'Unread' },
  { id: 'important', label: 'Important' }
]

const MORE_FILTERS: { id: MailFilter; label: string }[] = [
  { id: 'action', label: 'Action needed' },
  { id: 'fyi', label: 'Important FYI' },
  { id: 'updates', label: 'Updates' },
  { id: 'promotions', label: 'Promotions' }
]

const CATEGORY_ORDER: MailCategory[] = ['action', 'fyi', 'updates', 'promotions', 'other']

/** Label for the connected provider's own web app. */
function providerLabel(provider: string | undefined): string {
  return provider === 'gmail' || !provider ? 'Open in Gmail' : 'Open original'
}

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

/** A small popover menu: closes on choice, Escape, or a click outside. */
function Menu({ label, buttonLabel, buttonClass = 'glass-button', align = 'right', children }: { label: string; buttonLabel: ReactNode; buttonClass?: string; align?: 'left' | 'right'; children: (close: () => void) => ReactNode }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent): void => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [open])
  const onKey = (event: ReactKeyboardEvent): void => {
    if (event.key === 'Escape' && open) {
      event.stopPropagation()
      setOpen(false)
    }
  }
  return (
    <span className="m-menu" ref={ref} onKeyDown={onKey}>
      <button type="button" className={buttonClass} aria-haspopup="menu" aria-expanded={open} aria-label={label} onClick={() => setOpen((v) => !v)}>
        {buttonLabel}
      </button>
      {open ? (
        <span className={`m-menu-list ${align === 'left' ? 'at-left' : ''}`} role="menu" aria-label={label}>
          {children(() => setOpen(false))}
        </span>
      ) : null}
    </span>
  )
}

export function MailView({ state, actions, onAskChatGpt, onCommand }: MailViewProps) {
  const { status } = state
  const listRef = useRef<HTMLDivElement>(null)
  const [settings, setSettings] = useState(false)

  // Restore the result list's scroll position when coming back from a message.
  useLayoutEffect(() => {
    if (!state.reading && listRef.current) listRef.current.scrollTop = actions.scrollTop()
  }, [state.reading, settings])

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
  const multi = status.accounts.length > 1
  const moreActive = MORE_FILTERS.find((f) => f.id === state.filter)

  if (settings) {
    return <MailSettings state={state} actions={actions} onClose={() => setSettings(false)} onSearch={(q) => {
      setSettings(false)
      actions.search(q)
    }} />
  }

  if (state.reading) {
    return (
      <div className="mail">
        {state.reconnect.length ? <ReconnectBanner state={state} actions={actions} /> : null}
        <Reader reading={state.reading} reply={readingTarget ? reply : null} state={state} actions={actions} />
      </div>
    )
  }

  return (
    <div className="mail">
      <div className="m-head">
        <h2 className="m-title">Mail</h2>
        {multi ? (
          <select className="m-account" aria-label="Account" value={state.account} onChange={(event) => actions.setAccount(event.target.value)}>
            <option value="all">All accounts</option>
            {status.accounts.map((a) => (
              <option key={a.email} value={a.email}>
                {a.email}
              </option>
            ))}
          </select>
        ) : (
          <span className="m-account-label" title="Connected account">
            {status.accounts[0].email}
          </span>
        )}
        <span className="m-head-actions">
          <button type="button" className="m-icon" aria-label="Refresh" title="Refresh" onClick={actions.refresh}>
            ↻
          </button>
          <button type="button" className="m-icon" aria-label="Mail settings" title="Mail settings" onClick={() => setSettings(true)}>
            ⚙
          </button>
        </span>
      </div>
      <div className="m-search">
        <input
          value={state.query}
          placeholder="Search your mail"
          aria-label="Search your mail"
          spellCheck={false}
          onChange={(event) => actions.setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && state.query.trim()) onCommand(state.query.trim())
          }}
        />
        {state.query ? (
          <button type="button" className="m-clear" aria-label="Clear search" onClick={actions.clearSearch}>
            ×
          </button>
        ) : null}
      </div>
      <div className="m-filters" role="tablist" aria-label="Show">
        {MAIN_FILTERS.map((f) => (
          <button
            type="button"
            role="tab"
            key={f.id}
            aria-selected={state.filter === f.id}
            className={state.filter === f.id ? 'chip is-on' : 'chip'}
            onClick={() => actions.setFilter(f.id)}
          >
            {f.label}
          </button>
        ))}
        <Menu label="More filters" buttonClass={moreActive ? 'chip is-on' : 'chip'} align="left" buttonLabel={<>{moreActive ? moreActive.label : 'More'} ▾</>}>
          {(close) =>
            MORE_FILTERS.map((f) => (
              <button
                type="button"
                role="menuitemradio"
                aria-checked={state.filter === f.id}
                key={f.id}
                className={state.filter === f.id ? 'm-item is-on' : 'm-item'}
                onClick={() => {
                  close()
                  actions.setFilter(f.id)
                }}
              >
                {f.label}
              </button>
            ))
          }
        </Menu>
      </div>
      {state.reconnect.length ? <ReconnectBanner state={state} actions={actions} /> : null}
      {status.preview ? <div className="mail-banner preview">Sample messages for testing, not your mail.</div> : null}
      {reply ? (
        <div className="m-resume" role="status">
          <span>
            Draft reply to <strong>{reply.target.original.from}</strong>
          </span>
          <button type="button" className="glass-button" onClick={() => actions.open(reply.target.key)}>
            Continue
          </button>
          <button type="button" className="m-link" onClick={actions.cancelReply}>
            Discard
          </button>
        </div>
      ) : null}
      {state.notice ? <p className="mail-notice" role="status">{state.notice}</p> : null}
      {state.activeQuery ? (
        <p className="m-results">
          Results for “{state.activeQuery}” in all mail ·{' '}
          <button type="button" className="m-link" onClick={actions.clearSearch}>
            Clear
          </button>
        </p>
      ) : null}
      <div className="mail-list" ref={listRef} onScroll={(event) => actions.rememberScroll(event.currentTarget.scrollTop)}>
        {state.error ? (
          <div className={state.items.length ? 'mail-banner' : 'mail-state small'} role="alert">
            <p>{state.items.length ? `Some mail couldn’t load. ${state.error}` : state.error}</p>
            <button type="button" className="glass-button" onClick={actions.refresh}>
              Try again
            </button>
          </div>
        ) : null}
        {state.items.map((m, i) => (
          <Row key={m.key} index={i + 1} m={m} showAccount={multi && state.account === 'all'} replying={reply?.target.key === m.key} onOpen={() => actions.open(m.key)} />
        ))}
        {state.loading ? (
          <div className="mail-loading" role="status">
            <span className="m-spinner" aria-hidden="true" /> {state.items.length ? 'Loading more…' : 'Loading your mail…'}
          </div>
        ) : null}
        {!state.loading && !state.items.length && !state.error ? (
          <div className="mail-state small">
            {state.activeQuery
              ? `Nothing matches “${state.activeQuery}”.`
              : state.filter === 'unread'
                ? 'You’re all caught up. No unread mail.'
                : state.filter === 'all'
                  ? 'Your inbox is empty.'
                  : 'Nothing here in your recent mail. Everything is still under All.'}
          </div>
        ) : null}
        {!state.loading && !state.done && state.items.length ? (
          <button type="button" className="glass-button more" onClick={actions.loadMore}>
            Load more
          </button>
        ) : null}
      </div>
    </div>
  )
}

function ReconnectBanner({ state, actions }: { state: MailState; actions: MailActions }) {
  return (
    <div className="mail-banner" role="alert">
      <span>Sign-in expired for {state.reconnect.join(', ')}.</span>
      {state.reconnect.map((email) => (
        <button type="button" className="glass-button" key={email} onClick={() => void actions.connect(email)}>
          Reconnect{state.reconnect.length > 1 ? ` ${email}` : ''}
        </button>
      ))}
    </div>
  )
}

/** Accounts, Advanced search and category rules: kept, but out of the inbox. */
function MailSettings({ state, actions, onClose, onSearch }: { state: MailState; actions: MailActions; onClose: () => void; onSearch: (query: string) => void }) {
  const status = state.status
  const doneRef = useRef<HTMLButtonElement>(null)
  useEffect(() => doneRef.current?.focus(), [])
  if (!status) return null
  return (
    <div className="mail m-settings" aria-label="Mail settings">
      <div className="m-bar">
        <button type="button" className="glass-button" ref={doneRef} onClick={onClose}>
          ← Done
        </button>
        <h2 className="m-title">Mail settings</h2>
      </div>
      <div className="m-scroll">
        <section className="m-section">
          <h3>Accounts</h3>
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
          <button type="button" className="glass-button" disabled={state.connecting || status.preview} onClick={() => void actions.connect()}>
            Connect another account
          </button>
        </section>
        <section className="m-section">
          <h3>Advanced search</h3>
          <AdvancedSearch onSearch={onSearch} />
        </section>
        <section className="m-section">
          <h3>What counts as Important</h3>
          {state.rules ? <RulesEditor rules={state.rules} onSave={actions.saveRules} /> : null}
        </section>
        {state.notice ? <p className="mail-notice" role="status">{state.notice}</p> : null}
      </div>
    </div>
  )
}

function Row({ m, index, showAccount, replying, onOpen }: { m: ListedMail; index: number; showAccount: boolean; replying: boolean; onOpen: () => void }) {
  return (
    <button
      type="button"
      className={m.unread ? 'mail-row is-unread' : 'mail-row'}
      onClick={onOpen}
      aria-label={`Message ${index}: ${m.subject} from ${m.from}${m.unread ? ', unread' : ''}, ${fullDate(m.date)}`}
    >
      <span className="mail-dot" aria-hidden="true" />
      <span className="mail-main">
        <span className="mail-line">
          <span className="mail-from" title={m.fromEmail}>
            {m.from}
          </span>
          {replying ? <span className="mail-badge reply">Draft</span> : null}
          {showAccount ? (
            <span className="mail-badge" title={m.account}>
              {m.account.split('@')[0]}
            </span>
          ) : null}
          <span className="mail-date" title={fullDate(m.date)}>
            {when(m.date)}
          </span>
        </span>
        <span className="mail-subject">{m.subject}</span>
        <span className="mail-snippet">{m.snippet}</span>
      </span>
    </button>
  )
}

function Reader({ reading, reply, state, actions }: { reading: NonNullable<MailState['reading']>; reply: ReplyState | null; state: MailState; actions: MailActions }) {
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
  useEffect(() => {
    if (!reply) backRef.current?.focus()
  }, [])
  const openLabel = providerLabel(m?.provider)
  return (
    <div className="mail-reader">
      <div className="m-bar">
        <button type="button" className="glass-button" ref={backRef} onClick={actions.back}>
          ← Back
        </button>
        {m && !reply ? (
          <Menu label="More actions" buttonClass="m-icon" buttonLabel="⋯">
            {(close) => (
              <>
                <button
                  type="button"
                  role="menuitem"
                  className="m-item"
                  onClick={() => {
                    close()
                    void actions.copyMessage()
                  }}
                >
                  Copy message text
                </button>
                <span className="m-menu-label">Category{category ? `: ${categoryLabel(category)}` : ''}</span>
                {CATEGORY_ORDER.map((c) => (
                  <button
                    type="button"
                    role="menuitemradio"
                    aria-checked={category?.category === c}
                    key={c}
                    className={category?.category === c ? 'm-item is-on' : 'm-item'}
                    onClick={() => {
                      close()
                      void actions.correct(m, c, 'message')
                    }}
                  >
                    {CATEGORY_LABELS[c]}
                  </button>
                ))}
                {category?.source === 'you' ? (
                  <button
                    type="button"
                    role="menuitem"
                    className="m-item"
                    onClick={() => {
                      close()
                      void actions.correct(m, null, category.reason.startsWith('You set this for') ? 'sender' : 'message')
                    }}
                  >
                    Undo my category change
                  </button>
                ) : null}
              </>
            )}
          </Menu>
        ) : null}
      </div>
      {state.notice ? <p className="mail-notice" role="status">{state.notice}</p> : null}
      {reading.loading ? (
        <div className="mail-loading" role="status">
          <span className="m-spinner" aria-hidden="true" /> Opening…
        </div>
      ) : null}
      {reading.error ? (
        <div className="mail-state small" role="alert">
          <p>{reading.error}</p>
          <button type="button" className="glass-button" onClick={() => actions.open(reading.key)}>
            Try again
          </button>
        </div>
      ) : null}
      {m && body ? (
        reply ? (
          <ReplyComposer reply={reply} actions={actions} openLabel={openLabel} />
        ) : (
          <>
            <div className="mail-head">
              <h2>{m.subject}</h2>
              <p className="m-from">
                <strong>{m.from}</strong> <span className="mail-muted">&lt;{m.fromEmail}&gt;</span>
              </p>
              <p className="mail-muted">
                {fullDate(m.date)}
                {state.status && state.status.accounts.length > 1 ? ` · to ${m.account}` : ''}
                {m.unread ? ' · unread' : ''}
                {body.kind === 'html' && body.blocked ? ` · ${body.blocked} image${body.blocked === 1 ? '' : 's'} blocked` : ''}
              </p>
            </div>
            {earlier.length ? <ThreadContext entries={earlier} /> : null}
            {body.kind === 'html' ? (
              <iframe className="mail-body" title="Message body" sandbox="" referrerPolicy="no-referrer" srcDoc={body.doc} />
            ) : (
              <pre className="mail-body text">{body.text}</pre>
            )}
            <div className="m-actions">
              <button type="button" className="glass-button primary" onClick={() => actions.startReply(m.key)}>
                Reply
              </button>
              <button type="button" className="glass-button" onClick={() => void actions.openOriginal(m.key)} title="Gmail may mark it as read">
                {openLabel}
              </button>
            </div>
          </>
        )
      ) : null}
    </div>
  )
}

function ReplyComposer({ reply, actions, openLabel }: { reply: ReplyState; actions: MailActions; openLabel: string }) {
  const t = reply.target
  const drafting = reply.status === 'drafting'
  const hasDraft = Boolean(reply.draft)
  const [details, setDetails] = useState(false)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const answerRef = useRef<HTMLInputElement>(null)
  const name = t.to.replace(/\s*<[^>]+>\s*$/, '') || t.toEmail
  useEffect(() => {
    if (!hasDraft) inputRef.current?.focus()
  }, [t.key])
  useEffect(() => {
    if (reply.status === 'question') answerRef.current?.focus()
  }, [reply.status, reply.question])

  const instructionField = (
    <textarea
      id="reply-instruction"
      ref={inputRef}
      className={hasDraft ? 'm-input' : 'm-input m-grow'}
      rows={3}
      value={reply.instruction}
      placeholder={`A rough line is enough, e.g. “yes, Thursday 3 pm works, I’ll bring the documents”.${
        /mac/i.test(navigator.platform || '')
          ? ' Hold Caps Lock + A to dictate.'
          : /win/i.test(navigator.platform || '')
            ? ' Hold Shift + A to dictate.'
            : ''
      }`}
      onChange={(e) => actions.setReply({ instruction: e.target.value })}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && reply.instruction.trim()) void actions.draftReply()
      }}
    />
  )

  return (
    <div className="m-reply" aria-label={`Reply to ${name}`}>
      <div className="m-reply-head">
        <button type="button" className="m-disclose" aria-expanded={details} onClick={() => setDetails((v) => !v)}>
          <span aria-hidden="true">{details ? '▾' : '▸'}</span> {reply.mode === 'standalone' ? 'New message' : `Reply to ${name}`}
        </button>
        <button type="button" className="m-link" onClick={actions.cancelReply}>
          Cancel
        </button>
      </div>
      {details ? (
        <div className="m-details">
          <p>
            <span className="m-key">To</span> {t.to}
          </p>
          <p>
            <span className="m-key">Subject</span> {reply.mode === 'standalone' ? '(new message)' : t.subject}
          </p>
          <p>
            <span className="m-key">From</span> {t.account}
          </p>
        </div>
      ) : null}
      {t.noReply ? <p className="m-note">This looks like an automated address, so it may not accept replies. You can still copy the draft.</p> : null}

      {!hasDraft ? (
        <>
          <label className="m-label" htmlFor="reply-instruction">
            What would you like to say?
          </label>
          {instructionField}
          <details className="m-share">
            <summary>MIKO shares this email and your note with its assistant (ChatGPT, via Codex). Review what’s shared</summary>
            <textarea className="m-input m-context" rows={6} value={reply.context} onChange={(e) => actions.setReply({ context: e.target.value })} aria-label="Email text shared with MIKO" />
            <button type="button" className="m-link" onClick={actions.resetContext}>
              Reset to the full email
            </button>
          </details>
        </>
      ) : (
        <>
          <label className="m-label" htmlFor="reply-draft">
            {reply.drafts > 1 ? `Draft (version ${reply.drafts})` : 'Draft'}
          </label>
          <textarea id="reply-draft" className="m-input m-draft" value={reply.draft} onChange={(e) => actions.setReply({ draft: e.target.value })} aria-label="Draft reply" />
          <form
            className="m-refine"
            onSubmit={(e) => {
              e.preventDefault()
              if (reply.followUp.trim()) void actions.refine(reply.followUp)
            }}
          >
            <input value={reply.followUp} aria-label="Ask MIKO to change it" placeholder="Ask MIKO to change it…" disabled={drafting} onChange={(e) => actions.setReply({ followUp: e.target.value })} />
            <button type="submit" className="m-icon" aria-label="Apply change" disabled={drafting || !reply.followUp.trim()}>
              ↵
            </button>
          </form>
        </>
      )}

      {reply.status === 'question' ? (
        <form
          className="m-card"
          role="group"
          aria-label="MIKO has a question"
          onSubmit={(e) => {
            e.preventDefault()
            void actions.answerQuestion()
          }}
        >
          <p>{reply.question}</p>
          <div className="m-row">
            <input ref={answerRef} value={reply.answer} aria-label="Your answer" placeholder="Your answer" onChange={(e) => actions.setReply({ answer: e.target.value })} />
            <button type="submit" className="glass-button primary" disabled={!reply.answer.trim()}>
              Continue
            </button>
          </div>
        </form>
      ) : null}
      {reply.status === 'unrelated' ? (
        <div className="m-card" role="group" aria-label="Reply or new message">
          <p>That doesn’t look like a reply to this email. What would you like?</p>
          <div className="m-row">
            <button type="button" className="glass-button primary" onClick={() => void actions.resolveUnrelated('reply')}>
              Reply to this email
            </button>
            <button type="button" className="glass-button" onClick={() => void actions.resolveUnrelated('standalone')}>
              Write a new message
            </button>
          </div>
        </div>
      ) : null}
      {reply.error ? (
        <p className={reply.status === 'failed' ? 'mail-warn' : 'mail-notice'} role="alert">
          {reply.error}
          {reply.status === 'failed' ? (
            <>
              {' '}
              <button type="button" className="m-link" onClick={() => void (hasDraft ? actions.regenerate() : actions.draftReply())}>
                Try again
              </button>
            </>
          ) : null}
        </p>
      ) : null}

      <div className="m-actions">
        {drafting ? (
          <>
            <span className="mail-loading inline" role="status">
              <span className="m-spinner" aria-hidden="true" /> {hasDraft ? 'Updating your draft…' : 'Writing your draft…'}
            </span>
            <button type="button" className="glass-button" onClick={actions.stopDrafting}>
              Stop
            </button>
          </>
        ) : !hasDraft ? (
          <button type="button" className="glass-button primary" disabled={!reply.instruction.trim() || reply.status === 'question' || reply.status === 'unrelated'} onClick={() => void actions.draftReply()}>
            Create draft
          </button>
        ) : (
          <>
            <button type="button" className="glass-button primary" onClick={() => void actions.copyReply()}>
              Copy reply
            </button>
            <button type="button" className="glass-button" onClick={() => void actions.openOriginal(t.key)} title="Reply and send from there. It may mark the email read.">
              {openLabel}
            </button>
            <Menu label="More draft options" buttonLabel="More ▾">
              {(close) => (
                <>
                  <button
                    type="button"
                    role="menuitem"
                    className="m-item"
                    onClick={() => {
                      close()
                      void actions.regenerate()
                    }}
                  >
                    Regenerate
                  </button>
                  <span className="m-menu-label">Tone</span>
                  {REFINEMENTS.map((r) => (
                    <button
                      type="button"
                      role="menuitem"
                      key={r}
                      className="m-item"
                      onClick={() => {
                        close()
                        void actions.refine(r.toLowerCase())
                      }}
                    >
                      {r}
                    </button>
                  ))}
                </>
              )}
            </Menu>
          </>
        )}
      </div>

      {hasDraft ? (
        <details className="m-share">
          <summary>View instruction</summary>
          {instructionField}
          {reply.clarifications.length ? (
            <ul className="m-answers" aria-label="Your answers to MIKO">
              {reply.clarifications.map((c, i) => (
                <li key={i}>
                  <span className="mail-muted">{c.question}</span> {c.answer}
                </li>
              ))}
            </ul>
          ) : null}
          <button type="button" className="m-link" disabled={drafting || !reply.instruction.trim()} onClick={() => void actions.draftReply()}>
            Create a new draft from this
          </button>
        </details>
      ) : null}
      <p className="m-foot">MIKO never sends mail. Copy the reply, open the email, and send it yourself.</p>
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
