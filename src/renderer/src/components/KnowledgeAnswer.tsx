import { useMemo } from 'react'
import type { KnowledgeAnswer as Answer, KnowledgeStyle, Passage, PassagePreview } from '../../../shared/knowledge'
import { Button } from '../ui/Button'
import { SourceCard } from '../ui/Cards'
import { Markdown } from '../ui/Markdown'
import { TaskStatus } from '../ui/Status'
import { PassageBox } from './KnowledgeView'

export interface KnowledgeEntry {
  id: number
  kind: 'knowledge'
  requestId: string
  question: string
  /**
   * searching → (consent) → answering → done | failed | cancelled.
   * no-results: nothing matched (no model call). passages: local passages only (no answer).
   */
  status: 'searching' | 'consent' | 'answering' | 'done' | 'failed' | 'cancelled' | 'no-results' | 'passages'
  style: KnowledgeStyle
  scope: { sourceIds: string[]; label: string } | null
  passages: Passage[]
  answer: Answer | null
  detail: string
  preview: { citeId: string; data: PassagePreview } | null
  /** Sources removed or changed after this answer. */
  staleSourceIds: string[]
}

export interface KnowledgeHandlers {
  cite: (entryId: number, citeId: string) => void
  open: (sourceId: string) => void
  consent: (entryId: number, allow: boolean) => void
  restyle: (entryId: number, style: KnowledgeStyle) => void
  scopeTo: (entryId: number, sourceId: string) => void
  cancel: (entryId: number) => void
  retry: (entryId: number) => void
  copy: (entryId: number) => void
  openKnowledge: () => void
}

const EVIDENCE_NOTE: Record<string, string> = {
  none: 'Your documents don’t clearly answer this.',
  conflicting: 'Your documents disagree. Each version is shown with its source.',
  partial: 'Only partly supported by the passages.'
}

