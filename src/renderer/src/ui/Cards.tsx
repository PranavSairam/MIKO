import type { ReactNode } from 'react'

/** A retrieved passage: [S1] badge, filename, page/heading, and a two-line excerpt. */
export function SourceCard({
  id,
  filename,
  where,
  snippet,
  active = false,
  onSelect
}: {
  id: string
  filename: string
  where?: string
  snippet: string
  active?: boolean
  onSelect: () => void
}) {
  return (
    <button type="button" className={active ? 'ui-source is-active' : 'ui-source'} aria-pressed={active} onClick={onSelect} title={filename}>
      <span className="ui-source-head">
        <span className="ui-source-id">{id}</span>
        <span className="ui-source-name">{filename}</span>
        {where ? <span className="ui-source-where">{where}</span> : null}
      </span>
      <span className="ui-source-snippet">{snippet}</span>
    </button>
  )
}

export function FileCard({
  name,
  meta,
  status,
  tone = 'plain',
  detail,
  actions
}: {
  name: string
  meta?: string
  status?: ReactNode
  tone?: 'plain' | 'warn' | 'error'
  detail?: ReactNode
  actions?: ReactNode
}) {
  return (
    <div className={tone === 'plain' ? 'ui-file' : `ui-file is-${tone}`}>
      <span className="ui-file-name" title={name}>
        {name}
      </span>
      <span className="ui-file-meta">
        {meta}
        {meta && status ? ' · ' : null}
        {status}
      </span>
      {actions ? <span className="ui-file-actions">{actions}</span> : null}
      {detail ? <p className="ui-file-detail">{detail}</p> : null}
    </div>
  )
}
