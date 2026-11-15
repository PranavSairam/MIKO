import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { arcSlots, browserFor, filterApps, type BrowserId, type BrowserTab, type SwitcherApp } from '../../../shared/switcher'

const WIDTH = 760
const HEIGHT = 430
const CARD = 84

type TabsView = { browser: BrowserId; name: string; tabs: BrowserTab[]; message: string; selected: number }

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
  const listRef = useRef<HTMLDivElement>(null)

  const shown = useMemo(() => filterApps(apps, query), [apps, query])
  const slots = useMemo(() => arcSlots(shown.length, WIDTH, HEIGHT), [shown.length])

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true)
    const listed = await api.list()
    setApps(listed)
    setLoading(false)
    // The first card is the app you were just in; preselect the one before it for a quick flip back.
    setSelected(listed.length > 1 ? 1 : 0)
  }, [api])

  useEffect(() => {
    const open = (): void => {
      setQuery('')
      setTabsView(null)
      setNote('')
      setFanned(false)
      void refresh().then(() => requestAnimationFrame(() => setFanned(true)))
    }
    const stop = api.onOpen(open)
    // The first open can be sent before this listener exists (window still loading); load once on mount too.
    open()
    return stop
  }, [api, refresh])

  useEffect(() => {
    if (selected >= shown.length) setSelected(Math.max(0, shown.length - 1))
  }, [shown.length, selected])

  async function choose(item: SwitcherApp | undefined): Promise<void> {
    if (!item) return
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
    if (!tab) return
    const ok = await api.focusTab(view.browser, tab.window, tab.tab)
    if (!ok) setTabsView({ ...view, message: 'That tab is gone. Try again.' })
  }

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
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

  return (
    <div className="switcher">
      <div className="glow" aria-hidden="true" />
      {tabsView ? (
        <section className="tabs-card" aria-label={`${tabsView.name} tabs`}>
          <header>
            <button type="button" className="chip" onClick={() => setTabsView(null)}>
              ← Apps
            </button>
            <h1>{tabsView.name} tabs</h1>
          </header>
          {tabsView.message ? <p className="message">{tabsView.message}</p> : null}
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
              <span className="hint">type to filter · ←→ Enter · 1–9 · Esc</span>
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
            const style = fanned
              ? {
                  transform: `translate(${slot.x - CARD / 2}px, ${slot.y - CARD / 2}px) rotate(${slot.angle}deg)${isSelected ? ' scale(1.14)' : ''}`,
                  transitionDelay: `${Math.min(index, 14) * 18}ms`
                }
              : { transform: `translate(${WIDTH / 2 - CARD / 2}px, ${HEIGHT - CARD / 2}px) scale(0.2)`, opacity: 0 }
            return (
              <div
                key={item.pid}
                className={['card', isSelected ? 'is-selected' : '', item.hidden ? 'is-hidden' : ''].filter(Boolean).join(' ')}
                style={style}
                onMouseEnter={() => {
                  setHovered(index)
                  setSelected(index)
                }}
                onMouseLeave={() => setHovered(null)}
              >
                <button type="button" className="card-face" onClick={() => void choose(item)} aria-label={`Switch to ${item.name}`}>
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
          <div className="label">{note || focusName}</div>
        </>
      )}
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
