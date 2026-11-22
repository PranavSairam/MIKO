import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import {
  FEED_DRAG_THRESHOLD_PX,
  arcSlots,
  browserFor,
  feedReleaseLabel,
  filterApps,
  pointInDropTarget,
  switcherDropTarget as defaultDropTarget,
  type BrowserId,
  type BrowserTab,
  type SwitcherApp,
  type SwitcherDropTarget
} from '../../../shared/switcher'

const WIDTH = 760
const HEIGHT = 430
const CARD = 84

type TabsView = { browser: BrowserId; name: string; tabs: BrowserTab[]; message: string; selected: number }

type DragState =
  | {
      kind: 'app'
      item: SwitcherApp
      x: number
      y: number
      startX: number
      startY: number
      active: boolean
      over: boolean
    }
  | {
      kind: 'tab'
      browser: BrowserId
      tab: BrowserTab
      title: string
      x: number
      y: number
      startX: number
      startY: number
      active: boolean
      over: boolean
    }

export function Switcher() {
  const api = window.mikoSwitcher
  const [apps, setApps] = useState<SwitcherApp[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(0)
  const [hovered, setHovered] = useState<number | null>(null)
  const [fanned, setFanned] = useState(false)
  const [tabsView, setTabsView] = useState<TabsView | null>(null)
  const [note, setNote] = useState('')
  const [dropTarget, setDropTarget] = useState<SwitcherDropTarget>(() => defaultDropTarget(WIDTH, HEIGHT))
  const [drag, setDrag] = useState<DragState | null>(null)
  const [feeding, setFeeding] = useState(false)
  const [reducedMotion, setReducedMotion] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<DragState | null>(null)
  const suppressClick = useRef(false)

  const shown = useMemo(() => filterApps(apps, query), [apps, query])
  const slots = useMemo(() => arcSlots(shown.length, WIDTH, HEIGHT), [shown.length])

  const refreshDropTarget = useCallback(async (): Promise<void> => {
    try {
      setDropTarget(await api.dropTarget())
    } catch {
      setDropTarget(defaultDropTarget(WIDTH, HEIGHT))
    }
  }, [api])

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true)
    const listed = await api.list()
    setApps(listed)
    setLoading(false)
    setSelected(listed.length > 1 ? 1 : 0)
    void refreshDropTarget()
  }, [api, refreshDropTarget])

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const sync = (): void => setReducedMotion(mq.matches)
    sync()
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [])

  // CSS pointer-events:none does not make an Electron window click-through.
  // Forwarded moves arm clicks only over cards/controls; empty glass passes through to MIKO.
  useEffect(() => {
    let last = true
    const setIgnore = (ignore: boolean): void => {
      if (ignore === last) return
      last = ignore
      api.setIgnoreMouse(ignore)
    }
    const onMove = (event: MouseEvent): void => {
      const el = event.target
      if (!(el instanceof Element)) {
        setIgnore(true)
        return
      }
      const interactive = Boolean(
        el.closest(
          '.card, .card-face, .quit, .tabs-chip, .tabs-card, .tab-row, .chip, .hud, .drag-preview, .feed-drop.is-visible'
        )
      )
      setIgnore(!interactive)
    }
    const onLeave = (): void => setIgnore(true)
    window.addEventListener('mousemove', onMove)
    document.addEventListener('mouseleave', onLeave)
    setIgnore(true)
    return () => {
      window.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseleave', onLeave)
      setIgnore(true)
    }
  }, [api])

  useEffect(() => {
    const open = (): void => {
      setQuery('')
      setTabsView(null)
      setNote('')
      setFanned(false)
      setDrag(null)
      dragRef.current = null
      void refresh().then(() => requestAnimationFrame(() => setFanned(true)))
    }
    const stop = api.onOpen(open)
    open()
    return stop
  }, [api, refresh])

  useEffect(() => {
    if (selected >= shown.length) setSelected(Math.max(0, shown.length - 1))
  }, [shown.length, selected])

  async function choose(item: SwitcherApp | undefined): Promise<void> {
    if (!item || suppressClick.current) {
      suppressClick.current = false
      return
    }
    const ok = await api.focus(item.pid)
    if (!ok) {
      setNote(`${item.name} isn’t running any more.`)
      void refresh()
    }
  }

  async function quit(item: SwitcherApp): Promise<void> {
    const ok = await api.quit(item.pid)
    setNote(ok ? `Asked ${item.name} to quit.` : `${item.name} didn’t quit.`)
    setTimeout(() => void refresh(), 900)
  }

  async function openTabs(item: SwitcherApp): Promise<void> {
    const browser = browserFor(item.bundleId)
    if (!browser) return
    setTabsView({ browser, name: item.name, tabs: [], message: 'Reading tabs…', selected: 0 })
    const result = await api.tabs(browser)
    setTabsView({ browser, name: item.name, tabs: result.tabs, message: result.ok ? result.reason : result.reason, selected: 0 })
  }

  async function chooseTab(view: TabsView, tab: BrowserTab | undefined): Promise<void> {
    if (!tab || suppressClick.current) {
      suppressClick.current = false
      return
    }
    const ok = await api.focusTab(view.browser, tab.window, tab.tab)
    if (!ok) setTabsView({ ...view, message: 'That tab is gone. Try again.' })
  }

  function updateDrag(next: DragState | null): void {
    dragRef.current = next
    setDrag(next)
  }

  function beginAppPointer(item: SwitcherApp, event: ReactPointerEvent<HTMLButtonElement>): void {
    if (event.button !== 0 || feeding) return
    event.currentTarget.setPointerCapture(event.pointerId)
    const start: DragState = {
      kind: 'app',
      item,
      x: event.clientX,
      y: event.clientY,
      startX: event.clientX,
      startY: event.clientY,
      active: false,
      over: false
    }
    updateDrag(start)
  }

  function beginTabPointer(view: TabsView, tab: BrowserTab, event: ReactPointerEvent<HTMLButtonElement>): void {
    if (event.button !== 0 || feeding) return
    event.currentTarget.setPointerCapture(event.pointerId)
    const title = (tab.title || domain(tab.url) || 'tab').slice(0, 48)
    updateDrag({
      kind: 'tab',
      browser: view.browser,
      tab,
      title,
      x: event.clientX,
      y: event.clientY,
      startX: event.clientX,
      startY: event.clientY,
      active: false,
      over: false
    })
  }

  function onPointerMove(event: ReactPointerEvent): void {
    const current = dragRef.current
    if (!current) return
    const dist = Math.hypot(event.clientX - current.startX, event.clientY - current.startY)
    const active = current.active || dist >= FEED_DRAG_THRESHOLD_PX
    if (active && !current.active) suppressClick.current = true
    const over = active && pointInDropTarget(event.clientX, event.clientY, dropTarget)
    updateDrag({ ...current, x: event.clientX, y: event.clientY, active, over })
  }

  async function onPointerUp(): Promise<void> {
    const current = dragRef.current
    updateDrag(null)
    if (!current?.active) return
    if (!current.over) {
      setNote('Cancelled — nothing was closed.')
      return
    }
    if (feeding) return
    setFeeding(true)
    try {
      if (current.kind === 'app') {
        const result = await api.feedApp(current.item.pid)
        setNote(result.reason)
        if (result.status === 'closed' || result.status === 'gone') {
          setApps((list) => list.filter((app) => app.pid !== current.item.pid))
          void refresh()
        } else if (result.status === 'waiting') {
          // Keep the card; refresh so status stays honest.
          void refresh()
        }
      } else {
        const result = await api.feedTab(current.browser, current.tab.window, current.tab.tab, current.title)
        setNote(result.reason)
        if (result.status === 'closed' || result.status === 'gone') {
          setTabsView((view) =>
            view
              ? {
                  ...view,
                  tabs: view.tabs.filter((t) => !(t.window === current.tab.window && t.tab === current.tab.tab)),
                  message: result.reason
                }
              : view
          )
        }
      }
    } finally {
      setFeeding(false)
    }
  }

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (dragRef.current) {
        if (event.key === 'Escape') {
          updateDrag(null)
          setNote('Cancelled — nothing was closed.')
          event.preventDefault()
        }
        return
      }
      if (tabsView) {
        if (event.key === 'Escape') setTabsView(null)
        else if (event.key === 'ArrowDown') setTabsView({ ...tabsView, selected: Math.min(tabsView.tabs.length - 1, tabsView.selected + 1) })
        else if (event.key === 'ArrowUp') setTabsView({ ...tabsView, selected: Math.max(0, tabsView.selected - 1) })
        else if (event.key === 'Enter') void chooseTab(tabsView, tabsView.tabs[tabsView.selected])
        else return
        event.preventDefault()
        return
      }
      if (event.key === 'Escape') {
        if (query) setQuery('')
        else api.close()
      } else if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
        setSelected((value) => (shown.length ? (value + 1) % shown.length : 0))
      } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
        setSelected((value) => (shown.length ? (value - 1 + shown.length) % shown.length : 0))
      } else if (event.key === 'Enter') {
        void choose(shown[selected])
      } else if (event.key === 'Tab' && browserFor(shown[selected]?.bundleId ?? '')) {
        void openTabs(shown[selected])
      } else if (event.key === 'Backspace') {
        setQuery((value) => value.slice(0, -1))
        setSelected(0)
      } else if (/^[1-9]$/.test(event.key) && !query) {
        void choose(shown[Number(event.key) - 1])
      } else if (event.key.length === 1 && !event.metaKey && !event.ctrlKey) {
        setQuery((value) => (value + event.key).slice(0, 40))
        setSelected(0)
      } else {
        return
      }
      event.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  useEffect(() => {
    if (!tabsView) return
    listRef.current?.querySelector<HTMLElement>('.tab-row.is-selected')?.scrollIntoView({ block: 'nearest' })
  }, [tabsView])

  const focusName = shown[hovered ?? selected]?.name ?? ''
  const releaseHint =
    drag?.active && drag.over
      ? feedReleaseLabel(drag.kind === 'tab' ? 'tab' : 'app', drag.kind === 'tab' ? drag.title : drag.item.name)
      : drag?.active
        ? 'Drop on MIKO to close · Esc cancels'
        : ''

  return (
    <div
      className={['switcher', drag?.active ? 'is-dragging' : ''].filter(Boolean).join(' ')}
      onPointerMove={onPointerMove}
      onPointerUp={() => void onPointerUp()}
      onPointerCancel={() => updateDrag(null)}
    >
      <div className="glow" aria-hidden="true" />
      <div
        className={['feed-drop', drag?.active ? 'is-visible' : '', drag?.over ? 'is-hot' : '', reducedMotion ? 'is-static' : '']
          .filter(Boolean)
          .join(' ')}
        style={{
          left: dropTarget.cx - dropTarget.radius,
          top: dropTarget.cy - dropTarget.radius,
          width: dropTarget.radius * 2,
          height: dropTarget.radius * 2
        }}
        aria-hidden="true"
      />
      {tabsView ? (
        <section className="tabs-card" aria-label={`${tabsView.name} tabs`}>
          <header>
            <button type="button" className="chip" onClick={() => setTabsView(null)}>
              ← Apps
            </button>
            <h1>{tabsView.name} tabs</h1>
          </header>
          {tabsView.message ? <p className="message">{tabsView.message}</p> : null}
          <p className="message">Drag a tab toward MIKO to close only that tab.</p>
          <div className="tab-list" ref={listRef} role="listbox">
            {tabsView.tabs.map((tab, index) => (
              <button
                type="button"
                role="option"
                aria-selected={index === tabsView.selected}
                key={`${tab.window}-${tab.tab}`}
                className={index === tabsView.selected ? 'tab-row is-selected' : 'tab-row'}
                onMouseEnter={() => setTabsView({ ...tabsView, selected: index })}
                onClick={() => void chooseTab(tabsView, tab)}
                onPointerDown={(event) => beginTabPointer(tabsView, tab, event)}
              >
                <span className="tab-title">{tab.title || tab.url}</span>
                <span className="tab-domain">{domain(tab.url)}</span>
              </button>
            ))}
          </div>
        </section>
      ) : (
        <>
          <div className="hud">
            {query ? (
              <span className="query">
                {query}
                <span className="caret" />
              </span>
            ) : (
              <span className="hint">type to filter · ←→ Enter · 1–9 · drag to MIKO to quit · Esc</span>
            )}
          </div>
          {loading && apps.length === 0 ? <p className="message center">Fetching your apps…</p> : null}
          {!loading && shown.length === 0 ? (
            <p className="message center">{query ? `Nothing running matches “${query}”.` : 'No apps are running.'}</p>
          ) : null}
          {shown.map((item, index) => {
            const slot = slots[index]
            if (!slot) return null
            const browser = browserFor(item.bundleId)
            const isSelected = index === selected
            const draggingThis = drag?.kind === 'app' && drag.active && drag.item.pid === item.pid
            const style = fanned
              ? {
                  transform: draggingThis
                    ? `translate(${drag.x - CARD / 2}px, ${drag.y - CARD / 2}px) scale(${reducedMotion ? 0.92 : 0.78})`
                    : `translate(${slot.x - CARD / 2}px, ${slot.y - CARD / 2}px) rotate(${slot.angle}deg)${isSelected ? ' scale(1.14)' : ''}`,
                  transitionDelay: draggingThis || reducedMotion ? '0ms' : `${Math.min(index, 14) * 18}ms`,
                  opacity: draggingThis ? 0.35 : 1,
                  zIndex: draggingThis ? 5 : undefined
                }
              : { transform: `translate(${WIDTH / 2 - CARD / 2}px, ${HEIGHT - CARD / 2}px) scale(0.2)`, opacity: 0 }
            return (
              <div
                key={item.pid}
                className={['card', isSelected ? 'is-selected' : '', item.hidden ? 'is-hidden' : '', draggingThis ? 'is-source' : '']
                  .filter(Boolean)
                  .join(' ')}
                style={style}
                onMouseEnter={() => {
                  if (dragRef.current?.active) return
                  setHovered(index)
                  setSelected(index)
                }}
                onMouseLeave={() => setHovered(null)}
              >
                <button
                  type="button"
                  className="card-face"
                  onClick={() => void choose(item)}
                  onPointerDown={(event) => beginAppPointer(item, event)}
                  aria-label={`Switch to ${item.name}`}
                >
                  {item.icon ? <img src={item.icon} alt="" draggable={false} /> : <span className="letter">{item.name[0]}</span>}
                  {index < 9 && !query ? <span className="badge">{index + 1}</span> : null}
                </button>
                <button type="button" className="quit" aria-label={`Quit ${item.name}`} onClick={() => void quit(item)}>
                  ×
                </button>
                {browser ? (
                  <button type="button" className="tabs-chip" onClick={() => void openTabs(item)}>
                    Tabs
                  </button>
                ) : null}
              </div>
            )
          })}
          <div className="label">{releaseHint || note || focusName}</div>
        </>
      )}
      {drag?.active ? (
        <div
          className={['drag-preview', drag.over ? 'is-hot' : '', reducedMotion ? 'is-static' : ''].filter(Boolean).join(' ')}
          style={{ left: drag.x - 28, top: drag.y - 28 }}
          aria-hidden="true"
        >
          {drag.kind === 'app' && drag.item.icon ? (
            <img src={drag.item.icon} alt="" />
          ) : (
            <span>{drag.kind === 'app' ? drag.item.name[0] : '⇥'}</span>
          )}
        </div>
      ) : null}
      {tabsView && releaseHint ? <div className="label feed-label">{releaseHint}</div> : null}
      {feeding ? <div className="label feed-label">Working…</div> : null}
    </div>
  )
}

function domain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}
