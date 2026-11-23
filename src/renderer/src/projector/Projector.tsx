import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  cropAspect,
  cropStyle,
  frameHealth,
  FULL_FRAME,
  likelyProtected,
  normaliseCrop,
  type Crop,
  type FrameSample,
  type ProjectorSource,
  type ProjectorStatus
} from '../../../shared/projector'

type Api = {
  sources: () => Promise<{ ok: boolean; reason: string; permission: string; sources: ProjectorSource[] }>
  select: (id: string) => Promise<boolean>
  aspect: (value: number, chrome: number) => void
  size: (value: 'small' | 'medium' | 'large') => void
  collapse: (value: boolean) => Promise<boolean>
  pin: (value: boolean) => Promise<boolean>
  openOriginal: () => Promise<{ ok: boolean; reason: string }>
  privacy: () => Promise<boolean>
  close: () => void
  platform: string
}

declare global {
  interface Window {
    mikoProjector: Api
  }
}

const MESSAGES: Partial<Record<ProjectorStatus, string>> = {
  frozen: 'No new frames. The video may be paused, minimised, or on another desktop.',
  black:
    'Only black is coming through. The video may be protected (streaming sites like Netflix often block capture, and MIKO doesn’t get around that), or the window may be minimised, on another desktop, or not playing yet. Try again, pick the window again, or watch in the original.',
  ended: 'The projected window closed or can’t be captured any more. Pick another window, or close the projector.'
}

/**
 * Live mirror of one chosen window. Not a player: playback stays in the original window.
 * The stream has no audio. Closing stops every track before the window goes away.
 */
