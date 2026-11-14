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
    }
  | { id: number; kind: 'choices'; purpose: 'open' | 'close' | 'chat' | 'mail-or-app'; text: string; options: PanelChoice[] }
  | { id: number; kind: 'confirm'; purpose: 'launch' | 'force' | 'quit' | 'close'; text: string; appId: string; name: string }
  | { id: number; kind: 'closing'; appId: string; name: string; text: string }

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
  view?: 'log' | 'chats'
  onView?: (view: 'log' | 'chats') => void
  chats?: SavedChat[]
  chatTools?: Omit<SavedChatsProps, 'chats'>
  onDestination?: (id: number, name: string) => void
  /** Chat / Mail tabs. Mail content replaces the conversation. */
  tab?: 'chat' | 'mail'
  onTab?: (tab: 'chat' | 'mail') => void
  mail?: ReactNode
}

export const MAIL_NOTE =
  'ChatGPT does the checking with the mail accounts connected to your ChatGPT account. MIKO never sees your mail or the summary.'

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
        {onView && tab === 'chat' ? (
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
                  <p className="panel-detail note">{entry.variant === 'mail' ? MAIL_NOTE : HANDOFF_NOTE}</p>
                  {entry.reply ? <p className="pasted">{entry.reply}</p> : null}
                  <div className="panel-inline">
                    <button type="button" className="text-button" onClick={() => onUseChatGpt?.(entry.id)}>
                      {entry.variant === 'mail' ? 'Continue in ChatGPT' : 'Copy and open ChatGPT'}
                    </button>
                    <button type="button" className="text-button secondary" onClick={() => onPasteReply?.(entry.id)}>
                      Paste reply
                    </button>
                  </div>
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
