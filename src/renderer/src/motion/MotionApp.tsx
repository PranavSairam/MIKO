import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { HitRect, OpenResult, PanelLayout, PlacementEvent, PointerSample, PresenceEvent, SavedChat } from '../../../shared/api'
import {
  movementLine,
  planVoice,
  poseLine,
  routeCommand,
  type CatalogApp,
  type CommandResult
} from '../../../shared/commands'
import {
  IDLE_ORDER,
  clipName,
  finishOneShot,
  isOneShot,
  mulberry32,
  replanAfterDrag,
  silence,
  stepBehavior,
  summonActor,
  type Actor,
  type BehaviorContext,
  type BehaviorOrder
} from '../../../shared/doberman'
import { ARRIVE_EPS, clampTravel, guideDestination, nextGuideTarget } from '../../../shared/guide'
import { canvasOrigin, lookTarget, pointerToViewport } from '../../../shared/look'
import { roamFor } from '../../../shared/movement'
import { EXIT_MS } from '../../../shared/summon'
import { TextPanel, type PanelEntry } from '../components/TextPanel'
import { usePetGestures, type GuidePhase } from '../hooks/usePetGestures'
import { DobermanRig } from './DobermanRig'
import { MailView } from '../mail/MailView'
import { useMail } from '../mail/useMail'
import { MAIL_REQUEST, mailRequestFor } from '../../../shared/commands'
import { BRIDGE_TEST_PROMPT } from '../../../shared/bridge'
import { SELECTION_LABELS, clarifyingQuestion, parseSelectionCommand, selectionPrompt, type SelectionAction } from '../../../shared/selection'
import { MAIL_PANEL, PANEL, PET_WINDOW, type PanelSize } from '../../../shared/layout'

const HIT_SLOP_PX = 2

