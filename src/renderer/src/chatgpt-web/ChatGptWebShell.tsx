import { useEffect, useRef, useState, type DragEvent, type ReactElement } from 'react'

type Status = {
  open: boolean
  collapsed: boolean
  pinned: boolean
  visible?: boolean
  url: string
  title: string
  canGoBack: boolean
  canGoForward: boolean
  downloadNote: string
  dropNote?: string
  dictateArmed?: boolean
  partition: string
  label: string
  loadError?: string
  blockedHost?: string
}

type Api = {
  status: () => Promise<Status>
  close: () => Promise<boolean>
  collapse: () => Promise<boolean>
  expand: () => Promise<boolean>
  back: () => Promise<boolean>
  forward: () => Promise<boolean>
  reload: () => Promise<boolean>
  retry: () => Promise<boolean>
  openInBrowser: () => Promise<boolean>
  openBlocked: () => Promise<boolean>
  dismissBlocked: () => Promise<boolean>
  setPinned: (pinned: boolean) => Promise<boolean>
  setChromeHeight: (height: number) => Promise<boolean>
  setDragActive: (active: boolean) => Promise<boolean>
  expandFromDrag: () => Promise<boolean>
  pasteClipboard: () => Promise<{ ok: boolean; reason: string }>
  dictateArm: (armed: boolean) => Promise<boolean>
  lastDownload: () => Promise<{ filename: string; state: string; savePath: string } | null>
  onDownload: (handler: (info: { filename: string; state: string; savePath: string }) => void) => () => void
  onState: (handler: (info: Status) => void) => () => void
}

declare global {
  interface Window {
    mikoChatGptWeb?: Api
  }
}

const PILL_EXPAND_MS = 600

