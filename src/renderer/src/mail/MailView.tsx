import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ImportanceRules, ListedMail, MailMessage } from '../../../shared/api'
import { readerDocument, sanitizeEmailHtml } from './sanitize'
import type { MailActions, MailState } from './useMail'

interface MailViewProps {
  state: MailState
  actions: MailActions
  /** Hand the read-only mail-check request to ChatGPT instead (no mail reaches MIKO). */
  onAskChatGpt: () => void
  /** Enter in the search box: commands run, bare keywords search mail. */
  onCommand: (text: string) => void
}

const DAY = 86_400_000

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

function badge(account: string): string {
  return account.split('@')[0].slice(0, 10)
}

export function MailView({ state, actions, onAskChatGpt, onCommand }: MailViewProps) {
  const { status } = state
  const listRef = useRef<HTMLDivElement>(null)
  const [showRules, setShowRules] = useState(false)
  const [showAccounts, setShowAccounts] = useState(false)
  const multi = (status?.accounts.length ?? 0) > 1

  // Restore the result list's scroll position when coming back from a message.
  useLayoutEffect(() => {
    if (!state.reading && listRef.current) listRef.current.scrollTop = actions.scrollTop()
  }, [state.reading])

  if (!status) return <div className="mail-state">Loading mail…</div>

  if (!status.accounts.length) {
    return (
      <div className="mail-state">
        <h2>Connect mail</h2>
        {status.configured ? (
          <>
            <p>Connect a Gmail account to read your mail here. MIKO asks Google for read-only access and keeps the sign-in in your Mac’s Keychain.</p>
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

  return (
    <div className="mail">
      <div className="mail-toolbar">
        <div className="mail-search">
          <input
            value={state.query}
            placeholder="Search all mail"
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
      <div className="mail-filters" role="tablist" aria-label="Filter">
        {(['recent', 'unread', 'important'] as const).map((f) => (
          <button
            type="button"
            role="tab"
            key={f}
            aria-selected={state.filter === f}
            className={state.filter === f ? 'chip is-on' : 'chip'}
            onClick={() => actions.setFilter(f)}
          >
            {f === 'recent' ? 'Recent' : f === 'unread' ? 'Unread' : state.unreadOnly ? 'Important · unread' : 'Important'}
          </button>
        ))}
        {state.filter === 'important' ? (
          <button type="button" className="chip subtle" onClick={() => setShowRules((v) => !v)} aria-expanded={showRules}>
            Rules
          </button>
        ) : null}
        <span className="mail-scope">
          {status.accounts.length === 1 ? `Connected: ${status.accounts[0].email} · ` : `${status.accounts.length} accounts · `}
          {state.activeQuery ? `Search: ${state.activeQuery}` : state.filter === 'recent' ? 'Inbox · newest first' : 'Inbox'}
        </span>
      </div>
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
              Reconnect {multi ? email : ''}
            </button>
          ))}
        </div>
      ) : null}
      {status.preview ? <div className="mail-banner preview">Development preview: sample messages, not your mail.</div> : null}
      {state.notice ? <p className="mail-notice" role="status">{state.notice}</p> : null}

      {state.reading ? (
        <Reader reading={state.reading} onBack={actions.back} onOpenOriginal={actions.openOriginal} />
      ) : (
        <div className="mail-list" ref={listRef} onScroll={(event) => actions.rememberScroll(event.currentTarget.scrollTop)}>
          {state.error ? (
            <div className="mail-state small">
              <p>{state.error}</p>
              <button type="button" className="glass-button" onClick={actions.refresh}>
                Try again
              </button>
            </div>
          ) : null}
          {state.items.map((m, i) => (
            <Row key={m.key} index={i + 1} m={m} showAccount={multi} showReason={state.filter === 'important'} onOpen={() => actions.open(m.key)} />
          ))}
          {state.loading ? <div className="mail-loading">{state.items.length ? 'Loading more…' : 'Loading mail…'}</div> : null}
          {!state.loading && !state.items.length && !state.error ? (
            <div className="mail-state small">
              {state.activeQuery ? `Nothing matches “${state.activeQuery}”.` : state.filter === 'unread' ? 'No unread mail.' : state.filter === 'important' ? 'Nothing important found.' : 'Your inbox is empty.'}
            </div>
          ) : null}
          {!state.loading && !state.done && state.items.length ? (
            <button type="button" className="glass-button more" onClick={actions.loadMore}>
              Load more
            </button>
          ) : null}
        </div>
      )}
    </div>
  )
}

