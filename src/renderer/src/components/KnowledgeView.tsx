import { useDeferredValue, useEffect, useRef, useState, type DragEvent } from 'react'
import type { KnowledgeHit } from '../../../shared/api'
import {
  canRetry,
  formatBytes,
  KNOWLEDGE_LIMITS,
  statusLabel,
  SUPPORTED_FORMATS_LABEL,
  whereLabel,
  type KnowledgeAddResult,
  type KnowledgeSourceInfo,
  type KnowledgeState,
  type PassagePreview
} from '../../../shared/knowledge'
import { Button } from '../ui/Button'
import { FileCard, SourceCard } from '../ui/Cards'
import { Dialog } from '../ui/Dialog'
import { EmptyState, ErrorState, TaskStatus } from '../ui/Status'

export interface KnowledgeViewProps {
  state: KnowledgeState | null
  lastAdd: KnowledgeAddResult | null
  onAdd: (how: 'files' | 'folder') => void
  onDropFiles: (files: File[]) => void
  onSample: () => void
  onAction: (action: 'cancel' | 'retry' | 'refresh' | 'remove' | 'clear' | 'consent-on' | 'consent-off', id?: string) => void
  onAsk: (question: string) => void
  onSearch: (query: string) => Promise<KnowledgeHit[]>
  onPreview: (hit: KnowledgeHit) => Promise<PassagePreview>
  onOpen: (sourceId: string) => void
}

const LIMITS_TEXT = `${SUPPORTED_FORMATS_LABEL}. Up to ${formatBytes(KNOWLEDGE_LIMITS.maxFileBytes.pdf)} per PDF, ${formatBytes(KNOWLEDGE_LIMITS.maxFileBytes.docx)} per DOCX, ${formatBytes(KNOWLEDGE_LIMITS.maxFileBytes.txt)} per text file, ${KNOWLEDGE_LIMITS.maxFilesPerAdd} files per folder. Scanned PDFs need real text: MIKO doesn’t do OCR.`

function tone(s: KnowledgeSourceInfo): 'plain' | 'warn' | 'error' {
  if (s.status === 'indexed' || s.status === 'queued' || s.status === 'indexing') return 'plain'
  if (s.status === 'unreadable' || s.status === 'missing') return 'error'
  return 'warn'
}

function badge(s: KnowledgeSourceInfo): string {
  if (s.status === 'indexed') return 'is-ok'
  if (s.status === 'queued' || s.status === 'indexing') return ''
  return tone(s) === 'error' ? 'is-error' : 'is-warn'
}

/**
 * Knowledge tab: add documents → ask → inspect sources. One scrolling column; long lists and
 * details collapse. Everything here is local except answers, which go through the chat.
 */
