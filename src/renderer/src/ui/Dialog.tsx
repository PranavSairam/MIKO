import { useEffect, useId, useRef, type ReactNode } from 'react'

/**
 * In-panel modal (MIKO's windows are small; a separate OS window would steal focus).
 * Focus moves into the dialog, Tab stays inside, Escape closes and focus returns.
 */
export function Dialog({ title, children, actions, onClose }: { title: string; children: ReactNode; actions: ReactNode; onClose: () => void }) {
  const titleId = useId()
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null
    const focusables = (): HTMLElement[] =>
      [...(box.current?.querySelectorAll<HTMLElement>('button,input,textarea,select,a[href],[tabindex]:not([tabindex="-1"])') ?? [])].filter(
        (el) => !el.hasAttribute('disabled')
      )
    focusables()[0]?.focus()
    return () => before?.focus?.()
  }, [])
  return (
    <div className="ui-dialog-backdrop" data-hit="dialog">
      <div
        ref={box}
        className="ui-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            event.stopPropagation()
            onClose()
            return
          }
          if (event.key !== 'Tab') return
          const list = [...(box.current?.querySelectorAll<HTMLElement>('button,input,textarea,select,a[href]') ?? [])].filter((el) => !el.hasAttribute('disabled'))
          if (!list.length) return
          const first = list[0]!
          const last = list[list.length - 1]!
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault()
            last.focus()
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault()
            first.focus()
          }
        }}
      >
        <h2 id={titleId}>{title}</h2>
        {children}
        <div className="ui-actions is-end">{actions}</div>
      </div>
    </div>
  )
}
