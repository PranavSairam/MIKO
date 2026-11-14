import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { SavedChat } from '../../../shared/api'
import { SavedChats, type SavedChatsProps } from './SavedChats'

export const COMMANDS_LATER = 'Commands are coming next.'

export interface PanelChoice {
  id: string
  name: string
  familiar: boolean
}

export type PanelEntry =
  | { id: number; kind: 'note'; text: string }
  | {
      id: number
      kind: 'handoff'
      prompt: string
      status: 'ready' | 'copied' | 'copied-only' | 'browser-only' | 'pasted'
      detail: string
      reply?: string
      /** Saved chat name to open on handoff; '' means ChatGPT itself. */
      destination?: string
      /** 'mail': the expanded "check mail" request (no destination picker). */
      variant?: 'mail'
      /** ChatGPT's box already has text: ask Append or Replace. */
      choose?: boolean
    }
  | { id: number; kind: 'choices'; purpose: 'open' | 'close' | 'chat' | 'mail-or-app' | 'free-text'; text: string; options: PanelChoice[]; payload?: string }
  | { id: number; kind: 'confirm'; purpose: 'launch' | 'force' | 'quit' | 'close'; text: string; appId: string; name: string }
  | { id: number; kind: 'closing'; appId: string; name: string; text: string }
  | {
      id: number
      kind: 'bridge'
      requestId: string
      prompt: string
      status: 'sending' | 'running' | 'done' | 'failed' | 'cancelled' | 'timeout'
      reply: string
      thread: string
      detail: string
      kept: boolean
      startedAt?: number
      /** Message number within its conversation. */
      turn?: number
      /** Set when this is a selected-text action. */
      selection?: { captureId: string; action: string; label: string; instruction: string; canReplace: boolean; app: string; text: string }
      question?: string
      after?: string
    }
  | {
      id: number
      kind: 'selection'
      captureId: string
      ok: boolean
      text: string
      app: string
      method: string
      canReplace: boolean
      reason: string
    }

interface TextPanelProps {
  onClose: () => void
  draft?: string
  onDraft?: (value: string) => void
  replies?: string[]
  entries?: PanelEntry[]
  onSubmit?: () => void
  onUseChatGpt?: (id: number) => void
  onPasteReply?: (id: number) => void
  onChoose?: (entryId: number, appId: string) => void
  onConfirm?: (id: number) => void
  onDismiss?: (id: number) => void
  listening?: boolean
  listenDetail?: string
  onListen?: () => void
  onListenStop?: () => void
  onListenCancel?: () => void
  canSpeak?: boolean
  onSpeak?: (text: string) => void
  /** 'chats' swaps the conversation for the Saved chats manager. */
  view?: 'log' | 'chats' | 'prefs'
  onView?: (view: 'log' | 'chats' | 'prefs') => void
  chats?: SavedChat[]
  chatTools?: Omit<SavedChatsProps, 'chats'>
  onDestination?: (id: number, name: string) => void
  onInsertChoice?: (id: number, mode: 'append' | 'replace' | null) => void
  onSelectionAction?: (id: number, action: string, instruction: string) => void
  onUseClipboard?: () => void
  onResultCopy?: (id: number) => void
  onResultReplace?: (id: number) => void
  onResultPaste?: (id: number) => void
  onResultAnswer?: (id: number, answer: string) => void
  pasteBanner?: { entryId: number; text: string; armed: boolean } | null
  onPasteCancel?: () => void
  onBridgeCancel?: (requestId: string) => void
  onBridgeNew?: () => void
  onAskInChatGpt?: (prompt: string) => void
  assistantThread?: string
  prefs?: {
    text: string
    message: string
    onSave: (text: string) => Promise<void>
    shortcut: string
    onSaveShortcut: (value: string) => Promise<void>
  }
  /** Chat / Mail tabs. Mail content replaces the conversation. */
  tab?: 'chat' | 'mail'
  onTab?: (tab: 'chat' | 'mail') => void
  mail?: ReactNode
}

export const MAIL_NOTE =
  'ChatGPT does the checking with the mail accounts connected to your ChatGPT account. MIKO never sees your mail or the summary.'

export const ASSISTANT_NOTE =
  'Runs on Codex with your ChatGPT sign-in, in its own MIKO conversation. It can\u2019t see your ChatGPT chats, memory, files or mail. Say \u201cask GPT \u2026\u201d for your ChatGPT chats.'

export const HANDOFF_NOTE =
  'Continuing in ChatGPT uses that conversation\u2019s context and your account\u2019s memory settings. MIKO hasn\u2019t read any of it.'

