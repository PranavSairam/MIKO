/**
 * MIKO Lens — live mirror with capability-gated Media / Control original.
 * Mirror ≠ interactive embed. Zoom/pan/crop do not scroll the real source.
 */
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
  type RefObject,
  type WheelEvent as ReactWheelEvent
} from 'react'
import {
  type GptCaptureSource,
  type GptLiveCrop,
  type GptLiveKind,
  type GptLiveSnapshot,
  type GptModeState,
  clampGptLiveZoom,
  fitGptLiveScale,
  gptLiveKindLabel,
  normalizeGptLiveCrop,
  GPT_LIVE_ZOOM_STEP
} from '../../../shared/gpt-mode'
import {
  type LensMode,
  type LensResolvedFile,
  type LensWindowBounds,
  type SpotifyMediaStatus,
  isChatGptOwner,
  isFinderOwner,
  isSpotifyOwner,
  mapLensPointToScreen
} from '../../../shared/lens-control'
import { lensCapabilityProfile } from '../../../shared/lens-capabilities'

type ZoomMode = 'fit' | 'actual' | 'manual'

export function GptLiveViewer(): ReactElement {
  const [state, setState] = useState<GptModeState | null>(null)
  const [snap, setSnap] = useState<GptLiveSnapshot | null>(null)
  const [frozen, setFrozen] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [pickerSources, setPickerSources] = useState<GptCaptureSource[]>([])
  const [pickerReason, setPickerReason] = useState('')
  const [zoomMode, setZoomMode] = useState<ZoomMode>('fit')
  const [zoom, setZoom] = useState(1)
  const [crop, setCrop] = useState<GptLiveCrop | null>(null)
  const [cropping, setCropping] = useState(false)
  const [cropDraft, setCropDraft] = useState<GptLiveCrop | null>(null)
  const [panning, setPanning] = useState(false)
  const [narrow, setNarrow] = useState(false)
  const [mode, setMode] = useState<LensMode>('view')
  const [windowBounds, setWindowBounds] = useState<LensWindowBounds | null>(null)
  const [shelfOpen, setShelfOpen] = useState(false)
  const [shelfFiles, setShelfFiles] = useState<LensResolvedFile[]>([])
  const [actionNote, setActionNote] = useState('')
  const [attachBusy, setAttachBusy] = useState(false)
  const [spotifyStatus, setSpotifyStatus] = useState<SpotifyMediaStatus | null>(null)
  const [spotifyBusy, setSpotifyBusy] = useState(false)
  /** True after the single Control-original handoff activate for this source session. */
  const [originalHandedOff, setOriginalHandedOff] = useState(false)
  const shellRef = useRef<HTMLDivElement | null>(null)
  const stageRef = useRef<HTMLDivElement | null>(null)
  const panRef = useRef<{ x: number; y: number; left: number; top: number } | null>(null)
  const cropDragRef = useRef<{ x0: number; y0: number; x1: number; y1: number } | null>(null)
  const boundIdRef = useRef<string | null>(null)
  const lastCaptureSize = useRef({ w: 0, h: 0 })
  const menuRef = useRef<HTMLDivElement | null>(null)
  const lastClickRef = useRef({ t: 0, x: 0, y: 0 })
  const controlBusy = useRef(false)

  async function openPicker(): Promise<void> {
    setMenuOpen(false)
    setCropping(false)
    setCropDraft(null)
    const listed = await window.miko.gptModeListSources()
    setPickerSources(listed.sources || [])
    setPickerReason(
      listed.reason ||
        (listed.sources?.length
          ? 'Choose the ChatGPT window. Don’t pick WhatsApp, Notes, or the desktop.'
          : 'No windows found. Open ChatGPT, then Refresh.')
    )
    setPickerOpen(true)
  }

  useEffect(() => {
    let cancelled = false
    void window.miko.gptModeGet().then((s) => {
      if (cancelled) return
      if (s) {
        setState(s)
        boundIdRef.current = s.captureSourceId
        if (!s.captureSourceId) void openPicker()
      } else {
        void openPicker()
      }
    })
    const offState = window.miko.onGptModeState((s) => {
      setState(s)
      if (s.captureSourceId) setPickerOpen(false)
      if (s.captureSourceId !== boundIdRef.current) {
        boundIdRef.current = s.captureSourceId
        setSnap(null)
        setCrop(null)
        setCropDraft(null)
        setZoomMode('fit')
        setZoom(1)
        setMode('view')
        setWindowBounds(null)
        setShelfFiles([])
        setSpotifyStatus(null)
        window.miko.lensCancelInput()
        lastCaptureSize.current = { w: 0, h: 0 }
      }
    })
    const offPicker = window.miko.onGptModeOpenPicker(() => {
      void openPicker()
    })
    const offCollapse = window.miko.onGptModeLiveCollapse((next) => {
      setCollapsed(next)
      if (next) {
        setMenuOpen(false)
        setCropping(false)
      }
    })
    return () => {
      cancelled = true
      offState()
      offPicker()
      offCollapse()
    }
  }, [])

  useEffect(() => {
    const el = shellRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width || 0
      setNarrow(w < 720)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [collapsed])

  useEffect(() => {
    if (!menuOpen) return
    const onDoc = (event: MouseEvent): void => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [menuOpen])

  // Capture loop — slowed when collapsed/frozen/picker.
  useEffect(() => {
    if (typeof window.miko?.gptModeLiveSnapshot !== 'function') return
    let cancelled = false
    let timer = 0
    const tick = async (): Promise<void> => {
      if (cancelled || frozen || pickerOpen || cropping) return
      if (collapsed) {
        timer = window.setTimeout(() => {
          void tick()
        }, 4000)
        return
      }
      try {
        const next = await window.miko.gptModeLiveSnapshot()
        if (cancelled) return
        if (next.ok && next.captureWidth > 0 && next.captureHeight > 0) {
          const prev = lastCaptureSize.current
          if (prev.w && prev.h && (Math.abs(prev.w - next.captureWidth) > 8 || Math.abs(prev.h - next.captureHeight) > 8)) {
            // Source resized — keep relative crop if still valid; otherwise reset.
            setCrop((c) => normalizeGptLiveCrop(c))
          }
          lastCaptureSize.current = { w: next.captureWidth, h: next.captureHeight }
        }
        setSnap(next)
        if (next.sourceId && state?.captureSourceId && next.sourceId !== state.captureSourceId) {
          setSnap({
            ...next,
            ok: false,
            dataUrl: '',
            kind: 'source-unavailable',
            reason: 'Source mismatch — choose the window again.'
          })
        }
      } catch {
        if (!cancelled) {
          setSnap({
            ok: false,
            reason: 'Live preview unavailable.',
            dataUrl: '',
            sourceName: '',
            sourceId: '',
            owner: '',
            permission: 'unknown',
            kind: 'capture-failed',
            captureWidth: 0,
            captureHeight: 0
          })
        }
      }
      if (!cancelled && !frozen && !pickerOpen && !cropping) {
        timer = window.setTimeout(() => {
          void tick()
        }, collapsed ? 4000 : 700)
      }
    }
    void tick()
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [frozen, pickerOpen, cropping, collapsed, state?.captureSourceId])

  const contentW = snap?.captureWidth || 0
  const contentH = snap?.captureHeight || 0
  const activeCrop = normalizeGptLiveCrop(crop)
  const draftCrop = normalizeGptLiveCrop(cropDraft)
  const displayCrop = cropping ? draftCrop || activeCrop : activeCrop
  const croppedW = displayCrop && contentW ? contentW * displayCrop.width : contentW
  const croppedH = displayCrop && contentH ? contentH * displayCrop.height : contentH

  const stageSize = useStageSize(stageRef)
  const fit = useMemo(
    () =>
      fitGptLiveScale(
        croppedW || 1,
        croppedH || 1,
        Math.max(1, stageSize.width - 8),
        Math.max(1, stageSize.height - 8)
      ),
    [croppedW, croppedH, stageSize.height, stageSize.width]
  )
  const appliedZoom = zoomMode === 'fit' ? fit : zoomMode === 'actual' ? 1 : zoom

  useEffect(() => {
    if (zoomMode === 'fit') setZoom(fit)
  }, [fit, zoomMode])

  const kind: GptLiveKind =
    snap?.kind || (state?.liveKind === 'off' ? 'source-unavailable' : state?.liveKind || 'source-unavailable')
  const hasLiveFrame = Boolean(snap?.ok && snap.dataUrl)
  const unavailable = !hasLiveFrame
  const sourceLabel = snap?.owner || state?.captureOwner || 'No source'
  const sourceTitle = snap?.sourceName || state?.captureSourceName || 'Choose a window'
  const sourceId = snap?.sourceId || state?.captureSourceId || ''
  const finderSource = isFinderOwner(sourceLabel, sourceTitle, windowBounds?.bundle || '')
  const chatGptSource = isChatGptOwner(sourceLabel, sourceTitle, windowBounds?.bundle || '')
  const spotifySource = isSpotifyOwner(sourceLabel, sourceTitle, windowBounds?.bundle || '')
  const lensPlatform = /win/i.test(navigator.platform) ? 'win32' : 'darwin'
  const caps = useMemo(
    () => lensCapabilityProfile(sourceLabel, sourceTitle, windowBounds?.bundle || '', lensPlatform),
    [lensPlatform, sourceLabel, sourceTitle, windowBounds?.bundle]
  )
  const mediaCap = caps.capabilities.find((c) => c.id === 'media')
  const interactiveCap = caps.capabilities.find((c) => c.id === 'interactive')
  const controlOrigCap = caps.capabilities.find((c) => c.id === 'control-original')
  const inControlOriginal = mode === 'control' || mode === 'control-original'
  const showMediaBar = Boolean(mediaCap?.available && spotifySource)
  const statusKind = pickerOpen
    ? 'live'
    : inControlOriginal
      ? 'live'
      : !hasLiveFrame
        ? 'error'
        : frozen
          ? 'frozen'
          : 'live'
  const statusText = pickerOpen
    ? 'Choosing'
    : inControlOriginal
      ? 'Control original'
      : mode === 'media'
        ? 'Media'
        : !hasLiveFrame
          ? gptLiveKindLabel(kind)
          : frozen
            ? 'Frozen'
            : 'Live'

  // Refresh verified window bounds while Control original is on or Files shelf is open.
  useEffect(() => {
    if (!sourceId || (!inControlOriginal && !shelfOpen)) return
    let cancelled = false
    const tick = async (): Promise<void> => {
      const b = await window.miko.lensWindowBounds(sourceId)
      if (cancelled) return
      setWindowBounds(b)
      if (inControlOriginal && !b) {
        setMode('view')
        setOriginalHandedOff(false)
        setActionNote('Source closed or changed — left Control original.')
      }
    }
    void tick()
    const id = window.setInterval(() => {
      void tick()
    }, 1500)
    return () => {
      cancelled = true
      window.clearInterval(id)
    }
  }, [sourceId, mode, shelfOpen, inControlOriginal])

  useEffect(() => {
    if (frozen || !hasLiveFrame || pickerOpen || cropping) {
      if (inControlOriginal) {
        setMode('view')
        setOriginalHandedOff(false)
        setActionNote(frozen ? 'Frozen frames can’t accept Control.' : 'Live frame required for Control original.')
      }
    }
  }, [frozen, hasLiveFrame, pickerOpen, cropping, mode, inControlOriginal])

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && inControlOriginal) {
        event.preventDefault()
        window.miko.lensCancelInput()
        setOriginalHandedOff(false)
        setMode('view')
        setActionNote('Left Control original (Esc). Mirror is view-only again.')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [inControlOriginal])

  // Spotify media status — background AppleScript / media keys; never activates Spotify.
  useEffect(() => {
    if (!spotifySource || collapsed) return
    let cancelled = false
    const tick = async (): Promise<void> => {
      const st = await window.miko.spotifyMedia('status')
      if (!cancelled) setSpotifyStatus(st)
    }
    void tick()
    const id = window.setInterval(() => {
      void tick()
    }, 4000)
    return () => {
      cancelled = true
      window.clearInterval(id)
    }
  }, [spotifySource, collapsed])

  async function runSpotify(action: 'play-pause' | 'next' | 'previous' | 'volume-up' | 'volume-down'): Promise<void> {
    if (spotifyBusy) return
    setSpotifyBusy(true)
    try {
      const st = await window.miko.spotifyMedia(action)
      setSpotifyStatus(st)
      setActionNote(st.ok ? (st.track ? `${st.track}${st.artist ? ` · ${st.artist}` : ''}` : st.reason || 'OK') : st.reason)
    } finally {
      setSpotifyBusy(false)
    }
  }

  async function refreshShelfFromFinder(): Promise<void> {
    setActionNote('Resolving Finder selection…')
    const listed = await window.miko.lensFinderSelection(sourceId || undefined)
    if (!listed.ok) {
      setActionNote(listed.reason || 'No Finder files.')
      return
    }
    setShelfFiles(listed.files)
    setShelfOpen(true)
    setActionNote(listed.reason)
  }

  async function openFilesShelf(): Promise<void> {
    setMenuOpen(false)
    setShelfOpen(true)
    const proven = await window.miko.lensProvenFiles()
    if (proven.length) setShelfFiles((prev) => mergeFiles(prev, proven))
    if (finderSource) await refreshShelfFromFinder()
    else setActionNote('Pick files, or attach a proven MIKO file card path.')
  }

  async function pickFilesNative(): Promise<void> {
    const listed = await window.miko.lensPickFiles()
    if (!listed.ok) {
      setActionNote(listed.reason || 'Cancelled.')
      return
    }
    setShelfFiles((prev) => mergeFiles(prev, listed.files))
    setShelfOpen(true)
    setActionNote(listed.reason)
  }

  async function attachPath(path: string): Promise<void> {
    if (attachBusy) return
    setAttachBusy(true)
    setActionNote('Attaching to ChatGPT (unsent)…')
    try {
      const result = await window.miko.lensAttachChatGpt(path, chatGptSource ? sourceId : undefined)
      setActionNote(result.reason)
      if (result.ok) {
        const registered = await window.miko.lensRegisterFile(path)
        if (registered) setShelfFiles((prev) => mergeFiles(prev, [registered]))
      }
    } finally {
      setAttachBusy(false)
    }
  }

  function mergeFiles(prev: LensResolvedFile[], next: LensResolvedFile[]): LensResolvedFile[] {
    const map = new Map<string, LensResolvedFile>()
    for (const f of [...prev, ...next]) map.set(f.path, f)
    return [...map.values()].slice(0, 20)
  }

  async function mapAndPointer(
    clientX: number,
    clientY: number,
    action: 'click' | 'dblclick' | 'scroll',
    deltas?: { dx: number; dy: number }
  ): Promise<void> {
    // Only Control original maps into the real window. Interactive-in-mirror is not offered for Spotify.
    if (!inControlOriginal || frozen || !hasLiveFrame || cropping || pickerOpen || controlBusy.current) return
    if (!originalHandedOff) {
      setActionNote('Control original hasn’t handed off yet — use the Control original button.')
      return
    }
    if (!sourceId || !windowBounds) {
      setActionNote('Can’t verify the bound window — leave Control original and re-choose source.')
      setMode('view')
      setOriginalHandedOff(false)
      return
    }
    const stage = stageRef.current
    if (!stage) return
    const rect = stage.getBoundingClientRect()
    const mapped = mapLensPointToScreen({
      clientX,
      clientY,
      stageLeft: rect.left,
      stageTop: rect.top,
      scrollLeft: stage.scrollLeft,
      scrollTop: stage.scrollTop,
      zoom: appliedZoom,
      captureWidth: contentW,
      captureHeight: contentH,
      crop: displayCrop,
      window: windowBounds
    })
    if (!mapped) {
      setActionNote('Click was outside the mirrored content.')
      return
    }
    controlBusy.current = true
    try {
      // After the single handoff: never re-activate on scroll/move; no focus ping-pong.
      const result = await window.miko.lensPointer({
        action,
        x: mapped.x,
        y: mapped.y,
        dx: deltas?.dx,
        dy: deltas?.dy,
        expectSourceId: sourceId,
        activate: false,
        intent: 'control-original'
      })
      if (!result.ok) {
        setActionNote(result.reason || 'Control failed.')
        if (/closed|changed|stopped|verify/i.test(result.reason)) {
          setMode('view')
          setOriginalHandedOff(false)
        }
        return
      }
      if (result.activated) {
        setActionNote('Unexpected re-activate — leaving Control original to avoid focus ping-pong.')
        window.miko.lensCancelInput()
        setMode('view')
        setOriginalHandedOff(false)
      }
    } finally {
      controlBusy.current = false
    }
  }

  async function enterControlOriginal(): Promise<void> {
    if (!controlOrigCap?.available || !sourceId) {
      setActionNote(controlOrigCap?.detail || 'Control original isn’t available for this source.')
      return
    }
    window.miko.lensCancelInput()
    setActionNote('Handing off to the original window once…')
    const r = await window.miko.lensOpenOriginal(sourceId)
    if (!r.ok) {
      setActionNote(r.reason || 'Couldn’t bring the original forward.')
      setOriginalHandedOff(false)
      setMode('view')
      return
    }
    setOriginalHandedOff(true)
    setMode('control-original')
    setActionNote(
      `${r.reason} Control happens in the real ${sourceLabel} window. Esc returns to View (mirror stays available).`
    )
  }

  function leaveControlModes(): void {
    window.miko.lensCancelInput()
    setOriginalHandedOff(false)
    setMode('view')
    setActionNote('')
  }

  async function pickSource(src: GptCaptureSource): Promise<void> {
    boundIdRef.current = src.id
    setSnap(null)
    setCrop(null)
    setCropDraft(null)
    setCropping(false)
    setFrozen(false)
    setZoomMode('fit')
    setZoom(1)
    setPickerOpen(false)
    lastCaptureSize.current = { w: 0, h: 0 }
    const s = await window.miko.gptModeSetSource(src.id, src.name, src.owner)
    if (s) setState(s)
  }

  function zoomAroundCenter(nextZoom: number, mode: ZoomMode = 'manual'): void {
    const stage = stageRef.current
    const prev = appliedZoom
    const clamped = clampGptLiveZoom(nextZoom)
    setZoomMode(mode)
    setZoom(clamped)
    if (!stage || prev <= 0) return
    requestAnimationFrame(() => {
      const cx = stage.scrollLeft + stage.clientWidth / 2
      const cy = stage.scrollTop + stage.clientHeight / 2
      const ratio = clamped / prev
      stage.scrollLeft = cx * ratio - stage.clientWidth / 2
      stage.scrollTop = cy * ratio - stage.clientHeight / 2
    })
  }

  function onStagePointerDown(event: ReactPointerEvent<HTMLDivElement>): void {
    if (unavailable) return
    const stage = stageRef.current
    if (!stage) return
    if (cropping) {
      const rect = stage.getBoundingClientRect()
      // Crop in unscaled content coordinates (full capture, not cropped view).
      const scale = zoomMode === 'fit' ? fitGptLiveScale(contentW || 1, contentH || 1, stage.clientWidth - 8, stage.clientHeight - 8) : appliedZoom
      const x = (event.clientX - rect.left + stage.scrollLeft) / Math.max(0.01, scale)
      const y = (event.clientY - rect.top + stage.scrollTop) / Math.max(0.01, scale)
      cropDragRef.current = { x0: x, y0: y, x1: x, y1: y }
      setCropDraft(null)
      stage.setPointerCapture(event.pointerId)
      return
    }
    if (inControlOriginal) {
      event.preventDefault()
      const now = Date.now()
      const prev = lastClickRef.current
      const isDouble =
        now - prev.t < 350 && Math.hypot(event.clientX - prev.x, event.clientY - prev.y) < 8
      lastClickRef.current = { t: now, x: event.clientX, y: event.clientY }
      void mapAndPointer(event.clientX, event.clientY, isDouble ? 'dblclick' : 'click')
      return
    }
    panRef.current = { x: event.clientX, y: event.clientY, left: stage.scrollLeft, top: stage.scrollTop }
    setPanning(true)
    stage.setPointerCapture(event.pointerId)
  }

  function onStageWheel(event: ReactWheelEvent<HTMLDivElement>): void {
    if (!inControlOriginal || frozen || cropping || pickerOpen) return
    event.preventDefault()
    void mapAndPointer(event.clientX, event.clientY, 'scroll', { dx: event.deltaX, dy: event.deltaY })
  }

  async function onStageKeyDown(event: ReactKeyboardEvent<HTMLDivElement>): Promise<void> {
    if (!inControlOriginal || frozen || cropping || pickerOpen) return
    if (event.key === 'Escape') {
      leaveControlModes()
      setActionNote('Left Control original (Esc). Mirror is view-only again.')
      return
    }
    if (event.metaKey || event.ctrlKey || event.altKey) return
    if (event.key.length !== 1) return
    event.preventDefault()
    if (!sourceId || !inControlOriginal || !originalHandedOff) return
    const result = await window.miko.lensType({
      text: event.key,
      expectSourceId: sourceId,
      activate: false,
      intent: 'control-original'
    })
    if (!result.ok) {
      setActionNote(result.reason || 'Typing failed.')
      if (/closed|changed|stopped/i.test(result.reason)) setMode('view')
    } else if (result.activated) {
      setActionNote(`Typing into ${sourceLabel} · brought it forward.`)
    }
  }

  function onStagePointerMove(event: ReactPointerEvent<HTMLDivElement>): void {
    const stage = stageRef.current
    if (!stage) return
    if (cropping && cropDragRef.current && contentW > 0 && contentH > 0) {
      const rect = stage.getBoundingClientRect()
      const scale =
        zoomMode === 'fit'
          ? fitGptLiveScale(contentW, contentH, stage.clientWidth - 8, stage.clientHeight - 8)
          : appliedZoom
      const x = (event.clientX - rect.left + stage.scrollLeft) / Math.max(0.01, scale)
      const y = (event.clientY - rect.top + stage.scrollTop) / Math.max(0.01, scale)
      cropDragRef.current.x1 = x
      cropDragRef.current.y1 = y
      const x0 = Math.min(cropDragRef.current.x0, cropDragRef.current.x1)
      const y0 = Math.min(cropDragRef.current.y0, cropDragRef.current.y1)
      const x1 = Math.max(cropDragRef.current.x0, cropDragRef.current.x1)
      const y1 = Math.max(cropDragRef.current.y0, cropDragRef.current.y1)
      setCropDraft(
        normalizeGptLiveCrop({
          x: x0 / contentW,
          y: y0 / contentH,
          width: (x1 - x0) / contentW,
          height: (y1 - y0) / contentH
        })
      )
      return
    }
    if (!panRef.current) return
    stage.scrollLeft = panRef.current.left - (event.clientX - panRef.current.x)
    stage.scrollTop = panRef.current.top - (event.clientY - panRef.current.y)
  }

  function onStagePointerUp(): void {
    cropDragRef.current = null
    panRef.current = null
    setPanning(false)
  }

  function beginCrop(): void {
    if (!hasLiveFrame) return
    setCropping(true)
    setCropDraft(null)
    // Show full frame while editing crop.
    setZoomMode('fit')
  }

  function applyCrop(): void {
    const next = normalizeGptLiveCrop(cropDraft)
    if (next) setCrop(next)
    setCropDraft(null)
    setCropping(false)
    setZoomMode('fit')
  }

  function cancelCrop(): void {
    setCropDraft(null)
    setCropping(false)
  }

  async function collapseLens(next: boolean): Promise<void> {
    setMenuOpen(false)
    setCropping(false)
    const ok = await window.miko.gptModeLiveCollapse(next)
    if (ok) setCollapsed(next)
  }

  const imgStyle = useMemo(() => {
    if (cropping || !displayCrop || !contentW || !contentH) {
      return { width: contentW || undefined, height: contentH || undefined }
    }
    const sx = contentW * displayCrop.x
    const sy = contentH * displayCrop.y
    return {
      width: contentW,
      height: contentH,
      marginLeft: -sx,
      marginTop: -sy,
      clipPath: `inset(${sy}px ${contentW - sx - contentW * displayCrop.width}px ${
        contentH - sy - contentH * displayCrop.height
      }px ${sx}px)`
    }
  }, [contentH, contentW, cropping, displayCrop])

  if (collapsed) {
    return (
      <div className="lens-shell is-collapsed" ref={shellRef} aria-label="MIKO Lens collapsed">
        <div className="lens-pill">
          <span className="lens-paw" aria-hidden="true">
            <PawIcon />
          </span>
          <span className="lens-pill-label">{sourceLabel} · {frozen ? 'Frozen' : hasLiveFrame ? 'Live' : 'Idle'}</span>
          <button
            type="button"
            className="lens-btn is-icon"
            title="Expand MIKO Lens"
            aria-label="Expand MIKO Lens"
            onClick={() => void collapseLens(false)}
          >
            <IconExpand />
          </button>
          <button
            type="button"
            className="lens-btn is-icon"
            title="Close MIKO Lens"
            aria-label="Close MIKO Lens"
            onClick={() => void window.miko.gptModeSetLiveView(false)}
          >
            <IconClose />
          </button>
        </div>
      </div>
    )
  }

  const stageZoom = cropping
    ? fitGptLiveScale(contentW || 1, contentH || 1, Math.max(1, stageSize.width - 8), Math.max(1, stageSize.height - 8))
    : appliedZoom
  const stageContentW = cropping ? contentW : croppedW
  const stageContentH = cropping ? contentH : croppedH

  return (
    <div className="lens-shell" ref={shellRef} aria-label="MIKO Lens">
      <header className="lens-header">
        <div className="lens-brand">
          <span className="lens-paw" aria-hidden="true">
            <PawIcon />
          </span>
          <div className="lens-titles">
            <h1>MIKO Lens</h1>
            <p title={`${sourceLabel} · ${sourceTitle}`}>
              {sourceLabel}
              {sourceTitle ? ` · ${sourceTitle}` : ''}
            </p>
          </div>
        </div>
        <span
          className={['lens-status', statusKind === 'frozen' ? 'is-frozen' : '', statusKind === 'error' ? 'is-error' : '']
            .filter(Boolean)
            .join(' ')}
          aria-live="polite"
        >
          <span className="lens-status-dot" aria-hidden="true" />
          {statusText}
        </span>
        <div className="lens-header-actions lens-nodrag">
          <button type="button" className="lens-btn" title="Change source window" aria-label="Change source" onClick={() => void openPicker()}>
            <IconSource />
            <span className={narrow ? 'lens-hide-narrow' : undefined}>Source</span>
          </button>
          <button
            type="button"
            className="lens-btn is-icon"
            title="Collapse to pill"
            aria-label="Collapse MIKO Lens"
            onClick={() => void collapseLens(true)}
          >
            <IconCollapse />
          </button>
          <button
            type="button"
            className="lens-btn is-icon"
            title="Close MIKO Lens"
            aria-label="Close MIKO Lens"
            onClick={() => void window.miko.gptModeSetLiveView(false)}
          >
            <IconClose />
          </button>
        </div>
      </header>

      <div className="lens-toolbar lens-nodrag" role="toolbar" aria-label="Reading controls">
        <div className="lens-toolbar-group" role="group" aria-label="Mode">
          <button
            type="button"
            className={['lens-btn', mode === 'view' ? 'is-active' : ''].filter(Boolean).join(' ')}
            title="View — live mirror only (not an interactive embed)"
            aria-label="View mode"
            aria-pressed={mode === 'view'}
            onClick={() => leaveControlModes()}
          >
            View
          </button>
          <button
            type="button"
            className={['lens-btn', mode === 'media' || (spotifySource && showMediaBar && !inControlOriginal) ? 'is-active' : '']
              .filter(Boolean)
              .join(' ')}
            disabled={!mediaCap?.available || !hasLiveFrame || cropping || pickerOpen}
            title={mediaCap?.available ? mediaCap.detail : mediaCap?.detail || 'No media controls for this app'}
            aria-label="Media controls"
            aria-pressed={mode === 'media'}
            onClick={() => {
              leaveControlModes()
              if (!mediaCap?.available) {
                setActionNote(mediaCap?.detail || 'Media unavailable.')
                return
              }
              setMode('media')
              setActionNote(mediaCap.detail)
            }}
          >
            Media
          </button>
          <button
            type="button"
            className="lens-btn"
            disabled
            title={interactiveCap?.detail || 'Interactive in-mirror control not verified for this app'}
            aria-label="Interactive (unavailable)"
            aria-pressed={false}
          >
            Interactive
          </button>
          <button
            type="button"
            className={['lens-btn', inControlOriginal ? 'is-active' : ''].filter(Boolean).join(' ')}
            disabled={!controlOrigCap?.available || !hasLiveFrame || frozen || cropping || pickerOpen}
            title={controlOrigCap?.detail || 'Control original'}
            aria-label="Control original"
            aria-pressed={inControlOriginal}
            onClick={() => void enterControlOriginal()}
          >
            Control original
          </button>
          <button
            type="button"
            className={['lens-btn', shelfOpen ? 'is-active' : ''].filter(Boolean).join(' ')}
            title="Files — Finder selection, picker, drag, attach"
            aria-label="Files"
            onClick={() => {
              if (shelfOpen) {
                setShelfOpen(false)
                return
              }
              void openFilesShelf()
            }}
          >
            Files
          </button>
        </div>
        <div className="lens-toolbar-group">
          <button
            type="button"
            className={['lens-btn', zoomMode === 'fit' ? 'is-active' : ''].filter(Boolean).join(' ')}
            disabled={!hasLiveFrame || cropping || inControlOriginal}
            title="Fit window in viewport"
            aria-label="Fit"
            onClick={() => {
              setZoomMode('fit')
              setZoom(fit)
            }}
          >
            Fit
          </button>
          <button
            type="button"
            className="lens-btn is-icon"
            disabled={!hasLiveFrame || cropping}
            title="Zoom out"
            aria-label="Zoom out"
            onClick={() => zoomAroundCenter((zoomMode === 'fit' ? fit : zoom) - GPT_LIVE_ZOOM_STEP)}
          >
            <IconMinus />
          </button>
          <span className="lens-zoom-label" aria-live="polite">
            {hasLiveFrame ? `${Math.round(appliedZoom * 100)}%` : '—'}
          </span>
          <button
            type="button"
            className="lens-btn is-icon"
            disabled={!hasLiveFrame || cropping}
            title="Zoom in"
            aria-label="Zoom in"
            onClick={() => zoomAroundCenter((zoomMode === 'fit' ? fit : zoom) + GPT_LIVE_ZOOM_STEP)}
          >
            <IconPlus />
          </button>
        </div>
        <div className="lens-toolbar-group">
          <button
            type="button"
            className={['lens-btn', cropping ? 'is-active' : ''].filter(Boolean).join(' ')}
            disabled={!hasLiveFrame}
            title="Crop conversation region"
            aria-label="Crop"
            onClick={() => (cropping ? cancelCrop() : beginCrop())}
          >
            <IconCrop />
            Crop
          </button>
          <button
            type="button"
            className={['lens-btn', frozen ? 'is-active' : ''].filter(Boolean).join(' ')}
            disabled={!hasLiveFrame || cropping}
            title={frozen ? 'Resume live capture' : 'Freeze frame'}
            aria-label={frozen ? 'Resume' : 'Freeze'}
            onClick={() => setFrozen((v) => !v)}
          >
            {frozen ? <IconPlay /> : <IconPause />}
            {narrow ? null : frozen ? 'Resume' : 'Freeze'}
          </button>
        </div>
        <div className="lens-toolbar-spacer" />
        <div className="lens-toolbar-group">
          <button
            type="button"
            className="lens-btn"
            title="Expand reading size"
            aria-label="Expand"
            onClick={() => void window.miko.gptModeLiveSizePreset('expand')}
          >
            <IconExpand />
            <span className={narrow ? 'lens-hide-narrow' : undefined}>Expand</span>
          </button>
          <div className="lens-menu-wrap" ref={menuRef}>
            <button
              type="button"
              className={['lens-btn is-icon', menuOpen ? 'is-active' : ''].filter(Boolean).join(' ')}
              title="More actions"
              aria-label="More"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((v) => !v)}
            >
              <IconMore />
            </button>
            {menuOpen ? (
              <div className="lens-menu" role="menu">
                <button
                  type="button"
                  role="menuitem"
                  disabled={!hasLiveFrame || cropping}
                  onClick={() => {
                    setZoomMode('actual')
                    zoomAroundCenter(1, 'actual')
                    setMenuOpen(false)
                  }}
                >
                  Actual size
                </button>
                <button
                  type="button"
                  role="menuitem"
                  disabled={!crop || cropping}
                  onClick={() => {
                    setCrop(null)
                    setCropDraft(null)
                    setZoomMode('fit')
                    setMenuOpen(false)
                  }}
                >
                  Reset crop
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    void window.miko.gptModeLiveSizePreset('compact')
                    setMenuOpen(false)
                  }}
                >
                  Compact size
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    void window.miko.gptModeLiveSizePreset('reading')
                    setMenuOpen(false)
                  }}
                >
                  Reading size
                </button>
                <hr />
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    void window.miko.gptModeFocus()
                    setMenuOpen(false)
                  }}
                >
                  Open ChatGPT
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setDetailsOpen((v) => !v)
                    setMenuOpen(false)
                  }}
                >
                  {detailsOpen ? 'Hide diagnostics' : 'Diagnostics'}
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {showMediaBar && !collapsed ? (
        <div className="lens-spotify lens-nodrag" role="toolbar" aria-label="Spotify media controls">
          <div className="lens-spotify-meta">
            <strong>Spotify · Media</strong>
            <span>
              {!spotifyStatus
                ? 'Reading…'
                : !spotifyStatus.ok && spotifyStatus.state === 'unavailable'
                  ? spotifyStatus.reason || 'Unavailable'
                  : spotifyStatus.track
                    ? `${spotifyStatus.state === 'playing' ? 'Playing' : spotifyStatus.state === 'paused' ? 'Paused' : spotifyStatus.state} · ${spotifyStatus.track}${spotifyStatus.artist ? ` · ${spotifyStatus.artist}` : ''}`
                    : spotifyStatus.running
                      ? spotifyStatus.state === 'unavailable'
                        ? spotifyStatus.reason || 'Status unavailable'
                        : spotifyStatus.state || 'Ready'
                      : 'Not running'}
            </span>
            {spotifyStatus?.ok && spotifyStatus.volume != null ? <em>Vol {spotifyStatus.volume}</em> : null}
            {spotifyStatus?.method === 'system-media-key' ? <em>via media keys (verified)</em> : null}
            {spotifyStatus && !spotifyStatus.ok ? <em className="lens-spotify-err">Error</em> : null}
          </div>
          <div className="lens-toolbar-group">
            <button type="button" className="lens-btn" disabled={spotifyBusy || !spotifyStatus?.running} title="Previous track (Spotify AppleScript)" onClick={() => void runSpotify('previous')}>
              Prev
            </button>
            <button type="button" className="lens-btn" disabled={spotifyBusy || !spotifyStatus?.running} title="Play / pause (Spotify AppleScript)" onClick={() => void runSpotify('play-pause')}>
              {spotifyStatus?.state === 'playing' ? 'Pause' : 'Play'}
            </button>
            <button type="button" className="lens-btn" disabled={spotifyBusy || !spotifyStatus?.running} title="Next track (Spotify AppleScript)" onClick={() => void runSpotify('next')}>
              Next
            </button>
            <button type="button" className="lens-btn" disabled={spotifyBusy || !spotifyStatus?.running} title="Volume down" onClick={() => void runSpotify('volume-down')}>
              Vol−
            </button>
            <button type="button" className="lens-btn" disabled={spotifyBusy || !spotifyStatus?.running} title="Volume up" onClick={() => void runSpotify('volume-up')}>
              Vol+
            </button>
          </div>
          <p className="lens-spotify-note">
            {mediaCap?.detail} Interactive-in-mirror is unavailable for Spotify. Use Control original for playlist/search UI in the real window.
            {interactiveCap && !interactiveCap.available ? ` (${interactiveCap.detail})` : ''}
          </p>
        </div>
      ) : null}
      {!spotifySource && interactiveCap && !interactiveCap.available && !collapsed && mode === 'view' ? (
        <p className="lens-cap-note lens-nodrag">{interactiveCap.detail}</p>
      ) : null}

      <div className="lens-body">
        {pickerOpen ? (
          <div className="lens-picker">
            <div className="lens-picker-head">
              <h2>Choose window</h2>
              <p>{pickerReason}</p>
            </div>
            {pickerSources.length ? (
              <div className="lens-picker-list">
                {pickerSources.map((src) => (
                  <button
                    type="button"
                    key={src.id}
                    className={src.recommended ? 'lens-pick is-recommended' : 'lens-pick'}
                    onClick={() => void pickSource(src)}
                  >
                    {src.previewUrl ? <img src={src.previewUrl} alt="" draggable={false} /> : <span className="lens-pick-blank" />}
                    <strong>{src.owner || 'App'}</strong>
                    <span>{src.name}</span>
                    {src.recommended ? <em>Recommended · ChatGPT</em> : null}
                  </button>
                ))}
              </div>
            ) : (
              <p className="lens-empty">No capturable windows yet. Open ChatGPT, then Refresh.</p>
            )}
            <div className="lens-actions">
              <button type="button" className="lens-btn" onClick={() => setPickerOpen(false)}>
                Cancel
              </button>
              <button type="button" className="lens-btn" onClick={() => void openPicker()}>
                Refresh
              </button>
              <button type="button" className="lens-btn" onClick={() => void window.miko.gptModeFocus()}>
                Open ChatGPT
              </button>
            </div>
          </div>
        ) : unavailable ? (
          <div className="lens-empty">
            <h2>{lensPlatform === 'win32' ? 'Lens unavailable on Windows' : gptLiveKindLabel(kind)}</h2>
            <p>
              {lensPlatform === 'win32'
                ? caps.capabilities.find((c) => c.id === 'view')?.detail ||
                  'Lens window capture and control are not available on Windows yet. Use Interactive GPT instead.'
                : snap?.reason || state?.liveViewDetail || 'Choose a ChatGPT window to mirror.'}
            </p>
            {lensPlatform === 'win32' ? (
              <p className="lens-shelf-hint">Empty live frames are expected here — nothing is mirrored until a Windows capture path exists.</p>
            ) : (
              <div className="lens-actions">
                <button type="button" className="lens-btn" onClick={() => void openPicker()}>
                  Choose window
                </button>
                <button
                  type="button"
                  className="lens-btn"
                  onClick={() => {
                    setSnap(null)
                    void window.miko.gptModeLiveSnapshot().then(setSnap)
                  }}
                >
                  Retry
                </button>
                <button type="button" className="lens-btn" onClick={() => void window.miko.gptModeFocus()}>
                  Open ChatGPT
                </button>
              </div>
            )}
          </div>
        ) : (
          <>
            <div
              ref={stageRef}
              className={[
                'lens-stage',
                panning ? 'is-panning' : '',
                cropping ? 'is-cropping' : '',
                inControlOriginal ? 'is-control' : ''
              ]
                .filter(Boolean)
                .join(' ')}
              tabIndex={inControlOriginal ? 0 : -1}
              onPointerDown={onStagePointerDown}
              onPointerMove={onStagePointerMove}
              onPointerUp={onStagePointerUp}
              onPointerCancel={onStagePointerUp}
              onWheel={onStageWheel}
              onKeyDown={(e) => void onStageKeyDown(e)}
            >
              <div
                className="lens-canvas"
                style={{
                  width: Math.max(1, stageContentW) * stageZoom,
                  height: Math.max(1, stageContentH) * stageZoom
                }}
              >
                <div
                  style={{
                    transform: `scale(${stageZoom})`,
                    transformOrigin: '0 0',
                    width: stageContentW,
                    height: stageContentH,
                    overflow: 'hidden',
                    position: 'relative'
                  }}
                >
                  <img
                    src={snap!.dataUrl}
                    alt={`Mirror of ${sourceLabel}`}
                    draggable={false}
                    style={cropping ? { width: contentW, height: contentH } : imgStyle}
                  />
                  {cropping && draftCrop && contentW > 0 && contentH > 0 ? (
                    <div
                      className="lens-crop-rect"
                      style={{
                        left: contentW * draftCrop.x,
                        top: contentH * draftCrop.y,
                        width: contentW * draftCrop.width,
                        height: contentH * draftCrop.height
                      }}
                    />
                  ) : null}
                </div>
              </div>
            </div>
            {cropping ? (
              <div className="lens-crop-bar">
                <span>Drag to select the conversation region. Apply stores a relative crop — not a guessed sidebar cut.</span>
                <div className="lens-actions">
                  <button type="button" className="lens-btn" onClick={cancelCrop}>
                    Cancel
                  </button>
                  <button type="button" className="lens-btn is-active" disabled={!draftCrop} onClick={applyCrop}>
                    Apply crop
                  </button>
                </div>
              </div>
            ) : null}
            {shelfOpen ? (
              <div className="lens-shelf lens-nodrag" aria-label="Selected files">
                <div className="lens-shelf-head">
                  <strong>Selected files</strong>
                  <span>{finderSource ? 'From Finder selection / picker' : 'Picker · proven cards · drop zone'}</span>
                </div>
                <div className="lens-shelf-actions">
                  {finderSource ? (
                    <button type="button" className="lens-btn" onClick={() => void refreshShelfFromFinder()}>
                      Refresh Finder
                    </button>
                  ) : null}
                  <button type="button" className="lens-btn" onClick={() => void pickFilesNative()}>
                    Choose files…
                  </button>
                  {finderSource ? (
                    <button
                      type="button"
                      className="lens-btn"
                      disabled={!shelfFiles.length || attachBusy}
                      onClick={() => {
                        const first = shelfFiles[0]
                        if (first) void attachPath(first.path)
                      }}
                    >
                      Attach to ChatGPT…
                    </button>
                  ) : null}
                  <button type="button" className="lens-btn" onClick={() => setShelfOpen(false)}>
                    Hide
                  </button>
                </div>
                {shelfFiles.length ? (
                  <ul className="lens-shelf-list">
                    {shelfFiles.map((file) => (
                      <li key={file.path} className="lens-shelf-item">
                        <span
                          className="lens-shelf-drag"
                          title="Drag as a real file"
                          draggable
                          onDragStart={(event) => {
                            event.preventDefault()
                            window.miko.lensStartDrag(file.path)
                          }}
                        >
                          ⠿
                        </span>
                        <span className="lens-shelf-name" title={file.path}>
                          {file.filename}
                        </span>
                        <button
                          type="button"
                          className="lens-btn"
                          onClick={() =>
                            void window.miko.lensCopyFile(file.path).then((r) => setActionNote(r.reason || (r.ok ? 'Copied file.' : 'Copy failed.')))
                          }
                        >
                          Copy file
                        </button>
                        <button
                          type="button"
                          className="lens-btn"
                          onClick={() => void window.miko.lensRevealFile(file.path).then((ok) => setActionNote(ok ? 'Revealed in Finder.' : 'File missing.'))}
                        >
                          Reveal
                        </button>
                        {!finderSource || chatGptSource ? (
                          <button
                            type="button"
                            className="lens-btn"
                            disabled={attachBusy}
                            onClick={() => void attachPath(file.path)}
                          >
                            Attach
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="lens-btn"
                            disabled={attachBusy}
                            onClick={() => void attachPath(file.path)}
                          >
                            Attach to ChatGPT…
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="lens-shelf-empty">No resolved files yet. Select in Finder, Choose files…, or use a proven MIKO file card.</p>
                )}
                {!finderSource ? (
                  <div
                    className="lens-attach-zone"
                    onDragOver={(e) => {
                      e.preventDefault()
                      e.dataTransfer.dropEffect = 'copy'
                    }}
                    onDrop={(e: ReactDragEvent<HTMLDivElement>) => {
                      e.preventDefault()
                      const fromOs = [...(e.dataTransfer.files || [])]
                        .map((f) => (f as File & { path?: string }).path)
                        .filter((p): p is string => Boolean(p))
                      if (!fromOs.length) {
                        setActionNote('Drop a real file from Finder (path required).')
                        return
                      }
                      void (async () => {
                        const added: LensResolvedFile[] = []
                        for (const p of fromOs.slice(0, 10)) {
                          const row = await window.miko.lensRegisterFile(p)
                          if (row) added.push({ ...row, provenance: 'drop' })
                        }
                        if (!added.length) {
                          setActionNote('Dropped paths weren’t readable files.')
                          return
                        }
                        setShelfFiles((prev) => mergeFiles(prev, added))
                        setActionNote(`Added ${added.length} dropped file(s). Attach is separate — nothing was uploaded.`)
                      })()
                    }}
                  >
                    Drop a real file here to add it, then Attach. Dropping does not upload or send.
                  </div>
                ) : (
                  <p className="lens-shelf-hint">Finder is the source — use Attach to ChatGPT… (don’t drop onto the Finder mirror).</p>
                )}
              </div>
            ) : null}
          </>
        )}
      </div>

      <footer className="lens-footer">
        <span>
          {inControlOriginal
            ? `Control original · ${sourceLabel} · real window is interactive · Esc → View`
            : showMediaBar
              ? 'Spotify · View + Media (not full app control inside Lens)'
              : hasLiveFrame
                ? frozen
                  ? 'Frozen mirror'
                  : 'Live mirror · not an interactive embed · scrolling here does not scroll the original'
                : 'Waiting for source'}
          {actionNote ? ` · ${actionNote}` : ''}
        </span>
        <span>
          {snap?.captureWidth && snap.captureHeight ? `${snap.captureWidth}×${snap.captureHeight}px` : ''}
        </span>
      </footer>
      {detailsOpen ? (
        <div className="lens-details">
          {`kind=${kind}\nsourceId=${snap?.sourceId || state?.captureSourceId || ''}\nowner=${sourceLabel}\nname=${sourceTitle}\npermission=${snap?.permission || ''}\n${snap?.reason || state?.liveViewDetail || ''}`}
        </div>
      ) : null}
    </div>
  )
}

function useStageSize(ref: RefObject<HTMLDivElement | null>): { width: number; height: number } {
  const [size, setSize] = useState({ width: 800, height: 500 })
  useEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (!entry) return
      setSize({ width: entry.contentRect.width, height: entry.contentRect.height })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [ref])
  return size
}

function PawIcon(): ReactElement {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="7" cy="8" r="2.2" />
      <circle cx="12" cy="5.5" r="2.2" />
      <circle cx="17" cy="8" r="2.2" />
      <ellipse cx="12" cy="15.5" rx="5.2" ry="4.2" />
    </svg>
  )
}

function IconClose(): ReactElement {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  )
}

function IconCollapse(): ReactElement {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 12h14" />
    </svg>
  )
}

function IconExpand(): ReactElement {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M9 5H5v4M15 5h4v4M9 19H5v-4M15 19h4v-4" />
    </svg>
  )
}

function IconSource(): ReactElement {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M8 19h8" />
    </svg>
  )
}

function IconMinus(): ReactElement {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6 12h12" />
    </svg>
  )
}

function IconPlus(): ReactElement {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 6v12M6 12h12" />
    </svg>
  )
}

function IconCrop(): ReactElement {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6 3v15h15M3 6h15v15" />
    </svg>
  )
}

function IconPause(): ReactElement {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M8 6v12M16 6v12" />
    </svg>
  )
}

function IconPlay(): ReactElement {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M8 6l12 6-12 6V6z" />
    </svg>
  )
}

function IconMore(): ReactElement {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="6" cy="12" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="18" cy="12" r="1.4" fill="currentColor" stroke="none" />
    </svg>
  )
}