export function KnowledgeView(props: KnowledgeViewProps) {
  const { state, lastAdd } = props
  const [question, setQuestion] = useState('')
  const [results, setResults] = useState<KnowledgeHit[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [preview, setPreview] = useState<{ hit: KnowledgeHit; data: PassagePreview } | null>(null)
  const [confirm, setConfirm] = useState<null | { kind: 'clear' } | { kind: 'remove'; source: KnowledgeSourceInfo }>(null)
  const [dragging, setDragging] = useState(false)
  const shownResults = useDeferredValue(results)

  const sources = state?.sources ?? []
  const ready = sources.filter((s) => s.status === 'indexed').length
  const pending = state?.pending ?? 0

  async function findPassages(): Promise<void> {
    const q = question.trim()
    if (!q) return
    setSearching(true)
    setPreview(null)
    try {
      setResults(await props.onSearch(q))
    } finally {
      setSearching(false)
    }
  }

  function onDrop(event: DragEvent<HTMLElement>): void {
    event.preventDefault()
    event.stopPropagation()
    setDragging(false)
    const files = Array.from(event.dataTransfer.files ?? [])
    if (files.length) props.onDropFiles(files)
  }

  return (
    <div className="knowledge" aria-label="Knowledge">
      <div className="knowledge-scroll">
        <div className="knowledge-head">
          <h2>Your documents</h2>
          <span className="ui-badge" title="Matching uses the words in your question. Meaning-based (semantic) search isn’t included in this version.">
            Keyword search · on this computer
          </span>
        </div>


        {lastAdd && (lastAdd.note || lastAdd.skipped.length) ? (
          <details className="knowledge-skipped">
            <summary>
              {lastAdd.note || 'Some items were skipped.'} {lastAdd.skipped.length ? `${lastAdd.skipped.length} skipped for safety or access.` : ''}
            </summary>
            <ul>
              {lastAdd.skipped.slice(0, 40).map((s) => (
                <li key={s.path}>
                  <span className="knowledge-path">{s.path}</span> — {s.reason}
                </li>
              ))}
            </ul>
          </details>
        ) : null}

        {sources.length === 0 ? (
          <>
                  <section
          className={`knowledge-drop${sources.length ? ' is-compact' : ''}${dragging ? ' is-over' : ''}`}
          aria-label="Add documents"
          onDragEnter={(e) => {
            e.preventDefault()
            setDragging(true)
          }}
          onDragOver={(e) => {
            e.preventDefault()
            e.dataTransfer.dropEffect = 'copy'
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
        >
          <p className="knowledge-drop-title">{sources.length ? 'Add more: drop files here, or' : 'Drop files here to add them to Knowledge'}</p>
          <div className="ui-actions">
            <Button variant={sources.length ? 'secondary' : 'primary'} size={sources.length ? 'sm' : 'md'} onClick={() => props.onAdd('files')}>
              Add files
            </Button>
            <Button size={sources.length ? 'sm' : 'md'} onClick={() => props.onAdd('folder')}>
              Add folder
            </Button>
          </div>
          {sources.length ? null : <p className="knowledge-hint">{LIMITS_TEXT}</p>}
        </section>
          <EmptyState
            title="No documents yet"
            action={
              <Button size="sm" onClick={props.onSample}>
                Try the sample document
              </Button>
            }
          >
            Add notes, reports or manuals, then ask questions like “According to my documents, when is the deadline?”. Answers show which file and passage they came from.
          </EmptyState>
          </>
        ) : (
          <>
            <form
              className="knowledge-ask"
              onSubmit={(e) => {
                e.preventDefault()
                if (question.trim()) props.onAsk(question.trim())
              }}
            >
              <label className="visually-hidden" htmlFor="knowledge-question">
                Ask your documents
              </label>
              <input
                id="knowledge-question"
                className="ui-input"
                value={question}
                placeholder="Ask your documents…"
                maxLength={2000}
                onChange={(e) => setQuestion(e.target.value)}
              />
              <div className="ui-actions">
                <Button type="submit" variant="primary" size="sm" disabled={!question.trim() || ready === 0}>
                  Ask
                </Button>
                <Button size="sm" disabled={!question.trim() || ready === 0 || searching} onClick={() => void findPassages()}>
                  {searching ? 'Searching…' : 'Find passages only'}
                </Button>
              </div>
              <p className="knowledge-hint">
                “Find passages” stays on this computer. “Ask” sends only the best-matching excerpts to the MIKO assistant and shows the answer in Chat.
              </p>
            </form>

            {shownResults ? (
              <section className="knowledge-results" aria-label="Matching passages" aria-live="polite">
                <h3>{shownResults.length ? `${shownResults.length} matching passage${shownResults.length === 1 ? '' : 's'}` : 'No passage matches those words.'}</h3>
                {shownResults.map((hit, i) => (
                  <div key={hit.chunkId}>
                    <SourceCard
                      id={`#${i + 1}`}
                      filename={hit.name}
                      where={whereLabel(hit)}
                      snippet={hit.text}
                      active={preview?.hit.chunkId === hit.chunkId}
                      onSelect={() => {
                        if (preview?.hit.chunkId === hit.chunkId) setPreview(null)
                        else void props.onPreview(hit).then((data) => setPreview({ hit, data }))
                      }}
                    />
                    {preview?.hit.chunkId === hit.chunkId ? (
                      <PassageBox data={preview.data} onOpen={() => props.onOpen(hit.sourceId)} />
                    ) : null}
                  </div>
                ))}
              </section>
            ) : null}

                    <section
          className={`knowledge-drop${sources.length ? ' is-compact' : ''}${dragging ? ' is-over' : ''}`}
          aria-label="Add documents"
          onDragEnter={(e) => {
            e.preventDefault()
            setDragging(true)
          }}
          onDragOver={(e) => {
            e.preventDefault()
            e.dataTransfer.dropEffect = 'copy'
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
        >
          <p className="knowledge-drop-title">{sources.length ? 'Add more: drop files here, or' : 'Drop files here to add them to Knowledge'}</p>
          <div className="ui-actions">
            <Button variant={sources.length ? 'secondary' : 'primary'} size={sources.length ? 'sm' : 'md'} onClick={() => props.onAdd('files')}>
              Add files
            </Button>
            <Button size={sources.length ? 'sm' : 'md'} onClick={() => props.onAdd('folder')}>
              Add folder
            </Button>
          </div>
          {sources.length ? null : <p className="knowledge-hint">{LIMITS_TEXT}</p>}
        </section>
            <div className="knowledge-list-head">
              <h3>
                {sources.length} document{sources.length === 1 ? '' : 's'} · {ready} ready
              </h3>
              <div className="ui-actions">
                {pending ? (
                  <Button size="sm" onClick={() => props.onAction('cancel')}>
                    Cancel import
                  </Button>
                ) : null}
                <Button size="sm" variant="ghost" onClick={() => props.onAction('refresh')} title="Re-check every file for changes, moves and deletions">
                  Refresh
                </Button>
                <Button size="sm" variant="danger" onClick={() => setConfirm({ kind: 'clear' })}>
                  Clear all
                </Button>
              </div>
            </div>
            {pending ? <TaskStatus state="running" label={`Reading ${pending} file${pending === 1 ? '' : 's'}… You can keep using MIKO.`} /> : null}
            <ul className="knowledge-files">
              {sources.map((s) => (
                <li key={s.id}>
                  <FileCard
                    name={s.name}
                    tone={tone(s)}
                    meta={[s.kind?.toUpperCase(), s.size ? formatBytes(s.size) : '', s.pages ? `${s.pages} pages` : ''].filter(Boolean).join(' · ')}
                    status={<span className={`ui-badge ${badge(s)}`}>{statusLabel(s.status)}</span>}
                    detail={s.detail || undefined}
                    actions={
                      <>
                        {canRetry(s.status) ? (
                          <Button size="sm" variant="ghost" onClick={() => props.onAction('retry', s.id)}>
                            Retry
                          </Button>
                        ) : null}
                        {s.status === 'indexed' ? (
                          <Button size="sm" variant="ghost" onClick={() => props.onOpen(s.id)} title={s.path}>
                            Open
                          </Button>
                        ) : null}
                        <Button size="sm" variant="ghost" aria-label={`Remove ${s.name}`} onClick={() => setConfirm({ kind: 'remove', source: s })}>
                          Remove
                        </Button>
                      </>
                    }
                  />
                </li>
              ))}
            </ul>
          </>
        )}

        <details className="knowledge-privacy">
          <summary>Formats, privacy and storage</summary>
          <p>{LIMITS_TEXT}</p>
          <p>
            MIKO reads only the files and folders you add. It skips credential and config folders (like .ssh, .aws, .env files, keychains), .git and
            node_modules, and links that point outside a folder you chose. It never indexes mail, WhatsApp, browser history or the clipboard.
          </p>
          <p>The extracted text and index are stored on this computer in MIKO’s app data, not in your documents’ folders.</p>
          <p>
            When you ask a question, MIKO sends only the few matching excerpts (not whole files) to the MIKO assistant (Codex with your ChatGPT sign-in).
            Removing a document deletes its text and index here, but answers already shown in Chat stay in that chat’s history.
          </p>
          {state?.cloudConsent ? (
            <Button size="sm" variant="ghost" onClick={() => props.onAction('consent-off')}>
              Ask me again before sending excerpts
            </Button>
          ) : null}
        </details>
      </div>

      {confirm ? (
        <Dialog
          title={confirm.kind === 'clear' ? 'Clear all of Knowledge?' : `Remove “${confirm.source.name}”?`}
          onClose={() => setConfirm(null)}
          actions={
            <>
              <Button onClick={() => setConfirm(null)}>Keep</Button>
              <Button
                variant="danger"
                onClick={() => {
                  if (confirm.kind === 'clear') props.onAction('clear')
                  else props.onAction('remove', confirm.source.id)
                  setConfirm(null)
                  setResults(null)
                  setPreview(null)
                }}
              >
                {confirm.kind === 'clear' ? 'Clear all' : 'Remove'}
              </Button>
            </>
          }
        >
          <p>
            {confirm.kind === 'clear'
              ? 'This deletes the extracted text and the index for every document. Your original files are not touched.'
              : 'This deletes its extracted text and index entries. The original file is not touched.'}{' '}
            Answers already shown in Chat stay in the chat history.
          </p>
        </Dialog>
      ) : null}
    </div>
  )
}

/** A passage with a little context, or an honest reason it can’t be shown. */
export function PassageBox({ data, onOpen }: { data: PassagePreview; onOpen?: () => void }) {
  const box = useRef<HTMLDivElement>(null)
  // Bring the opened passage into view (it opens below the citation that was clicked).
  useEffect(() => {
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    box.current?.scrollIntoView({ block: 'nearest', behavior: reduced ? 'auto' : 'smooth' })
  }, [data])
  if (!data.ok)
    return (
      <div ref={box}>
        <ErrorState title="Passage not available">{data.reason}</ErrorState>
      </div>
    )
  return (
    <div className="passage-box" ref={box}>
      <p className="passage-where">
        {data.name}
        {data.where ? ` · ${data.where}` : ''}
      </p>
      {data.before ? <p className="passage-context">…{data.before}</p> : null}
      <blockquote className="passage-text">{data.text}</blockquote>
      {data.after ? <p className="passage-context">{data.after}…</p> : null}
      {onOpen ? (
        <div className="ui-actions">
          <Button size="sm" onClick={onOpen}>
            Open original
          </Button>
          {data.where?.startsWith('p.') ? <span className="knowledge-hint">Opens the file; go to {data.where.split(' · ')[0]} yourself.</span> : null}
        </div>
      ) : null}
    </div>
  )
}
