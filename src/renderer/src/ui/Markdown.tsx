import { memo, type ReactNode } from 'react'
import { parseMarkdown, type MdInline } from '../../../shared/markdown'

function inline(nodes: MdInline[], onCite?: (id: string) => void, valid?: Set<string>): ReactNode[] {
  return nodes.map((node, i) => {
    if (node.t === 'strong') return <strong key={i}>{node.v}</strong>
    if (node.t === 'em') return <em key={i}>{node.v}</em>
    if (node.t === 'code') return <code key={i}>{node.v}</code>
    if (node.t === 'cite') {
      // Unknown ids are shown as plain text, never as a clickable source.
      if (!onCite || (valid && !valid.has(node.id))) return <span key={i}>[{node.id}]</span>
      return (
        <button key={i} type="button" className="ui-cite" aria-label={`Show source ${node.id}`} onClick={() => onCite(node.id)}>
          {node.id}
        </button>
      )
    }
    return <span key={i}>{node.v}</span>
  })
}

/** Renders the safe Markdown subset as React nodes (no HTML injection). */
export const Markdown = memo(function Markdown({ text, onCite, validCites }: { text: string; onCite?: (id: string) => void; validCites?: Set<string> }) {
  const blocks = parseMarkdown(text)
  return (
    <div className="ui-md">
      {blocks.map((block, i) => {
        if (block.type === 'code')
          return (
            <pre key={i}>
              <code>{block.text}</code>
            </pre>
          )
        if (block.type === 'h') return <h3 key={i}>{inline(block.inline, onCite, validCites)}</h3>
        if (block.type === 'ul' || block.type === 'ol') {
          const items = block.items.map((item, j) => <li key={j}>{inline(item, onCite, validCites)}</li>)
          return block.type === 'ul' ? <ul key={i}>{items}</ul> : <ol key={i}>{items}</ol>
        }
        return (
          <p key={i} style={{ whiteSpace: 'pre-wrap' }}>
            {inline(block.inline, onCite, validCites)}
          </p>
        )
      })}
    </div>
  )
})