function Row({ m, index, showAccount, showReason, onOpen }: { m: ListedMail; index: number; showAccount: boolean; showReason: boolean; onOpen: () => void }) {
  const imp = m.importance
  return (
    <button type="button" className={m.unread ? 'mail-row is-unread' : 'mail-row'} onClick={onOpen} aria-label={`Message ${index}: ${m.subject} from ${m.from}${m.unread ? ', unread' : ''}`}>
      <span className="mail-dot" aria-hidden="true" />
      <span className="mail-main">
        <span className="mail-line">
          <span className="mail-from">{m.from}</span>
          {showAccount ? <span className="mail-badge" title={m.account}>{badge(m.account)}</span> : null}
          {imp.important ? (
            <span className={imp.source === 'provider' ? 'mail-imp provider' : 'mail-imp'} title={imp.reasons.join(' · ')}>
              {imp.source === 'provider' ? 'Gmail: important' : 'Rule'}
            </span>
          ) : null}
          <span className="mail-date" title={fullDate(m.date)}>{when(m.date)}</span>
        </span>
        <span className="mail-subject">{m.subject}</span>
        <span className="mail-snippet">{m.snippet}</span>
        {showReason && imp.important ? <span className="mail-reason">{imp.source === 'rules' ? 'Heuristic: ' : ''}{imp.reasons.join(' · ')}</span> : null}
      </span>
    </button>
  )
}

function Reader({
  reading,
  onBack,
  onOpenOriginal
}: {
  reading: NonNullable<MailState['reading']>
  onBack: () => void
  onOpenOriginal: (key: string) => Promise<void>
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
  const backRef = useRef<HTMLButtonElement>(null)
  useEffect(() => backRef.current?.focus(), [])
  return (
    <div className="mail-reader">
      <div className="mail-reader-bar">
        <button type="button" className="glass-button" ref={backRef} onClick={onBack}>
          ← Back to results
        </button>
        {m ? (
          <button type="button" className="glass-button" onClick={() => void onOpenOriginal(m.key)} title="Opens in Gmail, which may mark it read">
            Open original
          </button>
        ) : null}
      </div>
      {reading.loading ? <div className="mail-loading">Opening…</div> : null}
      {reading.error ? <div className="mail-state small">{reading.error}</div> : null}
      {m && body ? (
        <>
          <div className="mail-head">
            <h2>{m.subject}</h2>
            <p>
              <strong>{m.from}</strong> &lt;{m.fromEmail}&gt;
            </p>
            <p className="mail-muted">To: {m.to || '—'}{m.cc ? ` · Cc: ${m.cc}` : ''}</p>
            <p className="mail-muted">
              {fullDate(m.date)} · {m.account}
              {m.unread ? ' · still unread' : ''}
            </p>
            {body.kind === 'html' && body.blocked ? <p className="mail-muted">{body.blocked} remote image{body.blocked === 1 ? '' : 's'} blocked.</p> : null}
          </div>
          {body.kind === 'html' ? (
            <iframe className="mail-body" title="Message body" sandbox="" referrerPolicy="no-referrer" srcDoc={body.doc} />
          ) : (
            <pre className="mail-body text">{body.text}</pre>
          )}
        </>
      ) : null}
    </div>
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
      <p className="mail-muted">Important = Gmail&apos;s own flag, plus MIKO&apos;s heuristic rules (shown as &ldquo;Rule&rdquo; with the reason).</p>
      {toggle('providerFlag', 'Gmail importance flag')}
      {toggle('directRequests', 'Direct requests to me')}
      {toggle('deadlines', 'Deadlines')}
      {toggle('approvals', 'Approvals')}
      {toggle('payments', 'Payments and invoices')}
      <label className="rule">
        Keywords{' '}
        <input value={keywords} placeholder="e.g. FreshNet, interview" onChange={(e) => setKeywords(e.target.value)} />
      </label>
      <button
        type="button"
        className="glass-button primary"
        onClick={() => void onSave({ ...draft, keywords: keywords.split(',').map((k) => k.trim()).filter(Boolean) })}
      >
        Save rules
      </button>
    </div>
  )
}

function GoogleSetup({ onSaved }: { onSaved: () => void }) {
  const [clientId, setClientId] = useState('')
  const [secret, setSecret] = useState('')
  const [message, setMessage] = useState('')
  const [saving, setSaving] = useState(false)
  return (
    <div className="mail-setup">
      <p>Gmail needs a one-time Google Cloud setup (steps in PROJECT_LOG.md, “Gmail setup”). Then paste your Desktop app client here.</p>
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
      <p className="mail-muted">Stored encrypted on this Mac (Keychain). MIKO only asks Google for read-only Gmail access.</p>
      {message ? <p className="mail-notice" role="status">{message}</p> : null}
    </div>
  )
}
