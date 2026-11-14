import { useEffect, useRef, useState } from 'react'

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
    }
  | { id: number; kind: 'choices'; purpose: 'open' | 'close'; text: string; options: PanelChoice[] }
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
}

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
  onSpeak
}: TextPanelProps) {
  const [localDraft, setLocalDraft] = useState('')
  const [localReplies, setLocalReplies] = useState<string[]>([])
  const logRef = useRef<HTMLDivElement>(null)
  const value = draft ?? localDraft
  const notes = entries ?? (replies ?? localReplies).map((text, index) => ({ id: index, kind: 'note' as const, text }))

  useEffect(() => {
    const log = logRef.current
    if (log) log.scrollTop = log.scrollHeight
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
    <section className="panel" data-hit="panel" aria-label="Talk to MIKO">
      <header className="panel-bar">
        <h1>MIKO</h1>
        <button type="button" className="close" onClick={onClose} aria-label="Close">
          ×
        </button>
      </header>
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
                  <p className="panel-detail">{entry.detail}</p>
                  {entry.reply ? <p className="pasted">{entry.reply}</p> : null}
                  <div className="panel-inline">
                    <button type="button" className="text-button" onClick={() => onUseChatGpt?.(entry.id)}>
                      Use ChatGPT
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
    </section>
  )
}