export function ChatGptWebShell(): ReactElement {
  const headerRef = useRef<HTMLElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const pillExpandTimer = useRef<number | null>(null)
  const dragDepth = useRef(0)
  const [status, setStatus] = useState<Status | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [downloadNote, setDownloadNote] = useState('')
  const [dragOver, setDragOver] = useState(false)
  const [pillHint, setPillHint] = useState('')

  useEffect(() => {
    const api = window.mikoChatGptWeb
    if (!api) return
    let cancelled = false
    const tick = async (): Promise<void> => {
      const st = await api.status()
      if (!cancelled) setStatus(st)
    }
    void tick()
    const id = window.setInterval(() => {
      void tick()
    }, 1800)
    const offDownload = api.onDownload((info) => {
      setDownloadNote(`${info.state}: ${info.filename}`)
    })
    const offState = api.onState((info) => {
      if (!cancelled) setStatus(info)
    })
    return () => {
      cancelled = true
      window.clearInterval(id)
      offDownload()
      offState()
    }
  }, [])

  useEffect(() => {
    if (!menuOpen) return
    const onDoc = (event: MouseEvent): void => {
      const el = menuRef.current
      if (el && event.target instanceof Node && !el.contains(event.target)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [menuOpen])

  useEffect(() => {
    const api = window.mikoChatGptWeb
    const el = headerRef.current
    if (!api || !el || typeof ResizeObserver === 'undefined') return
    const measure = (): void => {
      void api.setChromeHeight(el.offsetHeight)
    }
    measure()
    const ro = new ResizeObserver(() => measure())
    ro.observe(el)
    return () => ro.disconnect()
  }, [status?.collapsed, menuOpen, dragOver, status?.dropNote, status?.dictateArmed, pillHint, status?.loadError, status?.blockedHost])

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      clearPillTimer()
      dragDepth.current = 0
      setDragOver(false)
      setPillHint('')
      void window.mikoChatGptWeb?.setDragActive(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  function clearPillTimer(): void {
    if (pillExpandTimer.current !== null) {
      window.clearTimeout(pillExpandTimer.current)
      pillExpandTimer.current = null
    }
  }

  function beginChromeDrag(): void {
    dragDepth.current += 1
    setDragOver(true)
    void window.mikoChatGptWeb?.setDragActive(true)
  }

  function endChromeDrag(): void {
    dragDepth.current = Math.max(0, dragDepth.current - 1)
    if (dragDepth.current === 0) {
      clearPillTimer()
      setDragOver(false)
      setPillHint('')
      void window.mikoChatGptWeb?.setDragActive(false)
    }
  }

  function onPillDragEnter(event: DragEvent<HTMLElement>): void {
    event.preventDefault()
    beginChromeDrag()
    setPillHint('Hold to expand…')
    clearPillTimer()
    pillExpandTimer.current = window.setTimeout(() => {
      void window.mikoChatGptWeb?.expandFromDrag().then((ok) => {
        setPillHint(ok ? 'Drop into the ChatGPT composer' : 'Expand the workspace, then drop into the composer')
      })
    }, PILL_EXPAND_MS)
  }

  function onPillDragOver(event: DragEvent<HTMLElement>): void {
    // Allow the OS drag session to continue over the pill (do not navigate).
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
  }

  function onPillDragLeave(): void {
    endChromeDrag()
  }

  function onPillDrop(event: DragEvent<HTMLElement>): void {
    event.preventDefault()
    event.stopPropagation()
    clearPillTimer()
    dragDepth.current = 0
    setDragOver(false)
    void window.mikoChatGptWeb?.setDragActive(false)
    // Never upload from a pill hover/drop — expand first, then drop into ChatGPT.
    setPillHint('Expand first, then drop into the ChatGPT composer')
    window.setTimeout(() => setPillHint(''), 3200)
  }

  /** Chrome/titlebar only — never steal drops meant for the guest WebContentsView. */
  function onChromeDragEnter(event: DragEvent<HTMLElement>): void {
    event.preventDefault()
    beginChromeDrag()
    setPillHint('Drop into the ChatGPT composer')
  }

  function onChromeDragOver(event: DragEvent<HTMLElement>): void {
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
  }

  function onChromeDragLeave(): void {
    endChromeDrag()
  }

  function onChromeDrop(event: DragEvent<HTMLElement>): void {
    event.preventDefault()
    event.stopPropagation()
    dragDepth.current = 0
    setDragOver(false)
    void window.mikoChatGptWeb?.setDragActive(false)
    setPillHint('Drop into the ChatGPT composer (not the title bar)')
    window.setTimeout(() => setPillHint(''), 3200)
  }

  const api = window.mikoChatGptWeb
  const collapsed = status?.collapsed === true
  const pinned = status?.pinned !== false
  const dropNote = status?.dropNote || ''
  const chromeHint = pillHint

  if (collapsed) {
    return (
      <div
        className={dragOver ? 'cw-shell cw-pill is-drag' : 'cw-shell cw-pill'}
        onDragEnter={onPillDragEnter}
        onDragOver={onPillDragOver}
        onDragLeave={onPillDragLeave}
        onDrop={onPillDrop}
      >
        <header className="cw-header cw-pill-header" ref={headerRef}>
          <button
            type="button"
            className="cw-pill-btn cw-nodrag"
            title="Expand MIKO · ChatGPT — or hold a dragged item ~0.6s to expand"
            onClick={() => void api?.expand()}
          >
            Interactive GPT
          </button>
        </header>
        {pillHint ? <p className="cw-pill-hint">{pillHint}</p> : null}
      </div>
    )
  }

  return (
    <div className={dragOver ? 'cw-shell is-drag' : 'cw-shell'}>
      <header
        className="cw-header"
        ref={headerRef}
        onDragEnter={onChromeDragEnter}
        onDragOver={onChromeDragOver}
        onDragLeave={onChromeDragLeave}
        onDrop={onChromeDrop}
      >
        <div className="cw-brand">
          <strong>MIKO · ChatGPT</strong>
        </div>
        <div className="cw-spacer" />
        <div className="cw-nav cw-nodrag" ref={menuRef}>
          <div className="cw-menu-wrap">
            <button
              type="button"
              className="cw-btn"
              aria-expanded={menuOpen}
              aria-haspopup="menu"
              title="Page tools"
              onClick={() => setMenuOpen((v) => !v)}
            >
              ···
            </button>
            {menuOpen ? (
              <div className="cw-menu" role="menu">
                <button
                  type="button"
                  role="menuitem"
                  disabled={!api || !status?.canGoBack}
                  onClick={() => {
                    void api?.back()
                    setMenuOpen(false)
                  }}
                >
                  Back
                </button>
                <button
                  type="button"
                  role="menuitem"
                  disabled={!api || !status?.canGoForward}
                  onClick={() => {
                    void api?.forward()
                    setMenuOpen(false)
                  }}
                >
                  Forward
                </button>
                <button
                  type="button"
                  role="menuitem"
                  disabled={!api}
                  onClick={() => {
                    void api?.reload()
                    setMenuOpen(false)
                  }}
                >
                  Reload
                </button>
                <button
                  type="button"
                  role="menuitem"
                  disabled={!api}
                  title="Paste clipboard text into the ChatGPT composer (unsent; keeps draft)"
                  onClick={() => {
                    void api?.pasteClipboard().then((r) => {
                      setPillHint(r.ok ? r.reason : r.reason || 'Paste failed')
                      window.setTimeout(() => setPillHint(''), 4200)
                    })
                    setMenuOpen(false)
                  }}
                >
                  Paste clipboard into GPT
                </button>
                <button
                  type="button"
                  role="menuitem"
                  disabled={!api}
                  title="Arm one MIKO mic transcript into this composer (unsent). Ordinary voice still runs local commands."
                  onClick={() => {
                    const next = !(status?.dictateArmed === true)
                    void api?.dictateArm(next).then(() => {
                      setPillHint(
                        next
                          ? 'Dictate to GPT armed — use MIKO mic once (inserts unsent, then disarms)'
                          : 'Dictate to GPT cancelled'
                      )
                      window.setTimeout(() => setPillHint(''), 4200)
                    })
                    setMenuOpen(false)
                  }}
                >
                  {status?.dictateArmed ? 'Cancel Dictate to GPT' : 'Dictate to GPT'}
                </button>
                {downloadNote || status?.downloadNote ? (
                  <p className="cw-menu-note">{downloadNote || status?.downloadNote}</p>
                ) : null}
              </div>
            ) : null}
          </div>
          <button
            type="button"
            className={pinned ? 'cw-btn is-on' : 'cw-btn'}
            disabled={!api}
            aria-pressed={pinned}
            title={pinned ? 'Pinned above other apps' : 'Pin above other apps'}
            onClick={() => void api?.setPinned(!pinned)}
          >
            Pin
          </button>
          <button
            type="button"
            className={status?.dictateArmed ? 'cw-btn is-on' : 'cw-btn'}
            disabled={!api}
            aria-pressed={status?.dictateArmed === true}
            title="Dictate to GPT: next MIKO mic final inserts once into the composer (unsent). Does not change ordinary voice commands."
            onClick={() => {
              const next = !(status?.dictateArmed === true)
              void api?.dictateArm(next)
            }}
          >
            {status?.dictateArmed ? 'Dictating…' : 'Dictate to GPT'}
          </button>
          <button type="button" className="cw-btn" disabled={!api} title="Collapse to pill near MIKO" onClick={() => void api?.collapse()}>
            Collapse
          </button>
          <button type="button" className="cw-btn" disabled={!api} title="Expand" onClick={() => void api?.expand()}>
            Expand
          </button>
          <button type="button" className="cw-btn" disabled={!api} title="Close workspace (keeps login)" onClick={() => void api?.close()}>
            Close
          </button>
        </div>
        {status?.loadError ? (
          <div className="cw-drop-note cw-nodrag" role="alert">
            ChatGPT didn’t load inside MIKO: {status.loadError}.{' '}
            <button type="button" className="cw-btn" onClick={() => void api?.retry()}>
              Retry
            </button>{' '}
            <button type="button" className="cw-btn" title="Opens chatgpt.com in your default browser, outside MIKO" onClick={() => void api?.openInBrowser()}>
              Open in browser
            </button>
          </div>
        ) : null}
        {status?.blockedHost ? (
          <div className="cw-drop-note cw-nodrag" role="status">
            That link goes to {status.blockedHost}, outside MIKO’s ChatGPT window.{' '}
            <button type="button" className="cw-btn" title="Opens the link in your default browser" onClick={() => void api?.openBlocked()}>
              Open in browser
            </button>{' '}
            <button type="button" className="cw-btn" onClick={() => void api?.dismissBlocked()}>
              Dismiss
            </button>
          </div>
        ) : null}
        {dropNote ? <p className="cw-drop-note cw-nodrag">{dropNote}</p> : null}
        {!dropNote && chromeHint ? <p className="cw-drop-note cw-nodrag">{chromeHint}</p> : null}
      </header>
      {/* Guest WebContentsView paints above this region; pointer-events none so drops reach ChatGPT. */}
      <div className="cw-fill" aria-hidden="true" />
    </div>
  )
}