export function Projector() {
  const api = window.mikoProjector
  const [status, setStatus] = useState<ProjectorStatus>('choosing')
  const [sources, setSources] = useState<ProjectorSource[]>([])
  const [listNote, setListNote] = useState('')
  const [permissionDenied, setPermissionDenied] = useState(false)
  const [current, setCurrent] = useState<ProjectorSource | null>(null)
  const [note, setNote] = useState('')
  const [pinned, setPinned] = useState(true)
  const [collapsed, setCollapsed] = useState(false)
  const [frozenView, setFrozenView] = useState(false)
  const [beam, setBeam] = useState(true)
  const [crop, setCrop] = useState<Crop>(FULL_FRAME)
  const [cropping, setCropping] = useState(false)
  const [drag, setDrag] = useState<{ a: { x: number; y: number }; b: { x: number; y: number } } | null>(null)
  const [frame, setFrame] = useState({ w: 16, h: 9 })
  const [box, setBox] = useState({ width: 320, height: 180 })
  const videoRef = useRef<HTMLVideoElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const samples = useRef<FrameSample[]>([])
  const lastFrameAt = useRef(0)
  const startSerial = useRef(0)

  function stopStream(): void {
    const stream = streamRef.current
    streamRef.current = null
    stream?.getTracks().forEach((track) => track.stop())
    if (videoRef.current) videoRef.current.srcObject = null
  }

  async function refresh(): Promise<void> {
    setListNote('Looking for windows…')
    const listed = await api.sources()
    setSources(listed.sources)
    setPermissionDenied(!listed.ok && listed.permission === 'denied')
    setListNote(listed.reason)
  }

  useEffect(() => {
    void refresh()
    const onUnload = (): void => stopStream()
    window.addEventListener('beforeunload', onUnload)
    return () => {
      window.removeEventListener('beforeunload', onUnload)
      stopStream()
    }
  }, [])

  async function choose(source: ProjectorSource): Promise<void> {
    startSerial.current += 1
    const serial = startSerial.current
    // Switching: the old capture stops before the new one starts.
    stopStream()
    setCurrent(source)
    setCrop(FULL_FRAME)
    setCropping(false)
    setFrozenView(false)
    setNote(likelyProtected(source.name) ? 'This looks like a streaming site that may block capture. If you only see black, use Open original.' : '')
    setStatus('starting')
    samples.current = []
    if (!(await api.select(source.id))) {
      setStatus('error')
      setNote('MIKO couldn’t select that window.')
      return
    }
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 30, max: 30 } }, audio: false })
      if (serial !== startSerial.current) {
        stream.getTracks().forEach((t) => t.stop())
        return
      }
      streamRef.current = stream
      const track = stream.getVideoTracks()[0]
      track?.addEventListener('ended', () => {
        if (serial !== startSerial.current) return
        stopStream()
        setStatus('ended')
      })
      const video = videoRef.current
      if (video) {
        video.srcObject = stream
        video.muted = true
        await video.play().catch(() => undefined)
      }
      lastFrameAt.current = performance.now()
      setStatus('live')
    } catch (error) {
      if (serial !== startSerial.current) return
      const name = (error as { name?: string })?.name || ''
      setStatus(name === 'NotAllowedError' && window.mikoProjector.platform === 'darwin' ? 'denied' : 'ended')
      setNote(
        name === 'NotAllowedError'
          ? window.mikoProjector.platform === 'darwin'
            ? 'macOS didn’t allow capturing that window. Check Screen & System Audio Recording for MIKO, or pick another window.'
            : 'That window can’t be captured. Pick another window.'
          : 'That window can’t be captured any more. Pick another window.'
      )
    }
  }

  // Frame clock + health checks (black / frozen), sampled once a second on a tiny canvas.
  useEffect(() => {
    if (status !== 'live' && status !== 'frozen' && status !== 'black') return
    const video = videoRef.current
    if (!video) return
    let handle = 0
    let cancelled = false
    const onFrame = (): void => {
      if (cancelled) return
      lastFrameAt.current = performance.now()
      if (video.videoWidth && video.videoHeight && (video.videoWidth !== frame.w || video.videoHeight !== frame.h)) {
        setFrame({ w: video.videoWidth, h: video.videoHeight })
      }
      handle = video.requestVideoFrameCallback(onFrame)
    }
    handle = video.requestVideoFrameCallback(onFrame)
    const canvas = document.createElement('canvas')
    canvas.width = 32
    canvas.height = 18
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    const timer = window.setInterval(() => {
      if (!ctx || !video.videoWidth) return
      ctx.drawImage(video, 0, 0, 32, 18)
      const data = ctx.getImageData(0, 0, 32, 18).data
      let sum = 0
      for (let i = 0; i < data.length; i += 4) sum += 0.2126 * data[i]! + 0.7152 * data[i + 1]! + 0.0722 * data[i + 2]!
      const now = performance.now()
      samples.current = [...samples.current.slice(-8), { at: now, luma: sum / (data.length / 4), lastFrameAt: lastFrameAt.current }]
      const health = frameHealth(samples.current, now)
      setStatus((s) => (s === 'ended' ? s : health))
    }, 1000)
    return () => {
      cancelled = true
      video.cancelVideoFrameCallback(handle)
      window.clearInterval(timer)
    }
  }, [status === 'live' || status === 'frozen' || status === 'black', frame.w, frame.h])

  // No new frames: is the chosen window still there? macOS keeps a capture of a closed window
  // open without ending it, so check the window list (never switch to another window).
  useEffect(() => {
    if (status !== 'frozen' || !current) return
    let cancelled = false
    const check = async (): Promise<void> => {
      const listed = await api.sources()
      if (cancelled || !listed.ok) return
      if (!listed.sources.some((s) => s.id === current.id)) {
        startSerial.current += 1
        stopStream()
        setStatus('ended')
      }
    }
    void check()
    const timer = window.setInterval(() => void check(), 4000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [status, current?.id])

  // The window keeps the video's (or crop's) aspect ratio; controls sit outside the video.
  useEffect(() => {
    if (status === 'choosing' || collapsed) return
    const bar = document.querySelector('.bar')?.getBoundingClientRect().height ?? 44
    const foot = document.querySelector('.foot')?.getBoundingClientRect().height ?? 0
    // Controls + note + the gap above the video, all outside the video itself.
    api.aspect(cropAspect(frame.w, frame.h, crop), Math.round(bar + foot + (foot ? 6 : 0) + 6))
  }, [frame.w, frame.h, crop, status === 'choosing', collapsed, note, box.width])

  useLayoutEffect(() => {
    const el = stageRef.current
    if (!el) return
    const update = (): void => setBox({ width: el.clientWidth, height: el.clientHeight })
    update()
    const observer = new ResizeObserver(update)
    observer.observe(el)
    return () => observer.disconnect()
  }, [status === 'choosing', collapsed])

  // The pill has no video element; on expand, give the running capture back to the new one.
  useEffect(() => {
    const video = videoRef.current
    const stream = streamRef.current
    if (collapsed || !video || !stream || video.srcObject === stream) return
    video.srcObject = stream
    video.muted = true
    if (!frozenView) void video.play().catch(() => undefined)
  }, [collapsed, status])

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    if (frozenView) video.pause()
    else void video.play().catch(() => undefined)
  }, [frozenView])

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      if (cropping) {
        setCropping(false)
        setDrag(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [cropping])

  /** Back to the window picker: the current capture stops (nothing runs hidden). */
  function goChoose(): void {
    startSerial.current += 1
    stopStream()
    setCropping(false)
    setStatus('choosing')
    void refresh()
  }

  async function openOriginal(): Promise<void> {
    const result = await api.openOriginal()
    setNote(result.reason)
  }

  function close(): void {
    startSerial.current += 1
    stopStream()
    api.close()
  }

  const local = (event: React.PointerEvent): { x: number; y: number } => {
    const stage = stageRef.current!.getBoundingClientRect()
    const s = cropStyle(box, frame.w, frame.h, FULL_FRAME)
    return {
      x: (event.clientX - stage.left - s.left) / s.width,
      y: (event.clientY - stage.top - s.top) / s.height
    }
  }

  const shown = cropping ? FULL_FRAME : crop
  const style = cropStyle(box, frame.w, frame.h, shown)
  const live = status === 'live' || status === 'frozen' || status === 'black'
  const message = MESSAGES[status]

  if (collapsed) {
    return (
      <div className="projector is-pill">
        <span className="badge">Live mirror</span>
        <span className="title" title={current?.name}>
          {current?.name || 'Projector'}
        </span>
        <button type="button" onClick={() => void api.collapse(false).then(setCollapsed)} aria-label="Expand projector">
          ⤢
        </button>
        <button type="button" onClick={close} aria-label="Close projector">
          ✕
        </button>
      </div>
    )
  }

  return (
    <div className={`projector${beam ? ' has-beam' : ''}`}>
      <header className="bar">
        <span className="badge" title="A live picture of the original window. It doesn’t play the video itself.">
          Live mirror
        </span>
        <span className="title" title={current?.name}>
          {status === 'choosing' ? 'Choose a window to project' : current?.name}
        </span>
        {status !== 'choosing' ? (
          <>
            <button type="button" onClick={() => void openOriginal()} title="Bring the original window forward (play / pause there)">
              Open original
            </button>
            <button type="button" onClick={goChoose} title="Project a different window">
              Source
            </button>
            {live ? (
              <button type="button" className={cropping ? 'is-on' : ''} onClick={() => (crop === FULL_FRAME || cropping ? setCropping((v) => !v) : setCrop(FULL_FRAME))}>
                {cropping ? 'Cancel crop' : crop === FULL_FRAME ? 'Crop' : 'Uncrop'}
              </button>
            ) : null}
            {live ? (
              <button type="button" className={frozenView ? 'is-on' : ''} onClick={() => setFrozenView((v) => !v)} title="Freeze only this mirror; the original keeps playing">
                {frozenView ? 'Unfreeze' : 'Freeze'}
              </button>
            ) : null}
          </>
        ) : null}
        <span className="spacer" />
        <button type="button" className={pinned ? 'is-on' : ''} onClick={() => void api.pin(!pinned).then(setPinned)} aria-label={pinned ? 'Unpin (stop staying on top)' : 'Pin on top'}>
          {pinned ? 'Pinned' : 'Pin'}
        </button>
        <select aria-label="Size" defaultValue="medium" onChange={(event) => api.size(event.target.value as 'small' | 'medium' | 'large')}>
          <option value="small">Small</option>
          <option value="medium">Medium</option>
          <option value="large">Large</option>
        </select>
        <button type="button" onClick={() => setBeam((v) => !v)} aria-label={beam ? 'Hide light beam' : 'Show light beam'} className={beam ? 'is-on' : ''}>
          Beam
        </button>
        <button type="button" onClick={() => void api.collapse(true).then(setCollapsed)} aria-label="Collapse projector">
          –
        </button>
        <button type="button" onClick={close} aria-label="Close projector">
          ✕
        </button>
      </header>

      {status === 'choosing' ? (
        <section className="picker">
          {listNote ? <p className="note">{listNote}</p> : null}
          {permissionDenied ? (
            <button type="button" className="wide" onClick={() => void api.privacy()}>
              Open Screen Recording settings
            </button>
          ) : null}
          <div className="grid">
            {sources.map((source) => (
              <button key={source.id} type="button" className={`source${source.browser ? ' is-browser' : ''}`} onClick={() => void choose(source)}>
                {source.previewUrl ? <img src={source.previewUrl} alt="" /> : <span className="blank" />}
                <span className="name">{source.name}</span>
              </button>
            ))}
          </div>
          <div className="row">
            <button type="button" onClick={() => void refresh()}>
              Refresh
            </button>
            {current ? (
              <button type="button" onClick={() => void choose(current)}>
                Back to “{current.name.slice(0, 24)}”
              </button>
            ) : null}
          </div>
        </section>
      ) : (
        <section
          className={`stage${cropping ? ' is-cropping' : ''}`}
          ref={stageRef}
          onPointerDown={(event) => {
            if (!cropping) return
            event.currentTarget.setPointerCapture(event.pointerId)
            const p = local(event)
            setDrag({ a: p, b: p })
          }}
          onPointerMove={(event) => {
            if (cropping && drag) setDrag({ ...drag, b: local(event) })
          }}
          onPointerUp={() => {
            if (!cropping || !drag) return
            const next = normaliseCrop(drag.a, drag.b)
            setDrag(null)
            if (next) {
              setCrop(next)
              setCropping(false)
            }
          }}
        >
          <video
            ref={videoRef}
            muted
            playsInline
            style={{ position: 'absolute', left: style.left, top: style.top, width: style.width, height: style.height }}
          />
          {cropping && drag ? (
            <span
              className="crop-box"
              style={{
                left: cropStyle(box, frame.w, frame.h, FULL_FRAME).left + Math.min(drag.a.x, drag.b.x) * style.width,
                top: cropStyle(box, frame.w, frame.h, FULL_FRAME).top + Math.min(drag.a.y, drag.b.y) * style.height,
                width: Math.abs(drag.a.x - drag.b.x) * style.width,
                height: Math.abs(drag.a.y - drag.b.y) * style.height
              }}
            />
          ) : null}
          {cropping ? <p className="overlay-hint">Drag a box around the video. Esc cancels.</p> : null}
          {status === 'starting' ? <p className="overlay">Starting the mirror…</p> : null}
          {message || status === 'denied' || status === 'error' ? (
            <div className="overlay">
              <p>{message || note}</p>
              <div className="row">
                {(status === 'black' || status === 'frozen') && current ? (
                  <button type="button" onClick={() => void choose(current)}>
                    Try again
                  </button>
                ) : null}
                {status === 'black' || status === 'frozen' ? (
                  <button type="button" onClick={() => void openOriginal()}>
                    Open original
                  </button>
                ) : null}
                {status === 'denied' ? (
                  <button type="button" onClick={() => void api.privacy()}>
                    Screen Recording settings
                  </button>
                ) : null}
                <button type="button" onClick={goChoose}>
                  Choose window
                </button>
              </div>
            </div>
          ) : null}
        </section>
      )}
      {note && status !== 'denied' && status !== 'error' ? <p className="foot">{note}</p> : null}
    </div>
  )
}