export function MotionApp() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [panelOpen, setPanelOpen] = useState(false)
  const [panelSide, setPanelSide] = useState<'left' | 'right'>('left')
  const [hit, setHit] = useState<HitRect>({ x: 36, y: 24, width: 148, height: 200 })
  const [draft, setDraft] = useState('')
  const [entries, setEntries] = useState<PanelEntry[]>([])
  const entriesRef = useRef<PanelEntry[]>([])
  entriesRef.current = entries
  const [assistantThread, setAssistantThread] = useState('')
  const assistantThreadRef = useRef('')
  assistantThreadRef.current = assistantThread
  const [, setTick] = useState(0)
  const [prefs, setPrefs] = useState('')
  const [pasteBanner, setPasteBanner] = useState<{ entryId: number; text: string; armed: boolean } | null>(null)
  const pasteEntryRef = useRef(0)
  const [selectionKey, setSelectionKey] = useState('')
  const [prefsMessage, setPrefsMessage] = useState('')
  const [listening, setListening] = useState(false)
  const [listenDetail, setListenDetail] = useState('')
  const [canSpeak, setCanSpeak] = useState(false)
  const [panelView, setPanelView] = useState<'log' | 'chats' | 'prefs'>('log')
  const [tab, setTab] = useState<'chat' | 'mail'>('chat')
  const tabRef = useRef<'chat' | 'mail'>('chat')
  tabRef.current = tab
  const panelSizeRef = useRef<PanelSize>(PANEL)
  const [mail, mailActions] = useMail()
  const [chats, setChats] = useState<SavedChat[]>([])
  const [chatsMessage, setChatsMessage] = useState('')
  const entryId = useRef(1)
  const panelRequest = useRef(0)
  const panelRef = useRef(false)
  const panelSideRef = useRef(panelSide)
  const draggingRef = useRef(false)
  const guidingRef = useRef(false)
  const followGoal = useRef<{ x: number; y: number } | null>(null)
  const sitRequest = useRef(false)
  const pendingCome = useRef(false)
  const commandBridge = useRef<(decision: CommandResult) => void>(() => undefined)
  const voiceBridge = useRef<(text: string) => void>(() => undefined)
  const handledSession = useRef(0)
  const voiceAutoRef = useRef(true)
  const guideBridge = useRef<(phase: GuidePhase, screenX: number, screenY: number) => void>(() => undefined)
  const freeBridge = useRef<(phase: 'start' | 'end') => void>(() => undefined)
  const cancelGesture = useRef<() => void>(() => undefined)
  panelSideRef.current = panelSide
  const bridgeMissing = typeof window.miko === 'undefined'

  function pushEntry(entry: PanelEntry): number {
    const id = entryId.current
    entryId.current += 1
    setEntries((items) => [...items, { ...entry, id }])
    return id
  }

  function replaceEntry(id: number, entry: PanelEntry): void {
    setEntries((items) => items.map((item) => (item.id === id ? { ...entry, id } : item)))
  }

  async function applyPanel(open: boolean, mode: 'chat' | 'mail' = 'chat'): Promise<void> {
    if (typeof window.miko === 'undefined') return
    const request = ++panelRequest.current
    window.miko.setHitRects([])
    const layout: PanelLayout = await window.miko.setPanelOpen(open, mode)
    if (request !== panelRequest.current) return
    const size = { width: layout.panelWidth || PANEL.width, height: layout.panelHeight || PANEL.height, gap: mode === 'mail' ? MAIL_PANEL.gap : PANEL.gap }
    panelSizeRef.current = open ? size : PANEL
    const page = document.documentElement
    page.style.setProperty('--panel-width', `${size.width}px`)
    page.style.setProperty('--panel-height', `${size.height}px`)
    page.style.setProperty('--panel-gap', `${size.gap}px`)
    setPanelSide(layout.panelSide)
    setPanelOpen(layout.panelOpen)
    setTab(open ? mode : 'chat')
    if (!open) {
      setPanelView('log')
      window.miko.pasteCancel()
      window.miko.listenCancel()
      setListening(false)
      if (pendingCome.current) {
        pendingCome.current = false
        void window.miko.comeHere()
      }
    }
  }

  function showMailTab(): void {
    if (!panelRef.current || tabRef.current !== 'mail') void applyPanel(true, 'mail')
  }

  const gestures = usePetGestures({
    onOpenPanel: () => {
      void applyPanel(true)
    },
    onSingleClick: () => window.miko?.openSwitcher(),
    onGuide: (phase, screenX, screenY) => guideBridge.current(phase, screenX, screenY),
    onFreeDrag: (phase) => freeBridge.current(phase)
  })
  panelRef.current = panelOpen
  draggingRef.current = gestures.dragging
  guidingRef.current = gestures.guiding
  cancelGesture.current = gestures.cancel

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || typeof window.miko === 'undefined') return

    const rig = new DobermanRig(canvas)
    let frame = 0
    let running = false
    let last = performance.now()
    let mode: 'hidden' | 'live' | 'exit' = 'hidden'
    let exitAt = 0
    let generation = 0
    let ready = false
    let sequence = false
    let seenPlacement = false
    let placed = { x: 0, span: 0 }
    let home = 0
    let pinnedRight = true
    let actor: Actor | null = null
    let pointer: PointerSample | null = null
    let wasDragging = false
    let disposed = false
    let order: BehaviorOrder = { ...IDLE_ORDER }
    let guideTracking = false
    let guideTarget: number | null = null
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const rng = mulberry32((Date.now() ^ Math.floor(Math.random() * 0x100000000)) >>> 0)

    const behaviorMode = (): BehaviorContext['mode'] => {
      if (media.matches) return 'reduced'
      if (draggingRef.current) return 'drag'
      if (panelRef.current) return 'panel'
      return 'live'
    }

    const sessionHome = (): number => {
      if (pinnedRight) return placed.span
      return Math.min(placed.span, Math.max(0, home))
    }

    const context = (dt: number): BehaviorContext => {
      const settled = sessionHome()
      const roam = roamFor(settled, placed.span)
      return {
        dt,
        speedPx: rig.dipPerSecond(),
        viewerYaw: rig.viewerYaw(),
        x: placed.x,
        span: placed.span,
        cyclePx: rig.cyclePx(),
        mode: behaviorMode(),
        rng,
        home: settled,
        roamMin: roam.min,
        roamMax: roam.max,
        order
      }
    }

    const freezeClip = (): boolean => media.matches || draggingRef.current || mode !== 'live'

    const sync = (): void => {
      if (!actor) return
      rig.setYaw(actor.yaw)
      rig.setPaused(freezeClip())
      rig.play(clipName(actor.phase), isOneShot(actor.phase), actor.token)
    }

    const resetOrder = (): void => {
      order = { ...IDLE_ORDER, token: order.token }
      guideTracking = false
      guideTarget = null
    }

    const publish = (next: Omit<BehaviorOrder, 'token'>, tracking: boolean): void => {
      order = { ...next, token: order.token + 1 }
      guideTracking = tracking
      guideTarget = next.kind === 'walk' ? next.destination : null
    }

    const note = (text: string): void => {
      const id = entryId.current
      entryId.current += 1
      setEntries((items) => [...items, { id, kind: 'note', text }])
    }

    const startSequence = (): void => {
      if (!ready || !seenPlacement || mode !== 'live' || sequence) return
      sequence = true
      pinnedRight = true
      home = placed.span
      resetOrder()
      actor = summonActor(placed.x, placed.span, rig.cyclePx(), rig.viewerYaw(), rng)
      sync()
    }

    guideBridge.current = (phase, screenX) => {
      if (mode !== 'live' || !seenPlacement || !pointer) {
        resetOrder()
        return
      }
      if (phase === 'cancel') {
        guideTracking = false
        guideTarget = null
        order = { token: order.token + 1, kind: 'walk', destination: placed.x, commitHome: false }
        return
      }
      const origin = canvasOrigin(panelRef.current, panelSideRef.current, panelSizeRef.current)
      const destination = guideDestination(screenX, pointer.windowX + origin.x, placed.x, placed.span, PET_WINDOW.width)
      if (media.matches) {
        const dx = destination - placed.x
        if (Math.abs(dx) >= 1) window.miko.travelBy({ dx, reduced: true })
        if (phase === 'end') {
          pinnedRight = false
          home = destination
          window.miko.unpinHome()
        }
        return
      }
      if (phase === 'start' || (phase === 'move' && order.kind !== 'walk')) {
        const accepted = nextGuideTarget(null, destination, placed.x)
        if (accepted === null) return
        publish({ kind: 'walk', destination: accepted, commitHome: true }, true)
        return
      }
      if (order.kind !== 'walk') return
      const accepted = nextGuideTarget(guideTarget, destination, placed.x)
      if (accepted !== null) {
        guideTarget = accepted
        order = { ...order, destination: accepted, commitHome: true }
      }
      if (phase === 'end') guideTracking = false
    }

    freeBridge.current = (phase) => {
      if (phase !== 'start') return
      guideTracking = false
      guideTarget = null
      if (order.kind === 'walk' || order.kind === 'sit' || order.kind === 'stand' || order.kind === 'stay') {
        order = { token: order.token + 1, kind: 'auto', destination: placed.x, commitHome: false }
      }
      if (actor && actor.errand !== 'auto') actor = { ...actor, errand: 'auto' }
    }

    const walkTo = (
      destination: number,
      line: string
    ): void => {
      const stayed = Math.abs(destination - placed.x) <= ARRIVE_EPS
      note(line)
      if (stayed) return
      if (media.matches) {
        window.miko.travelBy({ dx: destination - placed.x, reduced: true })
        return
      }
      publish({ kind: 'walk', destination, commitHome: false }, false)
    }

    commandBridge.current = (decision) => {
      if (mode !== 'live' || !seenPlacement) return
      if (decision.type === 'move') {
        const delta = (decision.direction === 'left' ? -1 : 1) * decision.distance
        const moved = clampTravel(placed.x, placed.span, delta)
        walkTo(
          moved.destination,
          movementLine(decision.distance < 100 ? 'little' : 'move', decision.direction, moved.clamped, Math.abs(moved.destination - placed.x) <= ARRIVE_EPS)
        )
        return
      }
      if (decision.type === 'corner') {
        const destination = decision.edge === 'left' ? 0 : placed.span
        walkTo(destination, movementLine('corner', decision.edge, false, Math.abs(destination - placed.x) <= ARRIVE_EPS))
        return
      }
      if (decision.type === 'home') {
        const destination = sessionHome()
        walkTo(destination, movementLine('home', 'right', false, Math.abs(destination - placed.x) <= ARRIVE_EPS))
        return
      }
      if (decision.type === 'pose' || (decision.type === 'follow' && decision.mode === 'stay')) {
        const pose = decision.type === 'pose' ? decision.pose : 'stay'
        note(decision.type === 'follow' ? 'Staying here.' : poseLine(pose, panelRef.current))
        followGoal.current = null
        if (!media.matches) publish({ kind: pose, destination: placed.x, commitHome: false }, false)
      }
    }

    const draw = (now: number): void => {
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      if (mode === 'live' && sequence && actor) {
        if (wasDragging && !draggingRef.current) {
          pinnedRight = false
          home = placed.x
          const roam = roamFor(home, placed.span)
          actor = replanAfterDrag(actor, placed.x, placed.span, rig.cyclePx(), rig.viewerYaw(), rng, roam)
          window.miko.unpinHome()
        }
        wasDragging = draggingRef.current
        if (sitRequest.current) {
          sitRequest.current = false
          followGoal.current = null
          publish({ kind: 'sit', destination: placed.x, commitHome: false }, false)
        }
        const goal = followGoal.current
        const followPaused = panelRef.current || draggingRef.current || guidingRef.current || guideTracking
        if (goal && pointer && Math.hypot(goal.x - pointer.windowX, goal.y - pointer.windowY) < 8) {
          followGoal.current = null
        }
        if (followGoal.current && followPaused && order.kind === 'walk') {
          order = { token: order.token + 1, kind: 'stay', destination: placed.x, commitHome: false }
        } else if (followGoal.current && pointer && !followPaused) {
          const destination = Math.min(placed.span, Math.max(0, followGoal.current.x - (pointer.windowX - placed.x)))
          if (media.matches) {
            window.miko.shiftBy({
              dx: followGoal.current.x - pointer.windowX,
              dy: followGoal.current.y - pointer.windowY,
              reduced: true
            })
            followGoal.current = null
          } else if (order.kind !== 'walk' || Math.abs(order.destination - destination) > 8) {
            publish({ kind: 'walk', destination, commitHome: false }, false)
          }
        }
        const before = actor
        const stepped = stepBehavior(actor, context(dt))
        actor = stepped.actor
        if (stepped.dx !== 0 && !media.matches && !draggingRef.current) {
          window.miko.travelBy({ dx: stepped.dx, reduced: false })
        }
        const liveGoal = followGoal.current
        if (liveGoal && pointer && !followPaused && !media.matches) {
          const dy = liveGoal.y - pointer.windowY
          if (Math.abs(dy) > 3) {
            const step = Math.sign(dy) * Math.min(Math.abs(dy), rig.dipPerSecond() * dt)
            window.miko.shiftBy({ dx: 0, dy: step, reduced: false })
          }
        }
        if (
          order.kind === 'walk' &&
          actor.settledToken === order.token &&
          actor.errand !== 'walk' &&
          !guideTracking
        ) {
          if (order.commitHome) {
            pinnedRight = false
            home = Math.min(placed.span, Math.max(0, order.destination))
            window.miko.unpinHome()
          }
          order = { token: order.token, kind: 'auto', destination: home, commitHome: false }
        }
        if (actor.phase !== before.phase || actor.token !== before.token) sync()
        else rig.setYaw(actor.yaw)
      } else if (actor) {
        wasDragging = draggingRef.current
        rig.setPaused(true)
      }
      rig.setPaused(freezeClip())
      rig.advance(freezeClip() ? 0 : dt)
      const head = rig.headViewport()
      const tracking = mode === 'live' && !media.matches && !draggingRef.current
      const blendingOut = !tracking || !actor || actor.phase === 'sit' || actor.phase === 'standUp'
      let goalYaw = 0
      let goalPitch = 0
      if (!blendingOut && head && pointer) {
        const origin = canvasOrigin(panelRef.current, panelSideRef.current, panelSizeRef.current)
        const local = pointerToViewport(pointer, origin.x, origin.y)
        const goal = lookTarget(head.x, head.y, local.x, local.y)
        goalYaw = goal.yaw
        goalPitch = goal.pitch
      }
      rig.dampLook(goalYaw, goalPitch, blendingOut ? 0 : 1, dt)
      if (mode === 'live' || mode === 'exit') rig.render()
      if (mode === 'exit' && now - exitAt >= EXIT_MS) {
        mode = 'hidden'
        sequence = false
        resetOrder()
        if (actor) actor = silence(actor)
        rig.stop()
        window.miko.exitFinished(generation)
        running = false
        return
      }
      if (mode === 'hidden') {
        running = false
        return
      }
      frame = window.requestAnimationFrame(draw)
    }

    const start = (): void => {
      if (running) return
      running = true
      last = performance.now()
      frame = window.requestAnimationFrame(draw)
    }

    rig.onHit((rect) => setHit(rect))
    rig.onClipFinished((name, token) => {
      if (!actor || (name !== 'Sit' && name !== 'StandUp')) return
      const next = finishOneShot(actor, token, context(0))
      if (next === actor) return
      actor = next
      if (mode === 'live') sync()
    })

    const onPlacement = (event: PlacementEvent): void => {
      placed = {
        x: Math.min(Math.max(0, event.span), Math.max(0, event.x)),
        span: Math.max(0, event.span)
      }
      seenPlacement = true
      if (!sequence) startSequence()
    }

    const onPresence = (event: PresenceEvent): void => {
      if (event.phase === 'hidden') {
        mode = 'hidden'
        sequence = false
        resetOrder()
        cancelGesture.current()
        if (actor) actor = silence({ ...actor, errand: 'auto', remaining: 0 })
        rig.stop()
        return
      }
      if (event.phase === 'shown') {
        const resuming = mode === 'exit'
        mode = 'live'
        if (resuming) sync()
        else {
          sequence = false
          startSequence()
        }
        start()
        return
      }
      mode = 'exit'
      resetOrder()
      cancelGesture.current()
      if (actor) actor = silence({ ...actor, errand: 'auto', remaining: 0 })
      if (media.matches) {
        mode = 'hidden'
        sequence = false
        if (actor) actor = silence(actor)
        rig.stop()
        window.miko.exitFinished(event.generation)
        return
      }
      generation = event.generation
      exitAt = performance.now()
      if (actor) actor = { ...actor, paused: true }
      rig.setPaused(true)
      start()
    }

    const stopPlacement = window.miko.onPlacement(onPlacement)
    const stopPresence = window.miko.onPresence(onPresence)
    const stopPointer = window.miko.onPointer((sample) => {
      pointer = sample
    })
    const onMotion = (): void => {
      window.miko.setReducedMotion(media.matches)
      if (sequence) sync()
    }
    onMotion()
    media.addEventListener('change', onMotion)
    const onResize = (): void => rig.resize()
    window.addEventListener('resize', onResize)

    void rig.ready
      .then(() => {
        if (disposed) return
        ready = true
        rig.resize()
        startSequence()
        if (mode === 'live' || mode === 'exit') start()
      })
      .catch(() => undefined)

    return () => {
      disposed = true
      mode = 'hidden'
      guideBridge.current = () => undefined
      commandBridge.current = () => undefined
      freeBridge.current = () => undefined
      window.cancelAnimationFrame(frame)
      media.removeEventListener('change', onMotion)
      window.removeEventListener('resize', onResize)
      stopPlacement()
      stopPresence()
      stopPointer()
      rig.dispose()
    }
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || !panelOpen) return
      event.preventDefault()
      void applyPanel(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [panelOpen])

  useLayoutEffect(() => {
    if (typeof window.miko === 'undefined') return
    let frame = 0
    const report = (): void => {
      const rects: HitRect[] = []
      document.querySelectorAll<HTMLElement>('[data-hit]').forEach((element) => {
        const rect = element.getBoundingClientRect()
        if (rect.width <= 0 || rect.height <= 0) return
        rects.push({
          x: rect.left - HIT_SLOP_PX,
          y: rect.top - HIT_SLOP_PX,
          width: rect.width + HIT_SLOP_PX * 2,
          height: rect.height + HIT_SLOP_PX * 2
        })
      })
      window.miko.setHitRects(rects)
    }
    const schedule = (): void => {
      window.cancelAnimationFrame(frame)
      frame = window.requestAnimationFrame(report)
    }
    schedule()
    const observer = new ResizeObserver(schedule)
    observer.observe(document.documentElement)
    document.querySelectorAll('[data-hit]').forEach((element) => observer.observe(element))
    window.addEventListener('resize', schedule)
    return () => {
      window.cancelAnimationFrame(frame)
      observer.disconnect()
      window.removeEventListener('resize', schedule)
    }
  }, [panelOpen, panelSide, hit])

  useEffect(() => {
    return () => {
      window.miko?.setHitRects([])
    }
  }, [])

  useEffect(() => {
    const synth = window.speechSynthesis
    if (!synth) return
    const refresh = (): void => {
      setCanSpeak(synth.getVoices().some((voice) => voice.localService))
    }
    refresh()
    synth.addEventListener('voiceschanged', refresh)
    return () => synth.removeEventListener('voiceschanged', refresh)
  }, [])

  useEffect(() => {
    if (typeof window.miko === 'undefined') return
    void window.miko.getVoiceAuto().then((enabled) => {
      voiceAutoRef.current = enabled
    })
    const stopAuto = window.miko.onVoiceAuto((enabled) => {
      voiceAutoRef.current = enabled
    })
    // Hiding or dismissing MIKO ends any recording and releases the microphone.
    const stopHide = window.miko.onPresence((event) => {
      if (event.phase === 'shown') return
      window.miko.listenCancel()
      setListening(false)
    })
    return () => {
      stopAuto()
      stopHide()
    }
  }, [])

  useEffect(() => {
    if (typeof window.miko === 'undefined') return
    void window.miko.bridgeStatus().then((st) => setAssistantThread(st?.thread ?? ''))
    void window.miko.prefsGet().then(setPrefs)
    void window.miko.selectionShortcutGet().then(setSelectionKey)
    const stopSelection = window.miko.onSelection((event) => {
      window.miko.pasteCancel()
      setPanelView('log')
      if (!panelRef.current || tabRef.current !== 'chat') void applyPanel(true, 'chat')
      pushEntry({ id: 0, kind: 'selection', ...event })
    })
    const stopPaste = window.miko.onPasteState((ev) => {
      const entryId = pasteEntryRef.current
      if (!entryId) return
      const text =
        ev.state === 'armed'
          ? 'Armed for 30 s: click into the field you want, then press \u2303\u2325V to paste once. Esc cancels.'
          : ev.reason || (ev.state === 'expired' ? 'Paste expired.' : 'Paste cancelled.')
      setPasteBanner({ entryId, text, armed: ev.state === 'armed' })
    })
    const tick = window.setInterval(() => {
      if (entriesRef.current.some((e) => e.kind === 'bridge' && (e.status === 'sending' || e.status === 'running'))) setTick((n) => n + 1)
    }, 1000)
    const stop = window.miko.onBridge((u) => {
      const secs = u.seconds !== undefined ? ` in ${u.seconds} s` : ''
      if (u.phase === 'running') updateBridge(u.requestId, { status: 'running' })
      else if (u.phase === 'done') {
        const entry = entriesRef.current.find((e) => e.kind === 'bridge' && e.requestId === u.requestId)
        const oneOff = entry?.kind === 'bridge' && entry.selection && entry.selection.action !== 'ask'
        if (u.thread && !oneOff) setAssistantThread(u.thread)
        const question = entry?.kind === 'bridge' && entry.selection?.action === 'reply' ? clarifyingQuestion(u.reply ?? '') : null
        updateBridge(u.requestId, { status: 'done', reply: u.reply ?? '', thread: u.thread ?? '', detail: `Answered${secs}.`, question: question ?? undefined })
      } else updateBridge(u.requestId, { status: u.phase, detail: `${u.reason ?? 'Stopped.'}${secs ? ` (${secs.trim()})` : ''}` })
    })
    return () => {
      window.clearInterval(tick)
      stop()
      stopSelection()
      stopPaste()
    }
  }, [])

  useEffect(() => {
    if (typeof window.miko === 'undefined') return
    let warned = false
    return window.miko.onKeys((event) => {
      if (event.kind === 'talk-start') {
        // Main already started listening; show it in the panel.
        if (!panelRef.current) void applyPanel(true)
        setListenDetail('Listening\u2026 let go of Caps Lock + A to stop.')
        setListening(true)
        return
      }
      if (event.kind === 'permission' && !warned) {
        warned = true
        pushEntry({
          id: 0,
          kind: 'note',
          text: 'MIKO Keys needs Accessibility and Input Monitoring for Caps Lock + A and Tab + Q. System Settings \u2192 Privacy & Security \u2192 Accessibility and Input Monitoring.'
        })
      }
    })
  }, [])

  useEffect(() => {
    if (typeof window.miko === 'undefined') return
    const stopSpeech = window.miko.onSpeech((event) => {
      // One result per recording: ignore anything for a session that was already handled.
      if (event.session !== undefined) {
        if (event.session <= handledSession.current) return
        handledSession.current = event.session
      }
      setListening(false)
      if (event.phase === 'transcript' && event.text) {
        voiceBridge.current(event.text)
        return
      }
      if (event.phase === 'cancelled') return
      const text =
        event.phase === 'denied'
          ? 'Microphone access was denied.'
          : event.phase === 'silence'
            ? 'I didn\u2019t hear anything.'
            : event.phase === 'unavailable'
              ? 'Speech recognition isn\u2019t available.'
              : 'Speech recognition stopped.'
      pushEntry({ id: 0, kind: 'note', text })
    })
    const stopClose = window.miko.onCloseUpdate((event) => {
      setEntries((items) =>
        items.map((item) =>
          item.kind === 'closing' && item.appId === event.id
            ? {
                ...item,
                text:
                  event.status === 'closed'
                    ? `${event.name} closed.`
                    : `${event.name} is still open. It may be waiting on a save prompt, or the quit was cancelled.`
              }
            : item
        )
      )
    })
    const stopFollow = window.miko.onFollow((event) => {
      if (event.kind === 'placed') {
        followGoal.current = null
        sitRequest.current = true
        return
      }
      if (typeof event.x === 'number' && typeof event.y === 'number') {
        followGoal.current = { x: event.x, y: event.y }
      }
    })
    return () => {
      stopSpeech()
      stopClose()
      stopFollow()
    }
  }, [])

  async function loadCatalog(): Promise<CatalogApp[] | null> {
    try {
      return await window.miko.listApps()
    } catch {
      pushEntry({ id: 0, kind: 'note', text: 'I couldn\u2019t look up applications.' })
      return null
    }
  }

  async function loadChats(): Promise<SavedChat[]> {
    try {
      const list = await window.miko.listChats()
      setChats(list)
      return list
    } catch {
      return []
    }
  }

  function openedLine(result: OpenResult, what: string): string {
    if (!result.ok) return `I couldn\u2019t open ${what}.`
    if (result.target === 'app') return `Opened ${what} in the ChatGPT app.`
    return `Opened ${what} in ${result.appName || 'your browser'} (browser).`
  }

  async function openSavedChat(name: string): Promise<void> {
    const result = await window.miko.openChat(name)
    pushEntry({ id: 0, kind: 'note', text: openedLine(result, `\u201c${name}\u201d`) })
  }

  function showChats(): void {
    setChatsMessage('')
    void loadChats()
    setPanelView('chats')
    if (!panelRef.current) void applyPanel(true)
  }

  /**
   * MIKO assistant (Codex with ChatGPT sign-in). One request at a time; a card shows
   * success only when its own reply arrives. Follow-ups continue the current conversation.
   */
  async function startAssistant(
    prompt: string,
    opts: { fresh?: boolean; keep?: boolean; selection?: Extract<PanelEntry, { kind: 'bridge' }>['selection'] } = {}
  ): Promise<void> {
    if (entriesRef.current.some((e) => e.kind === 'bridge' && (e.status === 'sending' || e.status === 'running'))) {
      pushEntry({ id: 0, kind: 'note', text: 'MIKO is still answering. Cancel it or wait.' })
      return
    }
    const status = await window.miko.bridgeStatus()
    if (!status?.enabled) {
      pushEntry({ id: 0, kind: 'handoff', prompt, status: 'ready', detail: 'MIKO assistant is off, so this goes to the ChatGPT app. Nothing has been sent.', destination: '' })
      return
    }
    if (!status.available || !status.signedIn) {
      pushEntry({ id: 0, kind: 'note', text: status.available ? 'Sign in to ChatGPT in the ChatGPT app first.' : 'The ChatGPT app\u2019s Codex CLI wasn\u2019t found.' })
      return
    }
    const requestId = `b-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
    window.miko.pasteCancel()
    const turn =
      status.thread && !opts.fresh ? entriesRef.current.filter((e) => e.kind === 'bridge' && e.status === 'done' && e.thread === status.thread).length + 1 : 1
    pushEntry({
      id: 0,
      kind: 'bridge',
      requestId,
      prompt,
      status: 'sending',
      reply: '',
      thread: opts.fresh ? '' : status.thread,
      detail: '',
      kept: false,
      startedAt: Date.now(),
      turn,
      selection: opts.selection
    })
    const sent = await window.miko.bridgeSend(requestId, prompt, { fresh: opts.fresh, keep: opts.keep })
    if (!sent.ok) updateBridge(requestId, { status: 'failed', detail: sent.reason })
  }

  function updateBridge(requestId: string, patch: Partial<Extract<PanelEntry, { kind: 'bridge' }>>): void {
    setEntries((items) => items.map((item) => (item.kind === 'bridge' && item.requestId === requestId ? { ...item, ...patch } : item)))
  }

  function latestSelection(): Extract<PanelEntry, { kind: 'selection' }> | null {
    for (let i = entriesRef.current.length - 1; i >= 0; i -= 1) {
      const e = entriesRef.current[i]
      if (e.kind === 'selection') return e.ok ? e : null
    }
    return null
  }

  /** Run a selected-text action: the selection is quoted data; the instruction stays separate. */
  async function runSelectionAction(entryId: number, action: string, instruction: string): Promise<void> {
    const sel = entriesRef.current.find((e) => e.id === entryId)
    if (sel?.kind !== 'selection' || !sel.ok) return
    let prompt: string
    try {
      prompt = selectionPrompt(action as SelectionAction, sel.text, instruction)
    } catch (error) {
      pushEntry({ id: 0, kind: 'note', text: error instanceof Error ? error.message : 'Add an instruction first.' })
      return
    }
    await startAssistant(prompt, {
      fresh: true,
      keep: action === 'ask',
      selection: {
        captureId: sel.captureId,
        action,
        label: SELECTION_LABELS[action as SelectionAction] ?? action,
        instruction: instruction.trim(),
        canReplace: sel.canReplace,
        app: sel.app,
        text: sel.text
      }
    })
  }

  function resultOf(id: number): Extract<PanelEntry, { kind: 'bridge' }> | null {
    const e = entriesRef.current.find((item) => item.id === id)
    return e?.kind === 'bridge' && e.selection && e.status === 'done' ? e : null
  }

  async function onSubmit(): Promise<void> {
    const text = draft.trim()
    if (!text || typeof window.miko === 'undefined') return
    setDraft('')
    const sel = latestSelection()
    const selCmd = sel ? parseSelectionCommand(text) : null
    if (sel && selCmd) {
      await runSelectionAction(sel.id, selCmd.action, selCmd.instruction)
      return
    }
    const catalog = await loadCatalog()
    if (!catalog) return
    const decision = routeCommand(text, 'typed', catalog, await loadChats(), { mailTab: tabRef.current === 'mail', assistantActive: Boolean(assistantThreadRef.current) })
    if (decision.type === 'unknown' && text.trim()) {
      // Not a MIKO command: let the owner send it on rather than replying with a help line.
      pushEntry({
        id: 0,
        kind: 'choices',
        purpose: 'free-text',
        text: `\u201c${text.trim()}\u201d isn\u2019t a MIKO command. Where should it go?`,
        options: [
          { id: 'gpt', name: 'Type into ChatGPT', familiar: true },
          { id: 'miko', name: 'Ask MIKO', familiar: true }
        ],
        payload: text.trim()
      })
      return
    }
    await runDecision(decision)
  }

  /**
   * A finished recording (Caps Lock + A or the Mic button). Called once per listening session.
   * Clear commands run; closing and quitting ask first; questions open the ChatGPT card;
   * anything ambiguous or unclear, or everything when automatic execution is off, goes to the chat box for review.
   */
  async function onVoice(text: string): Promise<void> {
    if (typeof window.miko === 'undefined') return
    const auto = voiceAutoRef.current
    const sel = latestSelection()
    const selCmd = sel ? parseSelectionCommand(text) : null
    if (sel && selCmd) {
      pushEntry({ id: 0, kind: 'note', text: `Heard: \u201c${text}\u201d` })
      await runSelectionAction(sel.id, selCmd.action, selCmd.instruction)
      return
    }
    if (auto) pushEntry({ id: 0, kind: 'note', text: `Heard: \u201c${text}\u201d` })
    const catalog = auto ? await loadCatalog() : []
    if (!catalog) {
      setDraft(text)
      return
    }
    const decision = routeCommand(text, 'voice', catalog, await loadChats(), { mailTab: tabRef.current === 'mail', assistantActive: Boolean(assistantThreadRef.current) })
    const plan = planVoice(decision, auto)
    if (plan.kind === 'review') {
      setDraft(text)
      if (plan.reason === 'ambiguous') {
        await runDecision(decision)
      } else if (plan.reason === 'unclear') {
        const why = 'text' in decision ? decision.text : 'I\u2019m not sure what to do with that.'
        pushEntry({ id: 0, kind: 'note', text: `${why} It\u2019s in the box below to edit and send.` })
      }
      return
    }
    if (plan.kind === 'confirm' && decision.type === 'close') {
      pushEntry({
        id: 0,
        kind: 'confirm',
        purpose: 'close',
        text: `Close ${decision.name}?`,
        appId: decision.appId,
        name: decision.name
      })
      return
    }
    await runDecision(decision)
  }
  voiceBridge.current = (text) => {
    void onVoice(text)
  }

  async function runDecision(decision: CommandResult): Promise<void> {
    if (
      decision.type === 'move' ||
      decision.type === 'corner' ||
      decision.type === 'home' ||
      decision.type === 'pose' ||
      (decision.type === 'follow' && decision.mode === 'stay')
    ) {
      if (decision.type === 'follow') {
        pendingCome.current = false
        void window.miko.setFollow(false)
      }
      commandBridge.current(decision)
      return
    }
    if (decision.type === 'follow') {
      if (decision.mode === 'follow') {
        const result = await window.miko.setFollow(true)
        pushEntry({
          id: 0,
          kind: 'note',
          text: result.ok ? 'I\u2019ll follow the active app.' : result.reason
        })
        return
      }
      const result = await window.miko.comeHere()
      if (!result.ok) {
        pushEntry({ id: 0, kind: 'note', text: result.reason })
        return
      }
      if (result.paused) pendingCome.current = true
      pushEntry({
        id: 0,
        kind: 'note',
        text: result.paused ? 'I\u2019ll come over once this is closed.' : 'Coming to the active window.'
      })
      return
    }
    if (decision.type === 'close-self') {
      pushEntry({
        id: 0,
        kind: 'confirm',
        purpose: 'quit',
        text: 'Quit MIKO?',
        appId: 'calculator',
        name: 'MIKO'
      })
      return
    }
    if (decision.type === 'force-close') {
      pushEntry({
        id: 0,
        kind: 'confirm',
        purpose: 'force',
        text: `Force quit ${decision.name}? Unsaved work can be lost.`,
        appId: decision.appId,
        name: decision.name
      })
      return
    }
    if (decision.type === 'close') {
      await runClose(decision.appId, decision.name, false)
      return
    }
    if (decision.type === 'question') {
      await startAssistant(decision.prompt)
      return
    }
    if (decision.type === 'ask-gpt') {
      pushEntry({
        id: 0,
        kind: 'handoff',
        prompt: decision.question,
        status: 'ready',
        detail: 'Ready for you to review. Nothing has been sent.',
        destination: ''
      })
      return
    }
    if (decision.type === 'type-in-gpt') {
      if (tabRef.current !== 'chat') await applyPanel(true, 'chat')
      const entry: Extract<PanelEntry, { kind: 'handoff' }> = {
        id: 0,
        kind: 'handoff',
        prompt: decision.text,
        status: 'ready',
        detail: 'Typing this into ChatGPT for you\u2026',
        destination: ''
      }
      const id = pushEntry(entry)
      await handToChatGpt({ ...entry, id })
      return
    }
    if (decision.type === 'bridge-test') {
      await startAssistant(BRIDGE_TEST_PROMPT)
      return
    }
    if (decision.type === 'bridge-new') {
      await window.miko.bridgeNew()
      setAssistantThread('')
      pushEntry({ id: 0, kind: 'note', text: 'New conversation. Your next question starts a fresh MIKO assistant thread.' })
      return
    }
    if (decision.type === 'mail') {
      // No mailbox connected in MIKO: use the mail connected to the owner's ChatGPT account (handoff).
      const status = await window.miko.mailStatus()
      if (!status?.accounts.length) {
        const prompt = mailRequestFor(decision.intent)
        if (!prompt) {
          pushEntry({ id: 0, kind: 'note', text: 'Your mail is in ChatGPT, not MIKO, so open that message there.' })
          return
        }
        if (tabRef.current !== 'chat') await applyPanel(true, 'chat')
        const entry: Extract<PanelEntry, { kind: 'handoff' }> = {
          id: 0,
          kind: 'handoff',
          variant: 'mail',
          prompt,
          status: 'ready',
          detail: 'Using the mail connected to your ChatGPT account.',
          destination: ''
        }
        const id = pushEntry(entry)
        await continueMail({ ...entry, id })
        return
      }
      showMailTab()
      const line = mailActions.applyIntent(decision.intent)
      if (tabRef.current !== 'mail') pushEntry({ id: 0, kind: 'note', text: line })
      return
    }
    if (decision.type === 'mail-or-app') {
      pushEntry({
        id: 0,
        kind: 'choices',
        purpose: 'mail-or-app',
        text: `Search mail for \u201c${decision.query}\u201d, or was that an app command?`,
        options: [
          { id: `mail:${decision.query}`, name: 'Search mail', familiar: true },
          { id: 'app', name: 'App command', familiar: true }
        ]
      })
      return
    }
    if (decision.type === 'check-mail') {
      pushEntry({
        id: 0,
        kind: 'handoff',
        variant: 'mail',
        prompt: decision.prompt,
        status: 'ready',
        detail: 'Check mail request. Nothing has been sent.',
        destination: ''
      })
      return
    }
    if (decision.type === 'open-chatgpt') {
      const result = await window.miko.openChatGpt()
      pushEntry({
        id: 0,
        kind: 'note',
        text: !result.ok
          ? 'I couldn\u2019t open ChatGPT.'
          : result.target === 'app'
            ? 'Opened the ChatGPT app.'
            : `The ChatGPT app isn\u2019t installed, so I opened chatgpt.com in ${result.appName || 'your browser'}.`
      })
      return
    }
    if (decision.type === 'open-chat') {
      await openSavedChat(decision.name)
      return
    }
    if (decision.type === 'list-chats') {
      showChats()
      return
    }
    if (decision.type === 'chat-choices') {
      pushEntry({
        id: 0,
        kind: 'choices',
        purpose: 'chat',
        text: decision.text,
        options: decision.options.map((chat) => ({ id: chat.name, name: chat.name, familiar: true }))
      })
      return
    }
    if (decision.type === 'unknown' || decision.type === 'missing') {
      pushEntry({ id: 0, kind: 'note', text: decision.text })
      return
    }
    if (decision.type === 'confirm') {
      pushEntry({
        id: 0,
        kind: 'confirm',
        purpose: 'launch',
        text: `I found ${decision.name}. Launch it?`,
        appId: decision.appId,
        name: decision.name
      })
      return
    }
    if (decision.type === 'choices') {
      pushEntry({
        id: 0,
        kind: 'choices',
        purpose: decision.purpose,
        text: decision.text,
        options: decision.options
      })
      return
    }
    pushEntry({ id: 0, kind: 'note', text: `Opening ${decision.name}.` })
    const result = await window.miko.launchApp({ id: decision.appId, confirm: true })
    if (!result.ok) pushEntry({ id: 0, kind: 'note', text: result.reason })
  }

  async function runClose(appId: string, name: string, force: boolean): Promise<void> {
    const id = pushEntry({ id: 0, kind: 'closing', appId, name, text: `Requested ${name} to close.` })
    const result = await window.miko.closeApp({ id: appId, force, confirm: true })
    if (result.status === 'requested') return
    const text =
      result.status === 'already-closed'
        ? `${result.name} is already closed.`
        : result.status === 'unsupported'
          ? `I can\u2019t close ${result.name}.`
          : result.status === 'needs-confirm'
            ? `Confirm before force quitting ${result.name}.`
            : `${result.name} did not close.`
    replaceEntry(id, { id, kind: 'closing', appId, name, text })
  }

  /**
   * Ask in ChatGPT: insert the exact prompt into ChatGPT's message box when Accessibility can
   * identify it (Append/Replace if it has text; success only after read-back), otherwise type
   * nothing, copy the prompt and say why. Saved-chat destinations open in the browser + copy.
   */
  async function handToChatGpt(entry: Extract<PanelEntry, { kind: 'handoff' }>, mode?: 'append' | 'replace'): Promise<void> {
    const destination = entry.destination ?? ''
    if (destination) {
      const copied = await window.miko.copyText(entry.prompt)
      const opened = await window.miko.openChat(destination)
      const place = opened.target === 'app' ? 'the ChatGPT app' : opened.appName || 'your browser'
      replaceEntry(entry.id, {
        ...entry,
        choose: false,
        status: copied && opened.ok ? 'copied' : entry.status,
        detail: opened.ok
          ? `Opened \u201c${destination}\u201d in ${place}. ${copied ? 'Question copied \u2014 paste it there.' : 'The question wasn\u2019t copied.'}`
          : `\u201c${destination}\u201d didn\u2019t open.`
      })
      return
    }
    replaceEntry(entry.id, { ...entry, choose: false, detail: 'Bringing ChatGPT forward\u2026' })
    const result = await window.miko.chatgptInsert(entry.prompt, mode)
    if (result.state === 'inserted') {
      replaceEntry(entry.id, { ...entry, choose: false, status: 'copied', detail: 'Inserted into ChatGPT\u2019s message box and checked. Review it and press Send.' })
      return
    }
    if (result.state === 'pasted') {
      replaceEntry(entry.id, {
        ...entry,
        choose: false,
        status: 'copied',
        pasteAgain: true,
        detail: 'Pasted into ChatGPT. MIKO can\u2019t read ChatGPT\u2019s box to double-check, so glance at it, then press Send. If it isn\u2019t there, use Paste again.'
      })
      return
    }
    if (result.state === 'has-text') {
      replaceEntry(entry.id, { ...entry, choose: true, detail: 'ChatGPT\u2019s message box already has text. Append to it or replace it?' })
      return
    }
    if (result.state === 'unavailable' && /expose/.test(result.reason)) {
      // ChatGPT hides its message box from macOS: your click identifies it, ⌃⌥V confirms. Pastes once.
      pasteEntryRef.current = entry.id
      const armedOk = await window.miko.pasteArm(entry.prompt, 'chatgpt')
      if (armedOk.ok) {
        replaceEntry(entry.id, {
          ...entry,
          choose: false,
          detail: 'ChatGPT doesn\u2019t show its message box to macOS, so MIKO can\u2019t find it alone. Click ChatGPT\u2019s message box, then press \u2303\u2325V.'
        })
        return
      }
    }
    const copied = await window.miko.copyText(entry.prompt)
    replaceEntry(entry.id, {
      ...entry,
      choose: false,
      status: copied ? 'copied-only' : entry.status,
      detail: `${result.reason} ${copied ? 'The prompt is copied: click ChatGPT\u2019s message box and press \u2318V.' : 'The prompt couldn\u2019t be copied either.'}`
    })
  }

  /** "Check mail" handoff: the read-only request goes to ChatGPT the same way. */
  async function continueMail(entry: Extract<PanelEntry, { kind: 'handoff' }>): Promise<void> {
    await handToChatGpt(entry)
  }

  async function onUseChatGpt(id: number): Promise<void> {
    const entry = entries.find((item) => item.id === id)
    if (!entry || entry.kind !== 'handoff' || typeof window.miko === 'undefined') return
    if (entry.variant === 'mail') {
      await continueMail(entry)
      return
    }
    await handToChatGpt(entry)
  }

  async function onPasteReply(id: number): Promise<void> {
    const entry = entries.find((item) => item.id === id)
    if (!entry || entry.kind !== 'handoff' || typeof window.miko === 'undefined') return
    const text = (await window.miko.readClipboard()).trim()
    if (!text) {
      replaceEntry(id, { ...entry, detail: 'The clipboard is empty.' })
      return
    }
    if (text === entry.prompt.trim()) {
      replaceEntry(id, { ...entry, detail: 'That is still the prompt. Copy the answer, then paste it here.' })
      return
    }
    replaceEntry(id, {
      ...entry,
      status: 'pasted',
      reply: text,
      detail: 'Pasted from the clipboard. It stays here as text.'
    })
  }

  async function onChoose(entryId: number, appId: string): Promise<void> {
    const entry = entries.find((item) => item.id === entryId)
    if (!entry || entry.kind !== 'choices' || typeof window.miko === 'undefined') return
    const option = entry.options.find((item) => item.id === appId)
    if (!option) return
    if (entry.purpose === 'close') {
      await runClose(appId, option.name, false)
      return
    }
    if (entry.purpose === 'free-text') {
      const text = entry.payload ?? ''
      replaceEntry(entryId, { id: entryId, kind: 'note', text: option.id === 'gpt' ? 'Sending it to ChatGPT.' : 'Asking MIKO.' })
      if (option.id === 'gpt') await runDecision({ type: 'type-in-gpt', text })
      else await startAssistant(text)
      return
    }
    if (entry.purpose === 'mail-or-app') {
      if (option.id.startsWith('mail:')) {
        replaceEntry(entryId, { id: entryId, kind: 'note', text: 'Searching mail.' })
        showMailTab()
        mailActions.applyIntent({ kind: 'search', query: option.id.slice(5) })
      } else {
        replaceEntry(entryId, { id: entryId, kind: 'note', text: 'For apps, say \u201copen\u201d or \u201cclose\u201d and the app name.' })
      }
      return
    }
    if (entry.purpose === 'chat') {
      replaceEntry(entryId, { id: entryId, kind: 'note', text: `Opening \u201c${option.name}\u201d.` })
      await openSavedChat(option.name)
      return
    }
    replaceEntry(entryId, { id: entryId, kind: 'note', text: `Opening ${option.name}.` })
    const result = await window.miko.launchApp({ id: appId, confirm: true })
    if (!result.ok) pushEntry({ id: 0, kind: 'note', text: result.reason })
  }

  async function onConfirm(id: number): Promise<void> {
    const entry = entries.find((item) => item.id === id)
    if (!entry || entry.kind !== 'confirm' || typeof window.miko === 'undefined') return
    if (entry.purpose === 'quit') {
      replaceEntry(id, { id, kind: 'note', text: 'Quitting.' })
      window.miko.quitApp()
      return
    }
    if (entry.purpose === 'close') {
      replaceEntry(id, { id, kind: 'note', text: `Closing ${entry.name}.` })
      await runClose(entry.appId, entry.name, false)
      return
    }
    if (entry.purpose === 'force') {
      replaceEntry(id, { id, kind: 'note', text: `Force quitting ${entry.name}.` })
      await runClose(entry.appId, entry.name, true)
      return
    }
    replaceEntry(id, { id, kind: 'note', text: `Opening ${entry.name}.` })
    const result = await window.miko.launchApp({ id: entry.appId, confirm: true })
    if (!result.ok) pushEntry({ id: 0, kind: 'note', text: result.reason })
  }

  if (bridgeMissing) {
    return (
      <div className="stage">
        <p className="bridge-error" data-hit="error">
          MIKO could not reach its preload bridge.
        </p>
      </div>
    )
  }

  const stageClass = panelOpen ? 'stage is-open panel-' + panelSide : 'stage'
  const petClass = [
    'pet-hit',
    'walk-hit',
    gestures.armed ? 'is-armed' : '',
    gestures.dragging || gestures.guiding ? 'is-dragging' : ''
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div className={stageClass}>
      {panelOpen ? (
        <TextPanel
          draft={draft}
          entries={entries}
          onDraft={setDraft}
          onSubmit={() => {
            void onSubmit()
          }}
          tab={tab}
          onTab={(next) => {
            if (next !== tabRef.current) void applyPanel(true, next)
          }}
          mail={
            <MailView
              state={mail}
              actions={mailActions}
              onCommand={(text) => {
                void (async () => {
                  const catalog = await loadCatalog()
                  if (!catalog) return
                  await runDecision(routeCommand(text, 'typed', catalog, await loadChats(), { mailTab: true }))
                })()
              }}
              onAskChatGpt={() => {
                void applyPanel(true, 'chat').then(() =>
                  pushEntry({ id: 0, kind: 'handoff', variant: 'mail', prompt: MAIL_REQUEST, status: 'ready', detail: 'Check mail request. Nothing has been sent.', destination: '' })
                )
              }}
            />
          }
          view={panelView}
          onView={(next) => (next === 'chats' ? showChats() : setPanelView(next))}
          chats={chats}
          onDestination={(entryId, name) => {
            const entry = entries.find((item) => item.id === entryId)
            if (entry?.kind === 'handoff') replaceEntry(entryId, { ...entry, destination: name })
          }}
          chatTools={{
            message: chatsMessage,
            onAdd: async (name, url) => {
              const result = await window.miko.addChat(name, url)
              setChats(result.list)
              setChatsMessage(result.ok ? `Saved \u201c${name.trim()}\u201d.` : result.reason)
              return result.ok
            },
            onRename: async (from, to) => {
              const result = await window.miko.renameChat(from, to)
              setChats(result.list)
              setChatsMessage(result.ok ? `Renamed to \u201c${to.trim()}\u201d.` : result.reason)
              return result.ok
            },
            onRemove: (name) => {
              void window.miko.removeChat(name).then((result) => {
                setChats(result.list)
                setChatsMessage(result.ok ? `Removed \u201c${name}\u201d.` : result.reason)
              })
            },
            onOpen: (name) => {
              void window.miko.openChat(name).then((result) => setChatsMessage(openedLine(result, `\u201c${name}\u201d`)))
            }
          }}
          onBridgeCancel={(requestId) => window.miko.bridgeCancel(requestId)}
          onSelectionAction={(id, action, instruction) => void runSelectionAction(id, action, instruction)}
          onUseClipboard={() => {
            void window.miko.selectionClipboard().then((ev) => pushEntry({ id: 0, kind: 'selection', ...ev }))
          }}
          onResultCopy={(id) => {
            const e = resultOf(id)
            if (!e) return
            void window.miko.copyText(e.reply).then((ok) => replaceEntry(id, { ...e, after: ok ? 'Copied.' : 'Couldn\u2019t copy.' }))
          }}
          onResultReplace={(id) => {
            const e = resultOf(id)
            if (!e?.selection) return
            replaceEntry(id, { ...e, after: `Replacing the selection in ${e.selection.app}\u2026` })
            void window.miko.selectionReplace(e.selection.captureId, e.reply).then((r) =>
              replaceEntry(id, {
                ...e,
                after: r.ok
                  ? `Replaced the selection in ${e.selection?.app}${r.verified ? ' and checked it' : ' (couldn\u2019t read it back to check)'}.`
                  : `${r.reason} Use Copy or Paste where I click instead.`
              })
            )
          }}
          onResultPaste={(id) => {
            const e = resultOf(id)
            if (!e) return
            pasteEntryRef.current = id
            void window.miko.pasteArm(e.reply).then((r) => {
              if (!r.ok) setPasteBanner({ entryId: id, text: r.reason, armed: false })
            })
          }}
          onResultAnswer={(id, answer) => {
            const e = entriesRef.current.find((item) => item.id === id)
            if (e?.kind !== 'bridge' || !e.selection) return
            const sel = entriesRef.current.find((item) => item.kind === 'selection' && item.captureId === e.selection?.captureId)
            if (sel?.kind !== 'selection') return
            void runSelectionAction(sel.id, e.selection.action, `${e.selection.instruction} (My answer to "${e.question ?? ''}": ${answer.trim()})`)
          }}
          pasteBanner={pasteBanner}
          onPasteCancel={() => window.miko.pasteCancel()}
          onPasteAgain={(id) => {
            const entry = entries.find((item) => item.id === id)
            if (entry?.kind !== 'handoff') return
            pasteEntryRef.current = id
            void window.miko.pasteArm(entry.prompt, 'chatgpt').then((r) =>
              replaceEntry(id, {
                ...entry,
                pasteAgain: false,
                detail: r.ok ? 'Click ChatGPT\u2019s message box, then press \u2303\u2325V.' : r.reason
              })
            )
          }}
          onInsertChoice={(id, mode) => {
            const entry = entries.find((item) => item.id === id)
            if (entry?.kind !== 'handoff') return
            if (!mode) replaceEntry(id, { ...entry, choose: false, detail: 'Cancelled. Nothing was changed in ChatGPT.' })
            else void handToChatGpt(entry, mode)
          }}
          assistantThread={assistantThread}
          onBridgeNew={() => {
            void window.miko.bridgeNew().then(() => {
              setAssistantThread('')
              pushEntry({ id: 0, kind: 'note', text: 'New conversation. Your next question starts a fresh MIKO assistant thread.' })
            })
          }}
          onAskInChatGpt={(prompt) =>
            pushEntry({ id: 0, kind: 'handoff', prompt, status: 'ready', detail: 'For your ChatGPT chats and memory. Nothing has been sent.', destination: '' })
          }
          prefs={{
            text: prefs,
            message: prefsMessage,
            shortcut: selectionKey,
            onSaveShortcut: async (value) => {
              const r = await window.miko.selectionShortcutSet(value)
              setSelectionKey(r.shortcut)
              setPrefsMessage(r.ok ? `Selection shortcut: ${r.shortcut}` : r.reason)
            },
            onSave: async (text) => {
              const ok = await window.miko.prefsSet(text)
              if (ok) setPrefs(text.slice(0, 2000))
              setPrefsMessage(ok ? 'Saved. New MIKO assistant conversations will use these.' : 'Couldn\u2019t save.')
            }
          }}
          onUseChatGpt={(id) => {
            void onUseChatGpt(id)
          }}
          onPasteReply={(id) => {
            void onPasteReply(id)
          }}
          onChoose={(id, appId) => {
            void onChoose(id, appId)
          }}
          onConfirm={(id) => {
            void onConfirm(id)
          }}
          onDismiss={(id) => replaceEntry(id, { id, kind: 'note', text: 'Left it closed.' })}
          listening={listening}
          listenDetail={listenDetail}
          onListen={() => {
            void window.miko.listenStart().then((result) => {
              if (!result.ok) {
                pushEntry({ id: 0, kind: 'note', text: result.reason })
                setListening(false)
                return
              }
              setListenDetail(result.reason)
              setListening(true)
            })
          }}
          onListenStop={() => window.miko.listenStop()}
          onListenCancel={() => {
            window.miko.listenCancel()
            setListening(false)
          }}
          canSpeak={canSpeak}
          onSpeak={(text) => {
            const synth = window.speechSynthesis
            if (!synth) return
            synth.cancel()
            const utterance = new SpeechSynthesisUtterance(text.slice(0, 800))
            const voice =
              synth.getVoices().find((item) => item.localService && item.lang.toLowerCase().startsWith('en')) ??
              synth.getVoices().find((item) => item.localService)
            if (voice) utterance.voice = voice
            synth.speak(utterance)
          }}
          onClose={() => {
            void applyPanel(false)
          }}
        />
      ) : null}
      <div className="pet-slot is-motion">
        <canvas ref={canvasRef} className="motion-canvas" />
        <button
          type="button"
          className={petClass}
          data-hit="pet"
          aria-label="MIKO. Double-click to talk. Drag to walk. Hold Alt or Option and drag to move."
          style={{ left: hit.x, top: hit.y, width: hit.width, height: hit.height }}
          onPointerDown={gestures.onPointerDown}
          onPointerMove={gestures.onPointerMove}
          onPointerUp={gestures.onPointerUp}
          onPointerCancel={gestures.onPointerCancel}
          onClick={gestures.onClick}
          onDoubleClick={gestures.onDoubleClick}
          onContextMenu={(event) => event.preventDefault()}
        />
      </div>
    </div>
  )
}
