import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'

export type MenuEntry =
  | { kind?: 'item'; id: string; label: string; onSelect: () => void; checked?: boolean; disabled?: boolean; hint?: string }
  | { kind: 'separator'; id: string }
  | { kind: 'label'; id: string; label: string }

/**
 * Button + popup menu. Opens with click/Enter/Space/ArrowDown; arrows move; Escape and
 * outside clicks close and return focus to the button. Menu items are real buttons.
 */
export function Menu({ label, icon, entries, className = '' }: { label: string; icon: ReactNode; entries: MenuEntry[]; className?: string }) {
  const [open, setOpen] = useState(false)
  const wrap = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const items = useRef<(HTMLButtonElement | null)[]>([])

  useEffect(() => {
    if (!open) return
    const onDown = (event: PointerEvent): void => {
      if (!wrap.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onDown, true)
    const first = items.current.find((el) => el && !el.disabled)
    first?.focus()
    return () => document.removeEventListener('pointerdown', onDown, true)
  }, [open])

  function close(refocus = true): void {
    setOpen(false)
    if (refocus) trigger.current?.focus()
  }

  function onMenuKey(event: KeyboardEvent<HTMLDivElement>): void {
    const list = items.current.filter((el): el is HTMLButtonElement => Boolean(el && !el.disabled))
    const at = list.indexOf(document.activeElement as HTMLButtonElement)
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      close()
    } else if (event.key === 'ArrowDown') {
      event.preventDefault()
      list[(at + 1) % list.length]?.focus()
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      list[(at - 1 + list.length) % list.length]?.focus()
    } else if (event.key === 'Tab') {
      close(false)
    }
  }

  let index = -1
  return (
    <div className={`ui-menu-wrap ${className}`.trim()} ref={wrap}>
      <button
        ref={trigger}
        type="button"
        className="ui-iconbtn"
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' && !open) {
            event.preventDefault()
            setOpen(true)
          }
        }}
      >
        <span aria-hidden="true">{icon}</span>
      </button>
      {open ? (
        <div className="ui-menu" role="menu" aria-label={label} onKeyDown={onMenuKey}>
          {entries.map((entry) => {
            if (entry.kind === 'separator') return <div key={entry.id} className="ui-menu-sep" role="separator" />
            if (entry.kind === 'label') return <div key={entry.id} className="ui-menu-label">{entry.label}</div>
            index += 1
            const at = index
            return (
              <button
                key={entry.id}
                ref={(el) => {
                  items.current[at] = el
                }}
                type="button"
                role={entry.checked === undefined ? 'menuitem' : 'menuitemcheckbox'}
                aria-checked={entry.checked === undefined ? undefined : entry.checked}
                className="ui-menu-item"
                disabled={entry.disabled}
                title={entry.hint}
                onClick={() => {
                  close()
                  entry.onSelect()
                }}
              >
                {entry.label}
                {entry.checked ? <span className="ui-menu-check" aria-hidden="true">✓</span> : null}
              </button>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}
