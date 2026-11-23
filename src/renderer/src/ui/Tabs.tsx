import { useRef, type KeyboardEvent } from 'react'

export interface TabItem<T extends string> {
  id: T
  label: string
}

/** Tab list with roving focus: arrow keys / Home / End move and select. */
export function Tabs<T extends string>({
  items,
  value,
  onChange,
  label
}: {
  items: TabItem<T>[]
  value: T
  onChange: (id: T) => void
  label: string
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  function onKey(event: KeyboardEvent<HTMLButtonElement>, index: number): void {
    let next = -1
    if (event.key === 'ArrowRight') next = (index + 1) % items.length
    else if (event.key === 'ArrowLeft') next = (index - 1 + items.length) % items.length
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = items.length - 1
    if (next < 0) return
    event.preventDefault()
    refs.current[next]?.focus()
    onChange(items[next]!.id)
  }
  return (
    <div className="ui-tabs" role="tablist" aria-label={label}>
      {items.map((item, index) => (
        <button
          key={item.id}
          ref={(el) => {
            refs.current[index] = el
          }}
          type="button"
          role="tab"
          className="ui-tab"
          aria-selected={item.id === value}
          tabIndex={item.id === value ? 0 : -1}
          onClick={() => onChange(item.id)}
          onKeyDown={(event) => onKey(event, index)}
        >
          {item.label}
        </button>
      ))}
    </div>
  )
}