export function TextPanel({
  onClose,
  draft,
  onDraft,
  replies,
  entries,
  onSubmit,
  onUseChatGpt,
  onPasteReply,
  onChoose,
  onConfirm,
  onDismiss,
  listening = false,
  listenDetail = '',
  onListen,
  onListenStop,
  onListenCancel,
  canSpeak = false,
  onSpeak,
  view = 'log',
  onView,
  chats = [],
  chatTools,
  onDestination,
  onBridgeCancel,
  onInsertChoice,
  onSelectionAction,
  onUseClipboard,
  onResultCopy,
  onResultReplace,
  onResultPaste,
  onResultAnswer,
  pasteBanner,
  onPasteCancel,
  onBridgeNew,
  onAskInChatGpt,
  assistantThread = '',
  prefs,
  tab = 'chat',
  onTab,
  mail
}: TextPanelProps) {
  const [localDraft, setLocalDraft] = useState('')
  const [localReplies, setLocalReplies] = useState<string[]>([])
  const logRef = useRef<HTMLDivElement>(null)
  const value = draft ?? localDraft
  const notes = entries ?? (replies ?? localReplies).map((text, index) => ({ id: index, kind: 'note' as const, text }))

  useEffect(() => {
    const log = logRef.current
    if (!log) return
    // Show the start of the newest entry; a tall card (question + actions) would otherwise show only its buttons.
    const last = log.lastElementChild as HTMLElement | null
    log.scrollTop = last ? Math.max(0, last.offsetTop - log.offsetTop) : log.scrollHeight
  }, [entries, replies, localReplies])

  function setValue(next: string): void {
    if (onDraft) onDraft(next)
    else setLocalDraft(next)
  }

  function submit(): void {
    if (value.trim().length === 0) return
    if (onSubmit) onSubmit()
    else {
      setLocalReplies((items) => [...items, COMMANDS_LATER])
      setLocalDraft('')
    }
  }

  return (
    <section className={tab === 'mail' ? 'panel glass is-mail' : 'panel glass'} data-hit="panel" aria-label="Talk to MIKO">
      <header className="panel-bar">
        <h1>{view === 'chats' && tab === 'chat' ? 'Saved chats' : 'MIKO'}</h1>
        {onTab ? (
          <div className="tabs" role="tablist" aria-label="Panel">
            {(['chat', 'mail'] as const).map((t) => (
              <button
                type="button"
                role="tab"
                key={t}
                aria-selected={tab === t}
                className={tab === t ? 'tab is-on' : 'tab'}
                onClick={() => onTab(t)}
              >
                {t === 'chat' ? 'Chat' : 'Mail'}
              </button>
            ))}
          </div>
        ) : null}
        {onView && prefs && tab === 'chat' ? (
          <button
            type="button"
            className="icon-button"
            aria-label={view === 'prefs' ? 'Back' : 'MIKO preferences'}
            title="MIKO preferences"
            onClick={() => onView(view === 'prefs' ? 'log' : 'prefs')}
          >
            {view === 'prefs' ? '←' : '⚙'}
          </button>
        ) : null}
        {onView && tab === 'chat' && view !== 'prefs' ? (
          <button
            type="button"
            className="text-button secondary bar-button"
            onClick={() => onView(view === 'chats' ? 'log' : 'chats')}
          >
            {view === 'chats' ? 'Back' : 'Saved chats'}
          </button>
        ) : null}
        <button type="button" className="close" onClick={onClose} aria-label="Close">
          ×
        </button>
      </header>
      {tab === 'mail' && mail ? (
        mail
      ) : view === 'prefs' && prefs ? (
        <Preferences {...prefs} />
      ) : view === 'chats' && chatTools ? (
        <SavedChats chats={chats} {...chatTools} />
      ) : (
      <>
      <div className="panel-log" ref={logRef} role="log" aria-live="polite" aria-label="MIKO replies">
        {notes.length === 0 ? (
          <p className="panel-empty">MIKO is listening.</p>
        ) : (
          notes.map((entry) => (
            <div className="panel-entry" key={entry.id}>
              {entry.kind === 'note' || entry.kind === 'closing' ? (
                <>
                  <p>{entry.text}</p>
                  {canSpeak && entry.kind === 'note' ? (
                    <div className="panel-inline">
                      <button type="button" className="text-button secondary" onClick={() => onSpeak?.(entry.text)}>
                        Read aloud
                      </button>
                    </div>
                  ) : null}
                </>
              ) : null}
              {entry.kind === 'handoff' ? (
                <>
                  <p className="prompt">{entry.prompt}</p>
                  {chats.length > 0 && entry.variant !== 'mail' ? (
                    <label className="destination">
                      Send to{' '}
                      <select
                        value={entry.destination ?? ''}
                        onChange={(event) => onDestination?.(entry.id, event.target.value)}
                      >
                        <option value="">ChatGPT</option>
                        {chats.map((chat) => (
                          <option key={chat.name} value={chat.name}>
                            {chat.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : null}
                  <p className="panel-detail">{entry.detail}</p>
                  {pasteBanner && pasteBanner.entryId === entry.id ? (
                    <div className="paste-banner" role="status">
                      <span>{pasteBanner.text}</span>
                      {pasteBanner.armed ? (
                        <button type="button" className="text-button secondary" onClick={() => onPasteCancel?.()}>
                          Cancel
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                  <p className="panel-detail note">{entry.variant === 'mail' ? MAIL_NOTE : HANDOFF_NOTE}</p>
                  {entry.reply ? <p className="pasted">{entry.reply}</p> : null}
                  <div className="panel-inline">
                    <button type="button" className="text-button" onClick={() => onUseChatGpt?.(entry.id)}>
                      {entry.variant === 'mail' ? 'Continue in ChatGPT' : 'Ask in ChatGPT'}
                    </button>
                    {entry.choose ? (
                      <>
                        <button type="button" className="text-button" onClick={() => onInsertChoice?.(entry.id, 'append')}>
                          Append
                        </button>
                        <button type="button" className="text-button" onClick={() => onInsertChoice?.(entry.id, 'replace')}>
                          Replace
                        </button>
                        <button type="button" className="text-button secondary" onClick={() => onInsertChoice?.(entry.id, null)}>
                          Cancel
                        </button>
                      </>
                    ) : null}
                    <button type="button" className="text-button secondary" onClick={() => onPasteReply?.(entry.id)}>
                      Paste reply
                    </button>
                  </div>
                </>
              ) : null}
              {entry.kind === 'selection' ? (
                <SelectionCard entry={entry} onAction={onSelectionAction} onUseClipboard={onUseClipboard} />
              ) : null}
              {entry.kind === 'bridge' && entry.selection ? (
                <ResultCard
                  entry={entry}
                  onCancel={onBridgeCancel}
                  onCopy={onResultCopy}
                  onReplace={onResultReplace}
                  onPaste={onResultPaste}
                  onAnswer={onResultAnswer}
                  paste={pasteBanner && pasteBanner.entryId === entry.id ? pasteBanner : null}
                  onPasteCancel={onPasteCancel}
                />
              ) : null}
              {entry.kind === 'bridge' && !entry.selection ? (
                <>
                  <p className="assistant-label">
                    MIKO assistant · {entry.thread ? `conversation ${entry.thread.slice(0, 8)}` : 'new conversation'}
                    {entry.turn && entry.turn > 1 ? ` · follow-up ${entry.turn - 1}` : ''}
                  </p>
                  <p className="prompt">{entry.prompt}</p>
                  {entry.status === 'sending' || entry.status === 'running' ? (
                    <p className="panel-detail">
                      Thinking… {entry.startedAt ? Math.floor((Date.now() - entry.startedAt) / 1000) : 0} s
                    </p>
                  ) : null}
                  {entry.status === 'done' ? <p className="assistant-reply">{entry.reply}</p> : null}
                  {entry.detail ? <p className="panel-detail">{entry.detail}</p> : null}
                  <div className="panel-inline">
                    {entry.status === 'sending' || entry.status === 'running' ? (
                      <button type="button" className="text-button secondary" onClick={() => onBridgeCancel?.(entry.requestId)}>
                        Cancel
                      </button>
                    ) : null}
                    {entry.status === 'done' && entry.thread && entry.thread === assistantThread ? (
                      <button type="button" className="text-button secondary" onClick={() => onBridgeNew?.()}>
                        New conversation
                      </button>
                    ) : null}
                    {entry.status !== 'sending' && entry.status !== 'running' ? (
                      <button type="button" className="text-button secondary" onClick={() => onAskInChatGpt?.(entry.prompt)}>
                        Ask in ChatGPT app
                      </button>
                    ) : null}
                  </div>
                  <p className="panel-detail note">{ASSISTANT_NOTE}</p>
                </>
              ) : null}
              {entry.kind === 'choices' ? (
                <>
                  <p>{entry.text}</p>
                  <div className="panel-inline">
                    {entry.options.map((option) => (
                      <button
                        type="button"
                        className="text-button"
                        key={option.id}
                        onClick={() => onChoose?.(entry.id, option.id)}
                      >
                        {option.name}
                      </button>
                    ))}
                  </div>
                </>
              ) : null}
              {entry.kind === 'confirm' ? (
                <>
                  <p>{entry.text}</p>
                  <div className="panel-inline">
                    <button type="button" className="text-button" onClick={() => onConfirm?.(entry.id)}>
                      {entry.purpose === 'force'
                        ? 'Force quit'
                        : entry.purpose === 'quit'
                          ? 'Quit MIKO'
                          : entry.purpose === 'close'
                            ? `Close ${entry.name}`
                            : `Launch ${entry.name}`}
                    </button>
                    <button type="button" className="text-button secondary" onClick={() => onDismiss?.(entry.id)}>
                      Not now
                    </button>
                  </div>
                </>
              ) : null}
            </div>
          ))
        )}
      </div>
      <textarea
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' || event.shiftKey) return
          event.preventDefault()
          submit()
        }}
        placeholder="Say something…"
        maxLength={400}
        spellCheck={false}
        autoFocus
        aria-label="Message"
      />
      {listening ? (
        <div className="listen-bar" role="status">
          <span>{listenDetail || 'Listening…'}</span>
          <button type="button" className="text-button" onClick={onListenStop}>
            Stop
          </button>
          <button type="button" className="text-button secondary" onClick={onListenCancel}>
            Cancel
          </button>
        </div>
      ) : null}
      <div className="panel-actions">
        <button
          type="button"
          className={listening ? 'mic is-live' : 'mic'}
          aria-pressed={listening}
          aria-label={listening ? 'Listening' : 'Microphone'}
          onClick={onListen}
          disabled={listening}
        >
          Mic
        </button>
        <button type="button" className="send" onClick={submit} disabled={value.trim().length === 0}>
          Send
        </button>
      </div>
      </>
      )}
    </section>
  )
}

function Preferences({
  text,
  message,
  onSave,
  shortcut,
  onSaveShortcut
}: {
  text: string
  message: string
  onSave: (text: string) => Promise<void>
  shortcut: string
  onSaveShortcut: (value: string) => Promise<void>
}) {
  const [draft, setDraft] = useState(text)
  const [key, setKey] = useState(shortcut)
  return (
    <div className="prefs">
      <p className="panel-detail">
        <strong>MIKO preferences</strong>: things you want MIKO to remember (name, tone, context). Stored only on this Mac and
        added to new MIKO assistant conversations. Separate from ChatGPT&apos;s memory.
      </p>
      <textarea
        className="prefs-text"
        value={draft}
        maxLength={2000}
        placeholder="e.g. Call me Pranav. Keep answers short. I'm building MIKO, a desktop dog."
        aria-label="MIKO preferences"
        onChange={(event) => setDraft(event.target.value)}
      />
      {message ? <p className="panel-detail" role="status">{message}</p> : null}
      <div className="panel-inline">
        <button type="button" className="text-button" onClick={() => void onSave(draft)} disabled={draft === text}>
          Save
        </button>
        <span className="panel-detail">{draft.length}/2000</span>
      </div>
      <div className="selection-row">
        <input value={key} aria-label="Selection assistant shortcut" placeholder="Control+Option+S" onChange={(e) => setKey(e.target.value)} />
        <button type="button" className="text-button secondary" disabled={!key.trim() || key === shortcut} onClick={() => void onSaveShortcut(key)}>
          Set selection shortcut
        </button>
      </div>
    </div>
  )
}

type SelectionEntry = Extract<PanelEntry, { kind: 'selection' }>
type BridgeEntry = Extract<PanelEntry, { kind: 'bridge' }>

function SelectionCard({
  entry,
  onAction,
  onUseClipboard
}: {
  entry: SelectionEntry
  onAction?: (id: number, action: string, instruction: string) => void
  onUseClipboard?: () => void
}) {
  const [tone, setTone] = useState('')
  const [reply, setReply] = useState('')
  const [ask, setAsk] = useState('')
  if (!entry.ok) {
    return (
      <>
        <p className="assistant-label">Selected text</p>
        <p>{entry.reason}</p>
        <div className="panel-inline">
          <button type="button" className="text-button" onClick={() => onUseClipboard?.()}>
            Use clipboard text
          </button>
        </div>
      </>
    )
  }
  const via = entry.method === 'ax' ? 'read via Accessibility' : entry.method === 'copy' ? 'copied with ⌘C' : 'from the clipboard'
  return (
    <>
      <p className="assistant-label">
        Selected in {entry.app} · {via}
        {entry.canReplace ? '' : ' · replace not available'}
      </p>
      <blockquote className="selection-quote">{entry.text}</blockquote>
      <div className="panel-inline wrap">
        {(['grammar', 'summarize', 'explain'] as const).map((a) => (
          <button type="button" key={a} className="text-button" onClick={() => onAction?.(entry.id, a, '')}>
            {a === 'grammar' ? 'Fix grammar' : a === 'summarize' ? 'Summarize' : 'Explain'}
          </button>
        ))}
      </div>
      <div className="selection-row">
        <input value={tone} placeholder="Tone, e.g. friendly" aria-label="Rewrite tone" onChange={(e) => setTone(e.target.value)} />
        <button type="button" className="text-button" disabled={!tone.trim()} onClick={() => onAction?.(entry.id, 'rewrite', tone)}>
          Rewrite
        </button>
      </div>
      <div className="selection-row">
        <input value={reply} placeholder="Reply saying…" aria-label="Reply instruction" onChange={(e) => setReply(e.target.value)} />
        <button type="button" className="text-button" disabled={!reply.trim()} onClick={() => onAction?.(entry.id, 'reply', reply)}>
          Draft reply
        </button>
      </div>
      <div className="selection-row">
        <input value={ask} placeholder="Ask about it (optional)" aria-label="Question about the text" onChange={(e) => setAsk(e.target.value)} />
        <button type="button" className="text-button secondary" onClick={() => onAction?.(entry.id, 'ask', ask)}>
          Start conversation
        </button>
      </div>
    </>
  )
}

function ResultCard({
  entry,
  onCancel,
  onCopy,
  onReplace,
  onPaste,
  onAnswer,
  paste,
  onPasteCancel
}: {
  entry: BridgeEntry
  onCancel?: (requestId: string) => void
  onCopy?: (id: number) => void
  onReplace?: (id: number) => void
  onPaste?: (id: number) => void
  onAnswer?: (id: number, answer: string) => void
  paste: { text: string; armed: boolean } | null
  onPasteCancel?: () => void
}) {
  const [answer, setAnswer] = useState('')
  const sel = entry.selection as NonNullable<BridgeEntry['selection']>
  const pending = entry.status === 'sending' || entry.status === 'running'
  return (
    <>
      <p className="assistant-label">
        MIKO assistant · {sel.label} · text from {sel.app}
      </p>
      {sel.instruction ? <p className="panel-detail">Your instruction: {sel.instruction}</p> : null}
      {pending ? (
        <p className="panel-detail">Thinking… {entry.startedAt ? Math.floor((Date.now() - entry.startedAt) / 1000) : 0} s</p>
      ) : null}
      {entry.question ? (
        <>
          <p className="panel-detail">MIKO needs one detail first:</p>
          <p className="assistant-reply">{entry.question}</p>
          <div className="selection-row">
            <input value={answer} placeholder="Your answer" aria-label="Answer" onChange={(e) => setAnswer(e.target.value)} />
            <button type="button" className="text-button" disabled={!answer.trim()} onClick={() => onAnswer?.(entry.id, answer)}>
              Answer
            </button>
          </div>
        </>
      ) : entry.status === 'done' ? (
        <p className="assistant-reply result">{entry.reply}</p>
      ) : null}
      {entry.detail ? <p className="panel-detail">{entry.detail}</p> : null}
      {entry.after ? <p className="panel-detail" role="status">{entry.after}</p> : null}
      {paste ? (
        <div className="paste-banner" role="status">
          <span>{paste.text}</span>
          {paste.armed ? (
            <button type="button" className="text-button secondary" onClick={() => onPasteCancel?.()}>
              Cancel
            </button>
          ) : null}
        </div>
      ) : null}
      <div className="panel-inline wrap">
        {pending ? (
          <button type="button" className="text-button secondary" onClick={() => onCancel?.(entry.requestId)}>
            Cancel
          </button>
        ) : null}
        {entry.status === 'done' && !entry.question ? (
          <>
            <button type="button" className="text-button" onClick={() => onCopy?.(entry.id)}>
              Copy
            </button>
            {sel.canReplace ? (
              <button type="button" className="text-button" onClick={() => onReplace?.(entry.id)}>
                Replace selection
              </button>
            ) : null}
            <button type="button" className="text-button secondary" onClick={() => onPaste?.(entry.id)}>
              Paste where I click
            </button>
          </>
        ) : null}
      </div>
    </>
  )
}