export function KnowledgeAnswerCard({ entry, on }: { entry: KnowledgeEntry; on: KnowledgeHandlers }) {
  const valid = useMemo(() => new Set(entry.passages.map((p) => p.id)), [entry.passages])
  const cited = entry.answer ? entry.passages.filter((p) => entry.answer!.cited.includes(p.id)) : []
  const uncited = entry.passages.filter((p) => !cited.includes(p))
  const stale = entry.passages.some((p) => entry.staleSourceIds.includes(p.sourceId))
  const pending = entry.status === 'searching' || entry.status === 'answering'
  const label = entry.style === 'compare' ? 'Compare' : entry.style === 'shorter' ? 'Shorter' : entry.style === 'one-sentence' ? 'One sentence' : ''

  const sourceList = (list: Passage[]) =>
    list.map((p) => (
      <div key={p.id}>
        <SourceCard
          id={p.id}
          filename={p.name}
          where={p.where}
          snippet={p.text}
          active={entry.preview?.citeId === p.id}
          onSelect={() => on.cite(entry.id, p.id)}
        />
        {entry.preview?.citeId === p.id ? (
          <div className="passage-wrap">
            <PassageBox data={entry.preview.data} onOpen={entry.preview.data.ok ? () => on.open(p.sourceId) : undefined} />
            {entry.preview.data.ok && !entry.scope ? (
              <Button size="sm" variant="ghost" onClick={() => on.scopeTo(entry.id, p.sourceId)}>
                Ask again using only this document
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
    ))

  return (
    <div className="kn-card">
      <p className="msg-user">{entry.question}</p>
      <div className="msg-assistant">
        <p className="kn-label">
          From your documents{entry.scope ? ` · only ${entry.scope.label}` : ''}
          {label ? ` · ${label}` : ''}
        </p>
        {entry.status === 'searching' ? <TaskStatus state="running" label="Searching your documents…" /> : null}
        {entry.status === 'answering' ? <TaskStatus state="running" label={`Answering from ${entry.passages.length} passage${entry.passages.length === 1 ? '' : 's'}…`} /> : null}
        {entry.status === 'no-results' ? <TaskStatus state="completed" label="No match" /> : null}
        {entry.status === 'failed' ? <TaskStatus state="failed" /> : null}
        {entry.status === 'cancelled' ? <TaskStatus state="cancelled" /> : null}
        {entry.detail ? <p className="kn-detail">{entry.detail}</p> : null}

        {entry.status === 'consent' ? (
          <div className="kn-consent" role="group" aria-label="Send excerpts to the assistant?">
            <p>
              Your documents are indexed on this computer. To answer, MIKO sends these {entry.passages.length} short excerpt
              {entry.passages.length === 1 ? '' : 's'} (not whole files) to the MIKO assistant (Codex with your ChatGPT sign-in). Nothing is sent to
              Interactive GPT.
            </p>
            <div className="ui-actions">
              <Button variant="primary" size="sm" onClick={() => on.consent(entry.id, true)}>
                Send excerpts and answer
              </Button>
              <Button size="sm" onClick={() => on.consent(entry.id, false)}>
                Just show the passages
              </Button>
            </div>
          </div>
        ) : null}

        {entry.status === 'done' && entry.answer ? (
          <>
            {entry.answer.evidence !== 'supported' ? (
              <p className={`kn-evidence is-${entry.answer.evidence}`} role="note">
                {EVIDENCE_NOTE[entry.answer.evidence]}
              </p>
            ) : null}
            <Markdown text={entry.answer.text} onCite={(id) => on.cite(entry.id, id)} validCites={valid} />
            {entry.answer.weak.length ? (
              <details className="kn-weak">
                <summary>
                  {entry.answer.weak.length} statement{entry.answer.weak.length === 1 ? '' : 's'} not clearly backed by the cited passage
                </summary>
                <ul>
                  {entry.answer.weak.map((s) => (
                    <li key={s}>{s}</li>
                  ))}
                </ul>
              </details>
            ) : null}
            {entry.answer.invalid.length ? (
              <p className="kn-detail">Removed {entry.answer.invalid.length} citation(s) that didn’t match any passage sent.</p>
            ) : null}
          </>
        ) : null}

        {stale ? <p className="kn-detail">A document used here was removed or changed since. This answer stays in the chat, but its passages may not open.</p> : null}

        {entry.passages.length && entry.status !== 'consent' ? (
          <div className="kn-sources">
            {cited.length ? (
              <>
                <p className="kn-sources-title">Sources</p>
                {sourceList(cited)}
              </>
            ) : null}
            {uncited.length ? (
              <details open={entry.status === 'passages' || (entry.status === 'done' && cited.length === 0)}>
                <summary className="kn-sources-title">
                  {entry.status === 'passages' ? 'Matching passages' : `Other passages searched (${uncited.length})`}
                </summary>
                {sourceList(uncited)}
              </details>
            ) : null}
          </div>
        ) : null}

        <div className="msg-actions">
          {pending ? (
            <Button size="sm" onClick={() => on.cancel(entry.id)}>
              Cancel
            </Button>
          ) : null}
          {entry.status === 'done' ? (
            <>
              <Button size="sm" variant="ghost" onClick={() => on.copy(entry.id)}>
                Copy
              </Button>
              {entry.style !== 'shorter' ? (
                <Button size="sm" variant="ghost" onClick={() => on.restyle(entry.id, 'shorter')}>
                  Shorter
                </Button>
              ) : null}
            </>
          ) : null}
          {entry.status === 'failed' || entry.status === 'cancelled' || entry.status === 'passages' ? (
            <Button size="sm" variant="ghost" onClick={() => on.retry(entry.id)}>
              {entry.status === 'passages' ? 'Answer from these' : 'Retry'}
            </Button>
          ) : null}
          {entry.status === 'failed' || entry.status === 'no-results' ? (
            <Button size="sm" variant="ghost" onClick={() => on.openKnowledge()}>
              Open Knowledge
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  )
}
