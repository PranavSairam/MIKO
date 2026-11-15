import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { HitRect, OpenResult, PanelLayout, PlacementEvent, PointerSample, PresenceEvent, SavedChat, PetListing } from '../../../shared/api'
import {
  movementLine,
  planVoice,
  poseLine,
  routeCommand,
  routeDiagnostics,
  type CatalogApp,
  type CommandResult
} from '../../../shared/commands'
import {
  IDLE_ORDER,
  walkYaw,
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
import { ChromeProfileFan } from '../components/ChromeProfileFan'
import {
  matchChromeProfiles,
  parseChromeUsePhrase,
  type ChromeProfileView
} from '../../../shared/chrome-profiles'
import { usePetGestures, type GuidePhase } from '../hooks/usePetGestures'
import { PetRig, dobermanBytes, type PetSource } from './PetRig'
import { petThumbnail } from './petThumbnail'
import { PETS, petNoun, pickFlavor, planFlight, flightPoint, type FlightPlan, type PetId, type PetRole } from '../../../shared/pets'
import { MailView } from '../mail/MailView'
import { useMail } from '../mail/useMail'
import { MAIL_REQUEST, mailRequestFor } from '../../../shared/commands'
import { parseMailCommand } from '../../../shared/mail'
import { BRIDGE_TEST_PROMPT } from '../../../shared/bridge'
import { SELECTION_LABELS, clarifyingQuestion, parseSelectionCommand, selectionPrompt, type SelectionAction } from '../../../shared/selection'
import { MAIL_PANEL, PANEL, PET_WINDOW, type PanelSize } from '../../../shared/layout'
import { parseChooserIndex, sameContact, type WhatsAppMatch, type WhatsAppOpenResult } from '../../../shared/whatsapp'
import {
  applyTimeClarification,
  detectAmbiguousTimes,
  formatVisibleContext,
  parseDraft,
  recipientMatchesOpenChat,
  resolveAdditiveFollowUpMode,
  stripFormalTone,
  whatsAppDraftPrompt,
  whatsAppSummarizePrompt,
  type WhatsAppReplyIntent,
  type WhatsAppSummarizeIntent
} from '../../../shared/whatsapp-reply'
import { emptyContext, isFresh, messagesFingerprint, type WorkingContext } from '../../../shared/context'
import { cancelTask, createTask, type TaskRecord } from '../../../shared/task'
import {
  interpretPrompt,
  parseInterpretResult,
  shouldTryInterpreter,
  tryDeterministicPlan
} from '../../../shared/interpret'
import type { ActionPlan } from '../../../shared/actions'
import type { CorrectionExample, MikoStructuredPreferences } from '../../../shared/preferences'
import { DEFAULT_PREFERENCES } from '../../../shared/preferences'
import { newActionId, toneFromText } from '../../../shared/actions'
import { availableKinds, capability } from '../../../shared/capabilities'
import {
  filterAttachments,
  pickLatest,
  type ParsedAttachmentBubble,
  type WhatsAppAttachmentIntent
} from '../../../shared/whatsapp-attachments'

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
  const [structuredPrefs, setStructuredPrefs] = useState<MikoStructuredPreferences>(DEFAULT_PREFERENCES)
  const [prefAliases, setPrefAliases] = useState<{ alias: string; name: string }[]>([])
  const [prefExamples, setPrefExamples] = useState<CorrectionExample[]>([])
  const [listening, setListening] = useState(false)
  const [listenDetail, setListenDetail] = useState('')
  const [canSpeak, setCanSpeak] = useState(false)
  const [panelView, setPanelView] = useState<'log' | 'chats' | 'prefs'>('log')
  // Pet chooser (Preferences → Choose your pet, the paw menu, and "switch to the cat").
  const [petListing, setPetListing] = useState<PetListing | null>(null)
  const [petBusy, setPetBusy] = useState<PetId | null>(null)
  const [petMessage, setPetMessage] = useState('')
  const [petThumbs, setPetThumbs] = useState<Partial<Record<PetId, string>>>({})
  const [petFocus, setPetFocus] = useState(0)
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
  /** Switch the pet in place (resolves false and keeps the current pet when loading fails). */
  const petBridge = useRef<(id: PetId) => Promise<{ ok: boolean; reason: string }>>(async () => ({ ok: false, reason: 'MIKO isn’t ready yet.' }))
  const voiceBridge = useRef<(text: string) => void>(() => undefined)
  const handledSession = useRef(0)
  const voiceAutoRef = useRef(true)
  const messagingRef = useRef<'whatsapp' | null>(null)
  /** Last verified WhatsApp chat header (survives MIKO focus; cleared on chat/app switch). */
  const waChatRef = useRef<string | null>(null)
  /** Website left unfinished so “in Chrome” can complete it. */
  const pendingUrlRef = useRef<{ url: string; name: string } | null>(null)
  /** Active Chrome profile fan (token guards stale clicks / superseded requests). */
  const chromeChooserToken = useRef(0)
  const [chromeChooser, setChromeChooser] = useState<{
    token: number
    profiles: ChromeProfileView[]
    pendingUrl: { url: string; name: string } | null
    forceChooser: boolean
  } | null>(null)
  const chromeChooserRef = useRef(chromeChooser)
  chromeChooserRef.current = chromeChooser
  const [reducedMotion, setReducedMotionState] = useState(false)
  /** Held “type …” from open+type until the chat is verified. */
  const pendingWaDraftRef = useRef<string | null>(null)
  const lastWebsiteRef = useRef<{ url: string; name: string; browser: string | null; openedAt: number } | null>(null)
  const workingContextRef = useRef<WorkingContext>(emptyContext())
  const activeTaskRef = useRef<TaskRecord | null>(null)
  /** One-off bridge waits (AI interpret). Cancelled tasks never resolve into actions. */
  const interpretWaiters = useRef(
    new Map<string, { resolve: (reply: string | null) => void; token: number; taskId: string }>()
  )
  const interpretToken = useRef(0)
  const whatsAppToken = useRef(0)
  const waReplyToken = useRef(0)
  const attachmentToken = useRef(0)
  const waOverwriteOk = useRef(new Set<number>())
  const waDraftDone = useRef<(entryId: number, reply: string) => void>(() => undefined)
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
    applyPanelSize(layout, open ? mode : 'chat')
    setPanelOpen(layout.panelOpen)
    setTab(open ? mode : 'chat')
    if (!open) {
      setPanelView('log')
      whatsAppToken.current += 1
      window.miko.whatsappCancel()
      window.miko.pasteCancel()
      window.miko.listenCancel()
      setListening(false)
      if (pendingCome.current) {
        pendingCome.current = false
        void window.miko.comeHere()
      }
    }
  }

  function applyPanelSize(layout: PanelLayout, mode: 'chat' | 'mail'): void {
    const size = { width: layout.panelWidth || PANEL.width, height: layout.panelHeight || PANEL.height, gap: mode === 'mail' ? MAIL_PANEL.gap : PANEL.gap }
    panelSizeRef.current = layout.panelOpen ? size : PANEL
    const page = document.documentElement
    page.style.setProperty('--panel-width', `${size.width}px`)
    page.style.setProperty('--panel-height', `${size.height}px`)
    page.style.setProperty('--panel-gap', `${size.gap}px`)
    setPanelSide(layout.panelSide)
  }

  async function presetPanel(preset: 'small' | 'medium' | 'large' | 'reset'): Promise<void> {
    if (!panelRef.current) return
    const layout = await window.miko.panelPreset(preset)
    applyPanelSize(layout, tabRef.current)
  }

  /**
   * Drag the panel's outer corner. Width follows the pointer; the panel stays centred on the
   * dog vertically, so height grows by twice the vertical move. Saved for this tab on release.
   */
  function startPanelResize(event: React.PointerEvent<HTMLElement>): void {
    if (event.button !== 0 || !panelRef.current) return
    event.preventDefault()
    const grip = event.currentTarget
    try {
      grip.setPointerCapture(event.pointerId)
    } catch {
      // Not an active pointer (synthetic event): moves still arrive on the grip.
    }
    window.miko.setPointerHeld(true)
    const start = { x: event.screenX, y: event.screenY, width: panelSizeRef.current.width, height: panelSizeRef.current.height }
    const side = panelSideRef.current
    const mode = tabRef.current
    let wanted = { width: start.width, height: start.height }
    let sending = false
    let queued = false
    const flush = async (done: boolean): Promise<void> => {
      if (sending && !done) {
        queued = true
        return
      }
      sending = true
      const layout = await window.miko.panelResize(wanted.width, wanted.height, done)
      sending = false
      applyPanelSize(layout, mode)
      if (queued && !done) {
        queued = false
        void flush(false)
      }
    }
    const move = (e: PointerEvent): void => {
      const dx = e.screenX - start.x
      const dy = e.screenY - start.y
      wanted = { width: start.width + (side === 'right' ? dx : -dx), height: start.height + 2 * dy }
      void flush(false)
    }
    const end = (): void => {
      grip.removeEventListener('pointermove', move)
      grip.removeEventListener('pointerup', end)
      grip.removeEventListener('pointercancel', end)
      window.miko.setPointerHeld(false)
      const finish = (): void => {
        if (sending) window.setTimeout(finish, 30)
        else void flush(true)
      }
      finish()
    }
    grip.addEventListener('pointermove', move)
    grip.addEventListener('pointerup', end)
    grip.addEventListener('pointercancel', end)
  }

  async function refreshPets(): Promise<PetListing | null> {
    const listing = await window.miko.petList().catch(() => null)
    if (listing) setPetListing(listing)
    return listing
  }

  /** Switch the pet in place; panel drafts, entries and pending tasks are untouched. */
  async function switchPet(id: PetId, announce: boolean): Promise<void> {
    const name = petNoun(id)
    setPetBusy(id)
    setPetMessage(`Loading the ${name}…`)
    const result = await petBridge.current(id)
    setPetBusy(null)
    const line = result.ok ? result.reason || `Here’s your ${name}.` : result.reason
    setPetMessage(line)
    if (result.ok) setPetListing((listing) => (listing ? { ...listing, selected: id } : listing))
    if (announce) pushEntry({ id: 0, kind: 'note', text: line })
  }

  /** Preferences → Choose your pet (opens the chat panel if needed; a mail draft stays in the Mail tab). */
  async function openPetChooser(): Promise<void> {
    if (!panelRef.current || tabRef.current !== 'chat') await applyPanel(true, 'chat')
    await refreshPets()
    setPanelView('prefs')
    setPetFocus((n) => n + 1)
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

    /** The saved pet, falling back to the bundled Doberman when its asset is missing or broken. */
    const initialPet = async (): Promise<PetSource> => {
      const listing = await window.miko.petList().catch(() => null)
      const id = listing?.selected ?? 'doberman'
      if (id !== 'doberman') {
        const bytes = await window.miko.petModel(id)
        if (bytes) return { spec: PETS[id], bytes }
      }
      return { spec: PETS.doberman, bytes: await dobermanBytes() }
    }
    const rig = new PetRig(canvas, initialPet())
    /** Controller phase to this pet's clip. */
    const roleOf = (phase: Actor['phase']): PetRole =>
      phase === 'walk' ? 'walk' : phase === 'sit' ? 'sit' : phase === 'sitIdle' ? 'sitIdle' : phase === 'standUp' ? 'standUp' : 'idle'
    // Extra clips (cat licks its paw, koala waves or naps, bird chirps): played over idle / seated phases.
    let flavor: { clip: string; token: number } | null = null
    let flavorWait = 6 + Math.random() * 6
    let flavorSerial = 0
    // Bird flight: take off, fly an arc, land on the tree's perch or back on the ground.
    let flight: { stage: 'takeoff' | 'fly' | 'land'; plan: FlightPlan; t: number; sent: { x: number; y: number }; to: 'perch' | 'ground'; token: number } | null = null
    let perched = false
    let perchWait = 0
    let flightWait = 18 + Math.random() * 20
    let flightPending = false
    let flightSerial = 0
    /** The current sit order came from Follow active app (resting at a window), not from a command. */
    let followSit = false
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
        order,
        oneShotSeconds: rig.oneShotSeconds()
      }
    }

    const freezeClip = (): boolean => media.matches || draggingRef.current || mode !== 'live'

    const sync = (): void => {
      if (!actor) return
      flavor = null
      rig.setYaw(actor.yaw)
      rig.setPaused(freezeClip())
      rig.play(rig.roleClip(roleOf(actor.phase)), isOneShot(actor.phase), actor.token)
    }

    /** Now and then, an extra clip over the current idle or seated phase. */
    const stepFlavor = (dt: number, phase: 'idle' | 'sitIdle'): void => {
      if (flavor || draggingRef.current) return
      flavorWait -= dt
      if (flavorWait > 0) return
      flavorWait = 8 + rng() * 10
      const chosen = pickFlavor(rig.flavors(), phase, rng)
      if (!chosen) return
      flavorSerial += 1
      flavor = { clip: chosen.clip, token: -flavorSerial }
      rig.playLoops(chosen.clip, chosen.loops, flavor.token)
    }

    /** Bird: plan a flight to the perch, or from the perch back to the ground. */
    const beginFlight = (to: 'perch' | 'ground'): void => {
      if (flightPending || flight) return
      flightPending = true
      void window.miko.petFlight().then((info) => {
        flightPending = false
        if (!info || flight || mode !== 'live' || draggingRef.current || !rig.current()?.flies) {
          console.info(`[miko] flight to ${to} skipped (info ${info ? 'ok' : 'none'}, mode ${mode})`)
          return
        }
        console.info(`[miko] bird flies to ${to === 'perch' && info.perch ? 'its perch' : 'the ground'}`)
        let target: { x: number; y: number }
        let lands: 'perch' | 'ground' = 'ground'
        if (to === 'perch' && info.perch) {
          target = info.perch
          lands = 'perch'
        } else {
          // Somewhere in the usual roam range, on the ground.
          const roam = roamFor(sessionHome(), placed.span)
          let spot = roam.min + rng() * Math.max(0, roam.max - roam.min)
          // Land a little way off, not straight below: a short hop doesn't read as a flight.
          if (Math.abs(spot - placed.x) < 120) spot = placed.x > (roam.min + roam.max) / 2 ? Math.max(0, placed.x - 160 - rng() * 120) : Math.min(placed.span, placed.x + 160 + rng() * 120)
          target = { x: info.origin.x + (spot - placed.x), y: info.groundY }
        }
        flightSerial += 1
        const plan = planFlight(info.origin, target)
        flight = { stage: 'takeoff', plan, t: 0, sent: { ...info.origin }, to: lands, token: 1000 + flightSerial }
        flavor = null
        const dir = target.x >= info.origin.x ? 1 : -1
        if (actor) actor = { ...actor, yaw: walkYaw(dir), yawFrom: walkYaw(dir), yawTarget: walkYaw(dir), facing: dir }
        rig.setYaw(walkYaw(dir))
        if (rig.hasClip('TakeOff')) rig.play('TakeOff', true, flight.token)
        else {
          flight = { ...flight, stage: 'fly' }
          rig.play('Fly', false, flight.token)
        }
      })
    }

    /** Stop any flight; a bird left in the air drops straight to the ground (pet switch, hide). */
    const groundBird = (drop: boolean): void => {
      const wasUp = perched || flight !== null
      flight = null
      perched = false
      flightPending = false
      if (!drop || !wasUp) return
      void window.miko.petFlight().then((info) => {
        if (info && Math.abs(info.groundY - info.origin.y) > 1) window.miko.shiftBy({ dx: 0, dy: info.groundY - info.origin.y, reduced: true })
      })
    }

    /** Advance a flight; returns true while the bird is in the air or perched (the walking controller waits). */
    const stepFlight = (dt: number): boolean => {
      if (!rig.current()?.flies) {
        if (flight || perched) groundBird(false)
        return false
      }
      if (draggingRef.current && (flight || perched)) {
        // Picked up mid-air: it lands wherever it is let go.
        flight = null
        perched = false
        return false
      }
      if (flight) {
        if (flight.stage === 'fly') {
          flight.t = Math.min(1, flight.t + dt / flight.plan.seconds)
          const point = flightPoint(flight.plan, flight.t)
          const dx = point.x - flight.sent.x
          const dy = point.y - flight.sent.y
          if (Math.abs(dx) >= 0.5 || Math.abs(dy) >= 0.5) {
            window.miko.shiftBy({ dx, dy, reduced: false })
            flight.sent = point
          }
          if (flight.t >= 1) {
            flight.stage = 'land'
            if (rig.hasClip('Land')) rig.play('Land', true, flight.token + 0.5)
            else finishFlight()
          }
        }
        return true
      }
      if (perched) {
        // Orders (move, come back, sit, follow) bring it down first.
        // A follow-mode sit is resting, not a command, so it doesn't call the bird down.
        const wanted = (order.kind !== 'auto' && !(order.kind === 'sit' && followSit)) || followGoal.current !== null
        perchWait -= dt
        if (!panelRef.current && (wanted || perchWait <= 0)) beginFlight('ground')
        else stepFlavor(dt, 'sitIdle')
        return true
      }
      const resting = actor && (actor.phase === 'idle' || actor.phase === 'sitIdle')
      const restingOrder = order.kind === 'auto' || (order.kind === 'sit' && followSit)
      const free = !panelRef.current && !guidingRef.current && !guideTracking && restingOrder && !followGoal.current && !media.matches
      if (resting && free) {
        flightWait -= dt
        if (flightWait <= 0) {
          flightWait = 25 + rng() * 35
          beginFlight('perch')
        }
      }
      return flightPending
    }

    const finishFlight = (): void => {
      if (!flight) return
      const landed = flight.to
      flight = null
      if (landed === 'perch') {
        perched = true
        perchWait = 15 + rng() * 25
        flavorWait = 2 + rng() * 4
        if (actor) actor = { ...actor, yaw: rig.viewerYaw(), yawFrom: rig.viewerYaw(), yawTarget: rig.viewerYaw() }
        rig.setYaw(rig.viewerYaw())
        rig.play(rig.roleClip('idle'), false, 2000 + flightSerial)
        return
      }
      perched = false
      if (actor) {
        actor = replanAfterDrag(actor, placed.x, placed.span, rig.cyclePx(), rig.viewerYaw(), rng, roamFor(sessionHome(), placed.span))
        sync()
      }
    }

    const resetOrder = (): void => {
      order = { ...IDLE_ORDER, token: order.token }
      guideTracking = false
      guideTarget = null
    }

    const publish = (next: Omit<BehaviorOrder, 'token'>, tracking: boolean): void => {
      followSit = false
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

    petBridge.current = async (id) => {
      const spec = PETS[id]
      await rig.ready.catch(() => undefined)
      const current = rig.current()
      if (current?.id === id) return { ok: true, reason: `The ${petNoun(id)} is already here.` }
      const keep = current ? `the ${petNoun(current.id)}` : 'the current pet'
      let bytes: ArrayBuffer | null = null
      try {
        bytes = id === 'doberman' ? await dobermanBytes() : await window.miko.petModel(id)
      } catch {
        bytes = null
      }
      if (!bytes) return { ok: false, reason: `The ${petNoun(id)}’s files aren’t there, so ${keep} stays.` }
      const wasUp = perched || flight !== null
      try {
        // Parsed off-screen first: the current pet stays on screen until this succeeds.
        await rig.switchTo({ spec, bytes })
      } catch (error) {
        console.error('[miko] pet switch failed', error)
        return { ok: false, reason: `The ${petNoun(id)} didn’t load, so ${keep} stays.` }
      }
      if (wasUp) groundBird(true)
      flavor = null
      flavorWait = 6 + rng() * 6
      flightWait = 12 + rng() * 15
      window.miko.petActive(id, rig.unitPx())
      void window.miko.petSave(id)
      if (actor) sync()
      return { ok: true, reason: '' }
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
          followSit = true
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
        if (stepFlight(dt)) {
          wasDragging = draggingRef.current
        } else {
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
        if (actor.phase === 'idle' || actor.phase === 'sitIdle') stepFlavor(dt, actor.phase)
        }
      } else if (actor) {
        wasDragging = draggingRef.current
        rig.setPaused(true)
      }
      rig.setPaused(freezeClip())
      rig.advance(freezeClip() ? 0 : dt)
      const head = rig.headViewport()
      const tracking = mode === 'live' && !media.matches && !draggingRef.current
      const blendingOut = !tracking || !actor || flight !== null || (!perched && (actor.phase === 'sit' || actor.phase === 'standUp'))
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
      if (flight && (token === flight.token || token === flight.token + 0.5)) {
        if (flight.stage === 'takeoff') {
          flight.stage = 'fly'
          rig.play('Fly', false, flight.token)
        } else if (flight.stage === 'land') finishFlight()
        return
      }
      if (flavor && token === flavor.token) {
        flavor = null
        if (perched) rig.play(rig.roleClip('idle'), false, 3000 + flavorSerial)
        else if (actor && mode === 'live') {
          rig.play(rig.roleClip(roleOf(actor.phase)), isOneShot(actor.phase), actor.token)
        }
        return
      }
      if (!actor || (name !== rig.roleClip('sit') && name !== rig.roleClip('standUp'))) return
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
        groundBird(false)
        flavor = null
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
      setReducedMotionState(media.matches)
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
        const loaded = rig.current()
        if (loaded) window.miko.petActive(loaded.id, rig.unitPx())
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

  // Chooser portraits, rendered from each pet's own asset the first time Preferences opens.
  useEffect(() => {
    if (panelView !== 'prefs' || !petListing) return
    let cancelled = false
    void (async () => {
      for (const pet of petListing.available) {
        if (cancelled || petThumbs[pet.id]) continue
        try {
          const bytes = pet.id === 'doberman' ? await dobermanBytes() : await window.miko.petModel(pet.id)
          if (!bytes || cancelled) continue
          const url = await petThumbnail(PETS[pet.id], bytes)
          if (!cancelled) setPetThumbs((all) => ({ ...all, [pet.id]: url }))
        } catch (error) {
          console.warn(`[miko] no portrait for ${pet.id}`, error)
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [panelView, petListing])

  // Paw menu → Pet.
  useEffect(() => {
    if (typeof window.miko === 'undefined') return
    void refreshPets()
    return window.miko.onPetCommand((command) => {
      if (command.kind === 'switch') void switchPet(command.pet, true)
      else void openPetChooser()
    })
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      if (chromeChooserRef.current) {
        event.preventDefault()
        dismissChromeChooser()
        pendingUrlRef.current = null
        pushEntry({ id: 0, kind: 'note', text: 'Okay. Cancelled — Chrome wasn’t opened.' })
        return
      }
      if (!panelOpen) return
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
  }, [panelOpen, panelSide, hit, chromeChooser])

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
    void window.miko.prefsStructuredGet().then((p) => {
      if (p) setStructuredPrefs(p)
    })
    void window.miko.whatsappAliases().then(setPrefAliases)
    void window.miko.examplesList().then(setPrefExamples)
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
      const waiter = interpretWaiters.current.get(u.requestId)
      if (waiter) {
        if (u.phase === 'running') return
        interpretWaiters.current.delete(u.requestId)
        const live =
          activeTaskRef.current?.id === waiter.taskId &&
          activeTaskRef.current.phase !== 'cancelled' &&
          waiter.token === interpretToken.current
        waiter.resolve(live && u.phase === 'done' ? u.reply ?? '' : null)
        return
      }
      const wa = entriesRef.current.find((e) => e.kind === 'wa-reply' && e.requestId === u.requestId)
      if (wa?.kind === 'wa-reply') {
        if (u.phase === 'running') return
        if (u.phase === 'done') {
          waDraftDone.current(wa.id, u.reply ?? '')
          return
        }
        setEntries((items) =>
          items.map((item) =>
            item.kind === 'wa-reply' && item.id === wa.id
              ? { ...item, status: 'failed', error: u.reason || 'Drafting stopped.', requestId: '' }
              : item
          )
        )
        return
      }
      const secs = u.seconds !== undefined ? ` in ${u.seconds} s` : ''
      if (u.phase === 'running') updateBridge(u.requestId, { status: 'running' })
      else if (u.phase === 'done') {
        const entry = entriesRef.current.find((e) => e.kind === 'bridge' && e.requestId === u.requestId)
        const oneOff =
          (entry?.kind === 'bridge' && entry.selection && entry.selection.action !== 'ask') ||
          (entry?.kind === 'bridge' && entry.kept === false && entry.requestId.startsWith('sum-'))
        // Requests without a card here (mail reply drafts) are one-offs that never become the conversation.
        if (u.thread && entry && !oneOff) setAssistantThread(u.thread)
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
          text:
            'MIKO Keys needs Accessibility and Input Monitoring for Caps Lock + A and Tab + Q (System Settings \u2192 Privacy & Security). ' +
            'If \u201cmiko-keys\u201d is already switched on there but this keeps coming back, that switch belongs to an older build: select miko-keys, click \u2212 to remove it, then quit and reopen MIKO and allow it again.'
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

  function commandContext(): {
    mailTab: boolean
    assistantActive: boolean
    messaging: 'whatsapp' | null
    waDraftActive: boolean
    pendingUrl: { url: string; name: string } | null
    waChat: string | null
    hasSelection: boolean
    lastWebsite: { url: string; name: string; browser?: string | null } | null
    hasRetrievedFile: boolean
  } {
    const waDraftActive = entriesRef.current.some(
      (e) =>
        e.kind === 'wa-reply' &&
        e.status !== 'failed' &&
        (e.draft ||
          e.status === 'drafting' ||
          e.status === 'review' ||
          e.status === 'ready' ||
          e.status === 'inserted' ||
          e.status === 'clarify-time' ||
          e.status === 'question' ||
          e.status === 'choose-insert')
    )
    const sel = workingContextRef.current.selection
    const retrieved = workingContextRef.current.retrievedFile
    return {
      mailTab: tabRef.current === 'mail',
      assistantActive: Boolean(assistantThreadRef.current),
      messaging: messagingRef.current,
      waDraftActive,
      pendingUrl: pendingUrlRef.current,
      waChat: waChatRef.current,
      hasSelection: Boolean(sel && isFresh(sel.capturedAt, Date.now(), 10 * 60 * 1000)),
      lastWebsite: lastWebsiteRef.current,
      hasRetrievedFile: Boolean(retrieved?.path && isFresh(retrieved.retrievedAt, Date.now(), 60 * 60 * 1000))
    }
  }

  function setWhatsAppTarget(header: string | null): void {
    if (header) {
      messagingRef.current = 'whatsapp'
      waChatRef.current = header
      return
    }
    messagingRef.current = null
    waChatRef.current = null
  }

  /** Last non-MIKO front app bundle — used to detect a real switch away from WhatsApp. */
  const lastExternalBundleRef = useRef<string | null>(null)

  /**
   * Keep explicit WhatsApp messaging context while MIKO (or an IDE driving MIKO) is focused.
   * Invalidate only after the external front app was WhatsApp and then becomes something else.
   */
  async function revalidateMessagingContext(): Promise<void> {
    if (messagingRef.current !== 'whatsapp' && !waChatRef.current) return
    try {
      const ext = await window.miko.lastExternalApp()
      if (!ext?.bundleId) return
      const isWa =
        /whatsapp/i.test(ext.bundleId) ||
        /whatsapp/i.test(ext.name || '') ||
        ext.bundleId === 'net.whatsapp.WhatsApp'
      const prev = lastExternalBundleRef.current
      lastExternalBundleRef.current = ext.bundleId
      if (isWa) {
        messagingRef.current = 'whatsapp'
        return
      }
      // Only clear after a real WhatsApp → other-app switch, not when Cursor/etc. was never WA.
      if (prev && (/whatsapp/i.test(prev) || prev === 'net.whatsapp.WhatsApp')) {
        messagingRef.current = null
        waChatRef.current = null
      }
    } catch {
      /* ignore */
    }
  }

  function dismissChromeChooser(): void {
    chromeChooserToken.current += 1
    setChromeChooser(null)
  }

  function cancelWorkflow(note = 'Okay. Cancelled.'): void {
    pendingUrlRef.current = null
    pendingWaDraftRef.current = null
    dismissChromeChooser()
    interpretToken.current += 1
    attachmentToken.current += 1
    for (const [id, waiter] of interpretWaiters.current) {
      window.miko.bridgeCancel(id)
      waiter.resolve(null)
    }
    interpretWaiters.current.clear()
    if (activeTaskRef.current) activeTaskRef.current = cancelTask(activeTaskRef.current, note)
    const keptFile = workingContextRef.current.retrievedFile
    workingContextRef.current = {
      ...workingContextRef.current,
      taskId: null,
      choice: null,
      pendingAttach: null,
      updatedAt: Date.now()
    }
    cancelWaReplyWork()
    // Cancel in-flight assistant / summarize one-offs that belong to the active workflow.
    for (const e of entriesRef.current) {
      if (e.kind === 'bridge' && e.requestId && (e.status === 'sending' || e.status === 'running')) {
        window.miko.bridgeCancel(e.requestId)
      }
      if (e.kind === 'wa-file' && (e.status === 'listing' || e.status === 'downloading')) {
        replaceEntry(e.id, {
          ...e,
          status: 'cancelled',
          notice: keptFile?.path
            ? `Cancelled. The local file is still at ${keptFile.path}.`
            : 'Cancelled. Nothing further will be copied or attached from this request.'
        })
      }
    }
    window.miko.whatsappCancel()
    window.miko.pasteCancel()
    pushEntry({
      id: 0,
      kind: 'note',
      text: keptFile?.path ? `${note} Local file kept at ${keptFile.filename}.` : note
    })
  }

  async function loadChromeProfilesMarked(): Promise<
    | { status: 'ok'; profiles: ChromeProfileView[] }
    | { status: 'unreadable' | 'missing'; reason: string; fallbacks: { id: string; label: string }[] }
  > {
    const listed = await window.miko.chromeProfilesList()
    if (Array.isArray(listed)) return { status: 'ok', profiles: listed }
    return {
      status: listed.status === 'unreadable' ? 'unreadable' : 'missing',
      reason: listed.reason,
      fallbacks: listed.fallbacks || []
    }
  }

  async function launchChromeDirectory(
    directoryId: string,
    displayName: string,
    url: string | null,
    token: number,
    saveDefault: boolean
  ): Promise<void> {
    if (token !== chromeChooserToken.current) return
    const result = await window.miko.chromeProfilesLaunch({ directoryId, url, displayName })
    if (token !== chromeChooserToken.current) return
    dismissChromeChooser()
    if (!result.ok) {
      if (/couldn.t find/i.test(result.reason)) {
        pushEntry({ id: 0, kind: 'note', text: result.reason })
        await beginChromeProfiles({ forceChooser: true, profileQuery: null, url, name: url ? new URL(url).hostname : null })
        return
      }
      pushEntry({ id: 0, kind: 'note', text: result.reason || 'I couldn’t open Chrome.' })
      return
    }
    if (saveDefault) {
      const next = {
        ...structuredPrefs,
        defaultChromeProfileDirectory: result.directoryId,
        defaultChromeProfileName: result.displayName
      }
      const ok = await window.miko.prefsStructuredSet(next)
      if (ok) setStructuredPrefs(next)
    }
    if (url) {
      const siteName = chromeChooserRef.current?.pendingUrl?.name || pendingUrlRef.current?.name || new URL(url).hostname
      pendingUrlRef.current = null
      lastWebsiteRef.current = {
        url: result.url || url,
        name: siteName,
        browser: 'chrome',
        openedAt: Date.now()
      }
      workingContextRef.current = {
        ...workingContextRef.current,
        lastWebsite: lastWebsiteRef.current,
        updatedAt: Date.now()
      }
    }
    const note = [result.reason, result.verificationNote].filter(Boolean).join(' ')
    pushEntry({ id: 0, kind: 'note', text: note })
  }

  async function beginChromeProfiles(opts: {
    forceChooser: boolean
    profileQuery?: string | null
    url?: string | null
    name?: string | null
  }): Promise<void> {
    const listed = await loadChromeProfilesMarked()
    if (listed.status !== 'ok') {
      pushEntry({
        id: 0,
        kind: 'choices',
        purpose: 'chrome-fallback',
        text: listed.reason,
        options: (listed.fallbacks.length
          ? listed.fallbacks
          : [
              { id: 'profile-picker', label: 'Chrome’s profile picker' },
              { id: 'normal', label: 'Open Chrome normally' }
            ]
        ).map((f) => ({ id: f.id, name: f.label, familiar: true })),
        payload: opts.url || ''
      })
      return
    }
    const profiles = listed.profiles
    if (profiles.length === 0) {
      pushEntry({
        id: 0,
        kind: 'note',
        text: 'Chrome has no readable profiles on this Mac. Nothing was invented.'
      })
      return
    }

    const pending =
      opts.url && opts.name
        ? { url: opts.url, name: opts.name }
        : opts.url
          ? { url: opts.url, name: opts.name || 'that site' }
          : pendingUrlRef.current

    if (opts.profileQuery) {
      const hit = matchChromeProfiles(opts.profileQuery, profiles, structuredPrefs.chromeProfileAliases)
      if (hit.kind === 'one') {
        const token = ++chromeChooserToken.current
        setChromeChooser(null)
        await launchChromeDirectory(hit.profile.directoryId, hit.profile.displayName, pending?.url ?? null, token, false)
        return
      }
      if (hit.kind === 'many') {
        const token = ++chromeChooserToken.current
        if (pending) pendingUrlRef.current = pending
        setChromeChooser({ token, profiles: hit.profiles, pendingUrl: pending, forceChooser: true })
        pushEntry({
          id: 0,
          kind: 'note',
          text: `Several Chrome profiles match “${opts.profileQuery}”. Pick one above MIKO.`
        })
        return
      }
      pushEntry({
        id: 0,
        kind: 'note',
        text: `I couldn’t find a Chrome profile named “${opts.profileQuery}”. Showing the ones I can read.`
      })
    }

    if (!opts.forceChooser && profiles.length === 1) {
      const only = profiles[0]!
      const token = ++chromeChooserToken.current
      await launchChromeDirectory(only.directoryId, only.displayName, pending?.url ?? null, token, false)
      return
    }

    if (!opts.forceChooser && !opts.profileQuery && structuredPrefs.defaultChromeProfileDirectory) {
      const saved = profiles.find((p) => p.directoryId === structuredPrefs.defaultChromeProfileDirectory)
      if (saved) {
        const token = ++chromeChooserToken.current
        await launchChromeDirectory(saved.directoryId, saved.displayName, pending?.url ?? null, token, false)
        return
      }
      const cleared = {
        ...structuredPrefs,
        defaultChromeProfileDirectory: null,
        defaultChromeProfileName: null
      }
      const ok = await window.miko.prefsStructuredSet(cleared)
      if (ok) setStructuredPrefs(cleared)
      pushEntry({
        id: 0,
        kind: 'note',
        text: 'Your saved Chrome default isn’t there anymore. I cleared it — pick a profile.'
      })
    }

    const token = ++chromeChooserToken.current
    if (pending) pendingUrlRef.current = pending
    setChromeChooser({
      token,
      profiles,
      pendingUrl: pending,
      forceChooser: opts.forceChooser
    })
    pushEntry({
      id: 0,
      kind: 'note',
      text: pending
        ? `Pick a Chrome profile for ${pending.name}. The link stays until you choose or cancel.`
        : 'Pick a Chrome profile above MIKO.'
    })
  }

  async function takeChromeChooserPick(text: string): Promise<boolean> {
    const chooser = chromeChooserRef.current
    if (!chooser) return false
    const token = chooser.token
    const index = parseChooserIndex(text, chooser.profiles.length)
    if (index !== null) {
      const profile = chooser.profiles[index]
      if (!profile) return true
      await launchChromeDirectory(profile.directoryId, profile.displayName, chooser.pendingUrl?.url ?? null, token, false)
      return true
    }
    const useName = parseChromeUsePhrase(text)
    if (useName) {
      const hit = matchChromeProfiles(useName, chooser.profiles, structuredPrefs.chromeProfileAliases)
      if (hit.kind === 'one') {
        await launchChromeDirectory(hit.profile.directoryId, hit.profile.displayName, chooser.pendingUrl?.url ?? null, token, false)
        return true
      }
      if (hit.kind === 'many') {
        setChromeChooser({ ...chooser, profiles: hit.profiles })
        pushEntry({ id: 0, kind: 'note', text: `Several match “${useName}”. Pick one.` })
        return true
      }
      pushEntry({ id: 0, kind: 'note', text: `No profile matches “${useName}”.` })
      return true
    }
    return false
  }

  async function resumePendingWaDraft(): Promise<void> {
    const held = pendingWaDraftRef.current
    if (!held || !waChatRef.current) return
    pendingWaDraftRef.current = null
    const formal = stripFormalTone(held)
    const toned = toneFromText(formal.instruction)
    const polished =
      formal.formal || toned.tone === 'formal' || toned.tone === 'professional'
        ? `Write this in a formal, polished way: ${toned.rest}`
        : toned.tone === 'friendly'
          ? `Write this in a friendly way: ${toned.rest}`
          : toned.rest
    // Held open+tell / open+say content is always a drafting instruction — never literal paste.
    // Only explicit “type exactly …” / Draft: paths set literal.
    await startWhatsAppReply({
      instruction: polished,
      needsContext: false,
      autoInsert: true,
      replyHere: true,
      literal: false
    })
  }

  function patchWaReply(id: number, patch: Partial<Extract<PanelEntry, { kind: 'wa-reply' }>>): void {
    setEntries((items) => items.map((item) => (item.kind === 'wa-reply' && item.id === id ? { ...item, ...patch } : item)))
  }

  function activeWaReply(): Extract<PanelEntry, { kind: 'wa-reply' }> | null {
    for (let i = entriesRef.current.length - 1; i >= 0; i -= 1) {
      const e = entriesRef.current[i]
      if (e.kind === 'wa-reply') return e
    }
    return null
  }

  function cancelWaReplyWork(exceptId = 0): void {
    waReplyToken.current += 1
    for (const e of entriesRef.current) {
      if (e.kind === 'wa-reply' && e.requestId && e.id !== exceptId) window.miko.bridgeCancel(e.requestId)
    }
    setEntries((items) =>
      items.map((item) => {
        if (item.id === exceptId || item.kind !== 'wa-reply') return item
        if (
          item.status === 'drafting' ||
          item.status === 'capturing' ||
          item.status === 'choose-insert' ||
          item.status === 'inserting' ||
          item.status === 'clarify-time' ||
          item.status === 'question'
        ) {
          return {
            ...item,
            status: item.draft ? 'ready' : 'failed',
            error: 'Cancelled.',
            requestId: '',
            pendingAdditive: '',
            pendingAdditiveRefine: false,
            timeChoices: [],
            question: item.status === 'question' || item.status === 'clarify-time' ? '' : item.question
          }
        }
        return item
      })
    )
  }

  function whatsAppLine(query: string, result: WhatsAppOpenResult): string {
    if (result.status === 'opened') {
      const where = result.header || query
      return `Opened “${where}” in WhatsApp. The chat header matches.${result.composerReady ? ' The message box is ready.' : ' I couldn’t move to the message box.'}`
    }
    if (result.status === 'assisted') return result.reason || `I put “${query}” in WhatsApp’s search. Pick the chat there.`
    if (result.status === 'none') return result.reason || `No WhatsApp chat matched “${query}”.`
    if (result.status === 'unverified') return 'I selected a row in WhatsApp but couldn’t confirm the chat header. Check it there before you type.'
    if (result.status === 'lost-focus') return 'WhatsApp isn’t in front any more, so I stopped.'
    if (result.status === 'unsupported') return 'WhatsApp contact search isn’t available on Windows yet.'
    if (result.status === 'cancelled') return 'WhatsApp search cancelled.'
    return result.reason || 'I couldn’t search WhatsApp.'
  }

  function clearWhatsAppChoosers(exceptId = 0): void {
    setEntries((items) =>
      items.map((item) => {
        if (item.id === exceptId) return item
        if (item.kind === 'whatsapp') return { id: item.id, kind: 'note', text: 'WhatsApp search cancelled.' }
        if (item.kind === 'choices' && item.purpose === 'whatsapp') {
          return { id: item.id, kind: 'note', text: 'WhatsApp search cancelled.' }
        }
        return item
      })
    )
  }

  function showWhatsAppChoices(id: number, rememberAs: string, result: WhatsAppOpenResult): void {
    const matches = result.matches.length
      ? result.matches
      : result.names.map((name): WhatsAppMatch => ({ id: name, name, snippet: '', exact: sameContact(name, rememberAs) }))
    replaceEntry(id, {
      id,
      kind: 'choices',
      purpose: 'whatsapp',
      text: result.reason || 'Which chat did you mean?',
      options: matches.map((match) => ({
        id: match.id,
        name: match.name,
        familiar: true,
        detail: match.snippet || undefined,
        kind: match.kind,
        exact: match.exact
      })),
      payload: rememberAs
    })
  }

  function offerWhatsAppAlias(rememberAs: string, header: string): void {
    if (!header || sameContact(rememberAs, header)) return
    void window.miko.whatsappAliases().then((aliases) => {
      const existing = aliases.find((item) => sameContact(item.alias, rememberAs))
      if (existing && sameContact(existing.name, header)) return
      pushEntry({
        id: 0,
        kind: 'confirm',
        purpose: 'alias',
        text: `Remember “${rememberAs}” as “${header}” for WhatsApp?`,
        appId: 'whatsapp',
        name: header,
        alias: rememberAs,
        destination: header
      })
    })
  }

  /**
   * Search or reopen a WhatsApp chat.
   * `query` is what to type into WhatsApp. `rememberAs` is what the owner said (for aliases).
   * `pickId` revalidates and opens that chooser row. `entryId` reuses a panel entry when set.
   */
  /** Coalesce concurrent duplicate opens for the same submitted task (not later re-asks). */
  const waOpenTasks = useRef(new Map<string, Promise<void>>())

  async function runWhatsApp(query: string, rememberAs = query, pickId?: string, entryId?: number): Promise<void> {
    const taskId = `wa-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
    const coalesceKey = pickId ? `pick:${pickId}:${taskId}` : `open:${query}`
    // Concurrent duplicate submits (double Enter) share one search; a later new call gets a new taskId path via map miss after settle.
    const prior = !pickId ? waOpenTasks.current.get(coalesceKey) : undefined
    if (prior) {
      await prior
      return
    }
    const work = (async () => {
      const token = ++whatsAppToken.current
      clearWhatsAppChoosers(entryId ?? 0)
      if (!pickId) window.miko.whatsappCancel()
      const id =
        entryId ??
        pushEntry({
          id: 0,
          kind: 'whatsapp',
          text: pickId ? `Opening that WhatsApp chat…` : `Looking for “${query}” in WhatsApp…`
        })
      if (entryId) {
        replaceEntry(entryId, {
          id: entryId,
          kind: 'whatsapp',
          text: pickId ? `Opening that WhatsApp chat…` : `Looking for “${query}” in WhatsApp…`
        })
      }
      const result = await window.miko.whatsappOpen(query, pickId, taskId)
      if (token !== whatsAppToken.current) return
      if (result.status === 'choices') {
        // Keep any held draft; resume only after the owner picks a chat.
        showWhatsAppChoices(id, rememberAs, result)
        return
      }
      replaceEntry(id, { id, kind: 'note', text: whatsAppLine(query, result) })
      if (result.status === 'opened') {
        setWhatsAppTarget(result.header || rememberAs)
        offerWhatsAppAlias(rememberAs, result.header)
        await resumePendingWaDraft()
        return
      }
      // Navigation failed — drop the held draft so it cannot paste into the wrong chat later.
      if (pendingWaDraftRef.current) {
        pendingWaDraftRef.current = null
        pushEntry({ id: 0, kind: 'note', text: 'I dropped the pending message until a WhatsApp chat is open.' })
      }
      if (result.status === 'lost-focus' || result.status === 'failed' || result.status === 'none') {
        setWhatsAppTarget(null)
      }
    })()
    if (!pickId) waOpenTasks.current.set(coalesceKey, work)
    try {
      await work
    } finally {
      if (!pickId) waOpenTasks.current.delete(coalesceKey)
    }
  }

  function activeWhatsAppChooser(): {
    id: number
    kind: 'choices'
    purpose: 'whatsapp'
    text: string
    options: import('../components/TextPanel').PanelChoice[]
    payload?: string
  } | null {
    for (let i = entriesRef.current.length - 1; i >= 0; i -= 1) {
      const entry = entriesRef.current[i]
      if (entry.kind === 'choices' && entry.purpose === 'whatsapp') {
        return { ...entry, purpose: 'whatsapp' }
      }
    }
    return null
  }

  async function sendWaDraft(
    entryId: number,
    req: {
      chatName: string
      instruction: string
      context?: string
      previous?: string
      change?: string
      pronoun?: 'him' | 'her' | 'them'
      tone?: 'casual' | 'formal' | null
    }
  ): Promise<void> {
    const status = await window.miko.bridgeStatus()
    if (!status?.enabled) {
      patchWaReply(entryId, { status: 'failed', error: 'MIKO assistant is off. Turn it on in the paw menu to draft WhatsApp replies.' })
      return
    }
    if (!status.available || !status.signedIn) {
      patchWaReply(entryId, {
        status: 'failed',
        error: status.available ? 'Sign in to ChatGPT in the ChatGPT app first.' : 'The ChatGPT app’s Codex CLI wasn’t found.'
      })
      return
    }
    if (status.busy) {
      patchWaReply(entryId, { status: 'failed', error: 'MIKO is still answering something else. Wait for it, then try again.' })
      return
    }
    const entry = entriesRef.current.find((e) => e.id === entryId)
    const pronoun = req.pronoun ?? (entry?.kind === 'wa-reply' ? entry.pronoun : undefined)
    const tone =
      req.tone ??
      (/formal|professional|polished/i.test(req.change || '') || /Write this in a formal/i.test(req.instruction)
        ? 'formal'
        : /casual|friendlier|more casual/i.test(req.change || '')
          ? 'casual'
          : null)
    const requestId = `wa-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
    patchWaReply(entryId, { status: 'drafting', requestId, error: '', question: '', answer: '', notice: '' })
    const sent = await window.miko.bridgeSend(
      requestId,
      whatsAppDraftPrompt({ ...req, pronoun, tone }),
      { fresh: true }
    )
    if (!sent.ok) patchWaReply(entryId, { status: 'failed', error: sent.reason, requestId: '' })
  }

  async function observeWaSendStatus(
    _entryId: number,
    chatName: string,
    insertedText: string
  ): Promise<'not-sent' | 'unverified' | 'sent'> {
    const check = await window.miko.whatsappInsert({ expectHeader: chatName, text: '', mode: 'ask' })
    if (check.status === 'has-text') {
      const composer = check.composerText || ''
      if (composer === insertedText || (insertedText && composer.includes(insertedText))) return 'not-sent'
      return 'unverified'
    }
    if (check.status === 'empty') {
      // Composer empty alone does not prove Send — could be cleared. Check latest outgoing bubble.
      const peek = await window.miko.whatsappPeek(true, true)
      if (peek.status === 'peeked') {
        const mine = [...peek.messages].reverse().find((m) => m.mine)
        if (mine && insertedText && (mine.text === insertedText || insertedText.includes(mine.text) || mine.text.includes(insertedText))) {
          return 'sent'
        }
      }
      return 'unverified'
    }
    return 'unverified'
  }

  async function insertWaDraft(entryId: number, mode: 'replace' | 'append', token: number): Promise<void> {
    const entry = entriesRef.current.find((e) => e.id === entryId)
    if (entry?.kind !== 'wa-reply' || !entry.draft.trim()) return
    if (token !== waReplyToken.current) return
    // Insert only sets AXValue on the composer — never Return, never Send, never dismiss-via-Enter.
    patchWaReply(entryId, { status: 'inserting', notice: '', error: '', sendStatus: 'not-sent' })
    const result = await window.miko.whatsappInsert({ expectHeader: entry.chatName, text: entry.draft, mode })
    if (token !== waReplyToken.current) return
    if (result.status === 'inserted' && result.verified) {
      patchWaReply(entryId, {
        status: 'inserted',
        insertedText: entry.draft,
        sendStatus: 'not-sent',
        notice: '',
        error: ''
      })
      return
    }
    if (result.status === 'inserted' && !result.verified) {
      patchWaReply(entryId, {
        status: 'failed',
        error: 'I couldn’t verify the draft in WhatsApp’s message box. Use Copy or Retry insertion.',
        notice: ''
      })
      return
    }
    if (result.status === 'switched') {
      if (result.header) setWhatsAppTarget(result.header)
      else setWhatsAppTarget(null)
      patchWaReply(entryId, {
        status: 'switched',
        pendingHeader: result.header,
        notice: result.reason || 'The open chat changed.'
      })
      return
    }
    if (result.status === 'has-text') {
      patchWaReply(entryId, { status: 'choose-insert', notice: '', error: '' })
      return
    }
    patchWaReply(entryId, {
      status: 'failed',
      error: result.reason || 'I couldn’t insert the draft. Use Copy, or Retry insertion.',
      notice: ''
    })
  }

  async function maybeAutoInsert(entryId: number, token: number): Promise<void> {
    const entry = entriesRef.current.find((e) => e.id === entryId)
    if (entry?.kind !== 'wa-reply' || !entry.autoInsert || !entry.draft.trim()) {
      if (entry?.kind === 'wa-reply') patchWaReply(entryId, { status: 'ready' })
      return
    }
    const locked = await recheckWhatsAppChat(entry.chatName, token)
    if (!locked.ok) {
      if (locked.reason === 'cancelled') return
      patchWaReply(entryId, {
        status: 'switched',
        pendingHeader: locked.header,
        draft: entry.draft,
        notice: locked.reason || 'The open chat changed before insert.'
      })
      return
    }
    if (locked.header !== entry.chatName) patchWaReply(entryId, { chatName: locked.header })
    const check = await window.miko.whatsappInsert({ expectHeader: locked.header, text: '', mode: 'ask' })
    if (token !== waReplyToken.current) return
    if (check.status === 'switched') {
      patchWaReply(entryId, { status: 'switched', pendingHeader: check.header, draft: entry.draft, notice: check.reason })
      return
    }
    if (check.status === 'has-text') {
      patchWaReply(entryId, { status: 'choose-insert', notice: '', error: '' })
      return
    }
    if (check.status === 'empty') {
      await insertWaDraft(entryId, 'replace', token)
      return
    }
    patchWaReply(entryId, { status: 'ready', error: check.reason || 'I couldn’t check WhatsApp’s message box.', notice: '' })
  }

  waDraftDone.current = (entryId, reply) => {
    const token = waReplyToken.current
    const entry = entriesRef.current.find((e) => e.id === entryId)
    if (entry?.kind !== 'wa-reply') return
    const parsed = parseDraft(reply)
    if (parsed.kind === 'question') {
      patchWaReply(entryId, { status: 'question', question: parsed.text, requestId: '', draft: entry.draft })
      return
    }
    if (parsed.kind === 'empty' || parsed.kind === 'unrelated') {
      patchWaReply(entryId, { status: 'failed', error: 'No draft came back.', requestId: '' })
      return
    }
    patchWaReply(entryId, { draft: parsed.text, requestId: '', status: entry.autoInsert ? 'drafting' : 'ready', error: '' })
    void maybeAutoInsert(entryId, token)
  }

  async function bindWhatsAppChat(
    intent: WhatsAppReplyIntent,
    id: number,
    token: number
  ): Promise<string | null> {
    if (intent.recipient) {
      const peek = await window.miko.whatsappPeek(false)
      if (token !== waReplyToken.current) return null
      if (peek.status === 'peeked' && recipientMatchesOpenChat(intent.recipient, peek.header)) {
        patchWaReply(id, { chatName: peek.header })
        return peek.header
      }
      patchWaReply(id, { notice: `Opening “${intent.recipient}” in WhatsApp…`, chatName: intent.recipient })
      await runWhatsApp(intent.recipient, intent.recipient)
      if (token !== waReplyToken.current) return null
      const again = await window.miko.whatsappPeek(false)
      if (token !== waReplyToken.current) return null
      if (again.status !== 'peeked' || !recipientMatchesOpenChat(intent.recipient, again.header)) {
        patchWaReply(id, {
          status: 'failed',
          error: again.reason || `I couldn’t open “${intent.recipient}” in WhatsApp. Pick the chat, then try again.`,
          chatName: intent.recipient
        })
        return null
      }
      patchWaReply(id, { chatName: again.header })
      return again.header
    }
    const peek = await window.miko.whatsappPeek(false)
    if (token !== waReplyToken.current) return null
    if (peek.status !== 'peeked' || !peek.header) {
      patchWaReply(id, {
        status: 'failed',
        error:
          peek.status === 'unsupported'
            ? peek.reason
            : peek.reason || 'Which WhatsApp chat? Open one, or say “reply to Dad saying …”.',
        chatName: ''
      })
      return null
    }
    patchWaReply(id, { chatName: peek.header })
    return peek.header
  }

  async function recheckWhatsAppChat(expected: string, token: number): Promise<{ ok: true; header: string } | { ok: false; header: string; reason: string }> {
    const peek = await window.miko.whatsappPeek(false)
    if (token !== waReplyToken.current) return { ok: false, header: '', reason: 'cancelled' }
    if (peek.status !== 'peeked' || !peek.header) {
      return { ok: false, header: peek.header || '', reason: peek.reason || 'I couldn’t re-read the open WhatsApp chat.' }
    }
    if (!sameContact(peek.header, expected) && !recipientMatchesOpenChat(expected, peek.header)) {
      return { ok: false, header: peek.header, reason: `The open chat is now “${peek.header}”, not “${expected}”.` }
    }
    return { ok: true, header: peek.header }
  }

  async function presentWhatsAppContext(id: number, chatName: string, token: number, latest = false): Promise<void> {
    const withMsgs = await window.miko.whatsappPeek(true, latest)
    if (token !== waReplyToken.current) return
    if (withMsgs.status !== 'peeked') {
      patchWaReply(id, {
        status: 'review',
        context: '',
        contextNotice: withMsgs.contextNotice,
        notice:
          (withMsgs.reason || 'I couldn’t read the visible messages.') +
          ' Paste selected text or clipboard content into the box, or draft without chat context.'
      })
      return
    }
    const check = await recheckWhatsAppChat(chatName, token)
    if (!check.ok) {
      if (check.reason === 'cancelled') return
      const existing = entriesRef.current.find((e) => e.id === id)
      patchWaReply(id, {
        status: 'switched',
        pendingHeader: check.header,
        chatName,
        notice: check.reason,
        draft: existing?.kind === 'wa-reply' ? existing.draft : ''
      })
      return
    }
    const context = formatVisibleContext(withMsgs.messages, check.header, withMsgs.atLatest !== false)
    if (withMsgs.contextNotice) void window.miko.whatsappMarkContextNotice()
    if (!context.trim()) {
      patchWaReply(id, {
        status: 'review',
        context: '',
        contextNotice: withMsgs.contextNotice,
        notice: 'I couldn’t read the visible messages reliably. Use selected text or the clipboard, or draft without chat context.'
      })
      return
    }
    const older = withMsgs.atLatest === false
    patchWaReply(id, {
      status: 'review',
      chatName: check.header,
      context,
      contextNotice: withMsgs.contextNotice,
      notice: older
        ? 'Older history is visible. Use these messages, go to the latest, or draft from your instruction only.'
        : withMsgs.contextNotice
          ? undefined
          : 'Review the visible chat context, then draft.'
    })
  }

  function beginTimeClarification(
    entryId: number,
    instruction: string,
    opts: { additiveRefine?: boolean; pronoun?: 'him' | 'her' | 'them' } = {}
  ): boolean {
    if (!instruction.trim()) return false
    const ambiguous = detectAmbiguousTimes(instruction)
    if (!ambiguous) return false
    const patch: Partial<Extract<PanelEntry, { kind: 'wa-reply' }>> = {
      status: 'clarify-time',
      question: ambiguous.question,
      timeChoices: ambiguous.choices,
      ambiguousTimeToken: ambiguous.ambiguousToken,
      originalTranscript: ambiguous.originalInstruction,
      pendingAdditive: opts.additiveRefine ? instruction : '',
      pendingAdditiveRefine: Boolean(opts.additiveRefine),
      pronoun: opts.pronoun,
      answer: '',
      notice: '',
      error: ''
    }
    if (!opts.additiveRefine) patch.instruction = instruction
    patchWaReply(entryId, patch)
    return true
  }

  async function applyAdditiveToUnsentDraft(
    active: Extract<PanelEntry, { kind: 'wa-reply' }>,
    intent: WhatsAppReplyIntent
  ): Promise<'handled' | 'new-message' | 'blocked'> {
    if (active.insertedText && active.draft !== active.insertedText && active.status !== 'choose-insert') {
      patchWaReply(active.id, {
        status: 'ready',
        notice: 'You edited the draft in MIKO. Confirm refine to overwrite, or insert the edited text first.',
        followUp: intent.instruction,
        pronoun: intent.pronoun ?? active.pronoun
      })
      return 'blocked'
    }
    if (beginTimeClarification(active.id, intent.instruction, { additiveRefine: true, pronoun: intent.pronoun ?? active.pronoun })) {
      return 'handled'
    }
    const check = await window.miko.whatsappInsert({ expectHeader: active.chatName, text: '', mode: 'ask' })
    const composerStatus =
      check.status === 'has-text' ? 'has-text' : check.status === 'empty' ? 'empty' : 'other'
    const mode = resolveAdditiveFollowUpMode({
      composerStatus,
      composerText: check.composerText || '',
      draft: active.draft,
      insertedText: active.insertedText,
      entryStatus: active.status,
      draftEditedLocally: Boolean(active.insertedText && active.draft !== active.insertedText && active.status !== 'choose-insert')
    })
    if (mode === 'blocked-edit') {
      patchWaReply(active.id, {
        status: 'ready',
        notice: 'You edited the draft in MIKO. Confirm refine to overwrite, or insert the edited text first.',
        followUp: intent.instruction,
        pronoun: intent.pronoun ?? active.pronoun
      })
      return 'blocked'
    }
    if (mode === 'refine-unsent') {
      const change = `Add this to the existing draft (keep prior content; integrate naturally; strip tell/say/ask framing): ${intent.instruction}`
      await sendWaDraft(active.id, {
        chatName: active.chatName,
        instruction: `${active.instruction}; also: ${intent.instruction}`,
        context: active.context,
        previous: active.draft,
        change,
        pronoun: intent.pronoun ?? active.pronoun
      })
      return 'handled'
    }
    // new-follow-up — composer clear or prior message no longer editable as a draft
    if (active.status === 'inserted' && active.insertedText) {
      const sendStatus = await observeWaSendStatus(active.id, active.chatName, active.insertedText)
      patchWaReply(active.id, {
        sendStatus,
        notice:
          sendStatus === 'sent'
            ? 'Earlier insert; a later send was observed in this chat.'
            : 'Inserted as a draft; current send status unverified.'
      })
    } else if (active.status === 'inserted') {
      patchWaReply(active.id, {
        sendStatus: 'unverified',
        notice: 'Inserted as a draft; current send status unverified.'
      })
    }
    return 'new-message'
  }

  async function startWhatsAppReply(intent: WhatsAppReplyIntent): Promise<void> {
    messagingRef.current = 'whatsapp'
    if (intent.refine) {
      const active = activeWaReply()
      if (!active?.draft) {
        pushEntry({ id: 0, kind: 'note', text: 'There’s no WhatsApp draft to refine yet.' })
        return
      }
      if (active.insertedText && active.draft !== active.insertedText) {
        patchWaReply(active.id, {
          status: 'ready',
          notice: 'You edited the draft in MIKO. Confirm Refine to overwrite, or insert the edited text first.',
          followUp: intent.instruction
        })
        return
      }
      await sendWaDraft(active.id, {
        chatName: active.chatName,
        instruction: active.instruction,
        context: active.context,
        previous: active.draft,
        change: intent.instruction
      })
      return
    }

    if (intent.additive) {
      const active = activeWaReply()
      if (
        active &&
        (active.draft || active.status === 'clarify-time') &&
        (active.status === 'ready' ||
          active.status === 'inserted' ||
          active.status === 'choose-insert' ||
          active.status === 'failed' ||
          active.status === 'clarify-time')
      ) {
        const outcome = await applyAdditiveToUnsentDraft(active, intent)
        if (outcome === 'handled' || outcome === 'blocked') return
        // outcome === 'new-message' → fall through to a fresh draft
      }
    }

    cancelWaReplyWork()
    const token = ++waReplyToken.current
    const id = pushEntry({
      id: 0,
      kind: 'wa-reply',
      chatName: intent.recipient || '…',
      instruction: intent.instruction,
      context: '',
      draft: '',
      insertedText: '',
      status: 'capturing',
      autoInsert: intent.autoInsert,
      contextNotice: false,
      pronoun: intent.pronoun,
      notice: '',
      sendStatus: undefined
    })

    const chatName = await bindWhatsAppChat(intent, id, token)
    if (!chatName || token !== waReplyToken.current) return
    setWhatsAppTarget(chatName)

    // Recheck destination before drafting or reading context.
    const locked = await recheckWhatsAppChat(chatName, token)
    if (!locked.ok) {
      if (locked.reason === 'cancelled') return
      if (locked.header) setWhatsAppTarget(locked.header)
      else setWhatsAppTarget(null)
      patchWaReply(id, { status: 'switched', pendingHeader: locked.header, chatName, notice: locked.reason })
      return
    }
    setWhatsAppTarget(locked.header)
    patchWaReply(id, { chatName: locked.header })

    if (intent.literal) {
      patchWaReply(id, { draft: intent.instruction, status: intent.autoInsert ? 'drafting' : 'ready', error: '' })
      await maybeAutoInsert(id, token)
      return
    }

    if (!intent.literal && beginTimeClarification(id, intent.instruction, { pronoun: intent.pronoun })) {
      return
    }

    if (intent.needsContext) {
      await presentWhatsAppContext(id, locked.header, token, false)
      return
    }

    await sendWaDraft(id, {
      chatName: locked.header,
      instruction: intent.instruction,
      pronoun: intent.pronoun
    })
  }

  async function takeWhatsAppChooserPick(text: string): Promise<boolean> {
    const chooser = activeWhatsAppChooser()
    if (!chooser) return false
    const index = parseChooserIndex(text, chooser.options.length)
    if (index === null) return false
    const option = chooser.options[index]
    if (!option) return false
    const rememberAs = chooser.payload || option.name
    await runWhatsApp(rememberAs, rememberAs, option.id, chooser.id)
    return true
  }

  async function takeTabChooserPick(text: string): Promise<boolean> {
    for (let i = entriesRef.current.length - 1; i >= 0; i -= 1) {
      const entry = entriesRef.current[i]
      if (entry.kind !== 'choices' || entry.purpose !== 'close-tab') continue
      const index = parseChooserIndex(text, entry.options.length)
      if (index === null) return false
      const option = entry.options[index]
      if (!option) return false
      const [browser, winStr, tabStr] = option.id.split(':')
      if ((browser !== 'chrome' && browser !== 'safari') || !winStr || !tabStr) return false
      replaceEntry(entry.id, { id: entry.id, kind: 'note', text: `Closing “${option.name}”…` })
      const result = await window.miko.closeWebsite({
        pick: { browser, window: Number(winStr), tab: Number(tabStr) }
      })
      replaceEntry(entry.id, {
        id: entry.id,
        kind: 'note',
        text:
          result.status === 'closed'
            ? `Closed that tab.`
            : result.status === 'failed' || result.status === 'unsupported' || result.status === 'none'
              ? result.reason
              : 'I couldn’t close that tab.'
      })
      return true
    }
    return false
  }

  async function startWhatsAppSummarize(intent: WhatsAppSummarizeIntent): Promise<void> {
    const token = ++waReplyToken.current
    const task = createTask({
      id: newActionId(),
      source: 'typed',
      original: 'summarize',
      steps: [{ kind: 'summarize_whatsapp', scope: intent.scope }],
      clarification: null,
      pending: null
    })
    activeTaskRef.current = task
    pushEntry({ id: 0, kind: 'note', text: 'Reading the latest message…' })
    const peek = await window.miko.whatsappPeek(true, intent.preferLatest)
    if (token !== waReplyToken.current || activeTaskRef.current?.id !== task.id) return
    if (peek.status !== 'peeked' || !peek.header) {
      pushEntry({
        id: 0,
        kind: 'note',
        text: peek.reason || 'I couldn’t read the open WhatsApp chat. Open one, then say “summarize”.'
      })
      activeTaskRef.current = { ...task, phase: 'failed' }
      return
    }
    if (waChatRef.current && !recipientMatchesOpenChat(waChatRef.current, peek.header) && peek.header !== waChatRef.current) {
      // Chat switched — revalidate rather than using stale context.
      setWhatsAppTarget(peek.header)
    } else {
      setWhatsAppTarget(peek.header)
    }
    const composerBefore = peek.composerText
    let messages = peek.messages
    if (intent.scope === 'incoming') messages = messages.filter((m) => !m.mine)
    if (!messages.length) {
      if (peek.atLatest === false) {
        pushEntry({
          id: 0,
          kind: 'choices',
          purpose: 'wa-summarize-range',
          text: 'Older history is visible. Summarize what’s on screen, or go to the latest?',
          options: [
            { id: 'visible', name: 'Summarize visible messages', familiar: true },
            { id: 'latest', name: 'Go to latest', familiar: true }
          ],
          payload: peek.header
        })
        return
      }
      pushEntry({
        id: 0,
        kind: 'note',
        text: 'I couldn’t find an incoming text message in the visible chat. Scroll to the latest message, then try again.'
      })
      return
    }
    const context = formatVisibleContext(messages, peek.header, peek.atLatest !== false)
    workingContextRef.current = {
      ...workingContextRef.current,
      whatsapp: { header: peek.header, verifiedAt: Date.now(), atLatest: peek.atLatest },
      summarySource: {
        chatName: peek.header,
        messageIds: messagesFingerprint(messages),
        capturedAt: Date.now(),
        scope: intent.scope
      },
      updatedAt: Date.now()
    }
    const status = await window.miko.bridgeStatus()
    if (!status?.enabled || !status.available || !status.signedIn) {
      pushEntry({
        id: 0,
        kind: 'note',
        text: !status?.enabled
          ? 'MIKO assistant is off. Turn it on in the paw menu to summarize chats.'
          : status.available
            ? 'Sign in to ChatGPT in the ChatGPT app first.'
            : 'The ChatGPT app’s Codex CLI wasn’t found.'
      })
      return
    }
    pushEntry({ id: 0, kind: 'note', text: 'Preparing your summary…' })
    const requestId = `sum-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
    const id = pushEntry({
      id: 0,
      kind: 'bridge',
      requestId,
      prompt: whatsAppSummarizePrompt({ chatName: peek.header, context, scope: intent.scope }),
      status: 'sending',
      reply: '',
      thread: '',
      detail: `Summary of ${peek.header} — WhatsApp composer unchanged.`,
      kept: false,
      startedAt: Date.now()
    })
    const sent = await window.miko.bridgeSend(requestId, whatsAppSummarizePrompt({ chatName: peek.header, context, scope: intent.scope }), {
      fresh: true
    })
    if (token !== waReplyToken.current) {
      window.miko.bridgeCancel(requestId)
      return
    }
    if (!sent.ok) {
      replaceEntry(id, {
        id,
        kind: 'bridge',
        requestId,
        prompt: '',
        status: 'failed',
        reply: '',
        thread: '',
        detail: sent.reason,
        kept: false
      })
      return
    }
    // Verify composer was not touched (read-only summarize).
    const after = await window.miko.whatsappPeek(false)
    if (after.status === 'peeked' && after.composerText !== composerBefore) {
      pushEntry({
        id: 0,
        kind: 'note',
        text: 'Warning: WhatsApp’s message box changed during the summary. I did not insert anything on purpose — check the composer.'
      })
    }
  }

  function patchWaFile(id: number, patch: Partial<Extract<PanelEntry, { kind: 'wa-file' }>>): void {
    const cur = entriesRef.current.find((e) => e.id === id)
    if (!cur || cur.kind !== 'wa-file') return
    replaceEntry(id, { ...cur, ...patch })
  }

  function rememberRetrievedFile(ref: {
    path: string
    filename: string
    bytes: number
    chatName: string
    attachmentId: string
    scopeLabel: 'latest-visible' | 'selected'
  }): void {
    workingContextRef.current = {
      ...workingContextRef.current,
      retrievedFile: { ...ref, retrievedAt: Date.now() },
      updatedAt: Date.now()
    }
  }

  async function runFollowUpOnRetrieved(intent: WhatsAppAttachmentIntent, token: number): Promise<boolean> {
    const file = workingContextRef.current.retrievedFile
    if (!file?.path) return false
    if (
      intent.op !== 'copy-file' &&
      intent.op !== 'copy-filename' &&
      intent.op !== 'copy-path' &&
      intent.op !== 'show-finder' &&
      intent.op !== 'open' &&
      intent.op !== 'attach-here' &&
      intent.op !== 'attach-elsewhere' &&
      intent.op !== 'save-downloads'
    ) {
      return false
    }
    if (token !== attachmentToken.current) return true
    if (intent.op === 'copy-file') {
      const copied = await window.miko.clipboardFile(file.path)
      if (token !== attachmentToken.current) return true
      pushEntry({
        id: 0,
        kind: 'note',
        text: copied.verified
          ? `Copied “${file.filename}” as a file (not just the name). Paste where you need it.`
          : copied.reason || 'I couldn’t put the file on the clipboard.'
      })
      return true
    }
    if (intent.op === 'copy-filename') {
      const ok = await window.miko.copyText(file.filename)
      pushEntry({ id: 0, kind: 'note', text: ok ? `Copied filename “${file.filename}”.` : 'Couldn’t copy the filename.' })
      return true
    }
    if (intent.op === 'copy-path') {
      const ok = await window.miko.copyText(file.path)
      pushEntry({ id: 0, kind: 'note', text: ok ? 'Copied the local path.' : 'Couldn’t copy the path.' })
      return true
    }
    if (intent.op === 'show-finder') {
      const ok = await window.miko.revealFile(file.path)
      pushEntry({ id: 0, kind: 'note', text: ok ? 'Showing it in Finder.' : 'That file isn’t on disk anymore.' })
      return true
    }
    if (intent.op === 'open') {
      const err = await window.miko.openLocalFile(file.path)
      pushEntry({ id: 0, kind: 'note', text: err ? err : `Opened “${file.filename}”.` })
      return true
    }
    if (intent.op === 'save-downloads') {
      pushEntry({
        id: 0,
        kind: 'note',
        text: `Already saved — “${file.filename}” is at ${file.path}.`
      })
      return true
    }
    if (intent.op === 'attach-here' || intent.op === 'attach-elsewhere') {
      await attachRetrievedFile(file.path, file.filename, intent.op === 'attach-elsewhere', token)
      return true
    }
    return false
  }

  function attachmentWorkCancelled(token: number, taskId?: string): boolean {
    if (token !== attachmentToken.current) return true
    const task = activeTaskRef.current
    if (!task) return false
    if (taskId && task.id !== taskId) return true
    return task.phase === 'cancelled' || task.phase === 'failed'
  }

  async function attachRetrievedFile(
    path: string,
    filename: string,
    forceChoose: boolean,
    token: number
  ): Promise<void> {
    if (token !== attachmentToken.current) return
    const taskId = activeTaskRef.current?.id || workingContextRef.current.taskId || ''
    if (attachmentWorkCancelled(token, taskId)) {
      pushEntry({ id: 0, kind: 'note', text: 'That attach was cancelled.' })
      return
    }
    const waHeader = waChatRef.current || workingContextRef.current.whatsapp?.header || ''
    const external = await window.miko.lastExternalApp()
    const waIsTarget =
      !forceChoose &&
      (messagingRef.current === 'whatsapp' ||
        /whatsapp/i.test(external?.name || '') ||
        /whatsapp/i.test(external?.bundleId || '') ||
        Boolean(waHeader))

    if (!waIsTarget || forceChoose) {
      const options = [
        waHeader ? { id: `wa:${waHeader}`, name: `WhatsApp: ${waHeader}`, familiar: true } : null,
        external && !/miko/i.test(external.name)
          ? { id: `app:${external.bundleId}`, name: `${external.name} (copy file instead if paste isn’t supported)`, familiar: true }
          : null,
        { id: 'copy', name: 'Copy file', familiar: true },
        { id: 'finder', name: 'Show in Finder', familiar: true }
      ].filter(Boolean) as { id: string; name: string; familiar: boolean }[]
      workingContextRef.current = {
        ...workingContextRef.current,
        pendingAttach: { path, filename, expectHeader: waHeader || undefined, taskId },
        updatedAt: Date.now()
      }
      pushEntry({
        id: 0,
        kind: 'choices',
        purpose: 'wa-attach-dest',
        text: 'Where should I attach that file? (Unsupported apps get Copy file / Show in Finder.)',
        options,
        payload: JSON.stringify({ path, filename, taskId })
      })
      return
    }

    const expect = waHeader
    if (!expect) {
      pushEntry({ id: 0, kind: 'note', text: 'Open the WhatsApp chat first, then say “attach it here”.' })
      return
    }
    pushEntry({ id: 0, kind: 'note', text: `Attaching “${filename}” in “${expect}” (unsent)…` })
    const result = await window.miko.pasteFileWhatsApp({ expectHeader: expect, path })
    if (attachmentWorkCancelled(token, taskId)) {
      pushEntry({
        id: 0,
        kind: 'note',
        text: result.status === 'attached'
          ? `Cancelled after attach started — check “${expect}”. The file was left unsent.`
          : 'Cancelled. Nothing was attached.'
      })
      return
    }
    if (result.status === 'switched') {
      pushEntry({
        id: 0,
        kind: 'note',
        text: result.reason || `The open chat changed — I didn’t attach to “${result.header || 'another chat'}”.`
      })
      workingContextRef.current = {
        ...workingContextRef.current,
        pendingAttach: { path, filename, expectHeader: expect, taskId },
        updatedAt: Date.now()
      }
      pushEntry({
        id: 0,
        kind: 'choices',
        purpose: 'wa-attach-dest',
        text: 'Which chat should get the file?',
        options: [
          result.header ? { id: `wa:${result.header}`, name: `Use “${result.header}”`, familiar: true } : null,
          { id: `wa:${expect}`, name: `Retry “${expect}”`, familiar: true },
          { id: 'copy', name: 'Copy file', familiar: true },
          { id: 'finder', name: 'Show in Finder', familiar: true }
        ].filter(Boolean) as { id: string; name: string; familiar: boolean }[],
        payload: JSON.stringify({ path, filename, taskId })
      })
      return
    }
    pushEntry({
      id: 0,
      kind: 'note',
      text:
        result.status === 'attached' && result.verified
          ? result.reason || `Attached “${filename}” in “${expect}” (unsent).`
          : result.reason || 'I couldn’t verify the attachment preview. Nothing was sent.'
    })
  }

  async function retrieveAndShowAttachment(
    pick: ParsedAttachmentBubble,
    header: string,
    intent: WhatsAppAttachmentIntent,
    token: number,
    taskId: string,
    entryId?: number
  ): Promise<void> {
    const id =
      entryId ??
      pushEntry({
        id: 0,
        kind: 'wa-file',
        chatName: header,
        filename: pick.filename,
        fileKind: pick.kind,
        bytes: 0,
        path: '',
        status: 'downloading',
        scopeLabel: 'Latest visible attachment (visible messages only)',
        verified: false,
        attachmentId: pick.id,
        taskId
      })
    if (entryId) patchWaFile(id, { status: 'downloading', filename: pick.filename, fileKind: pick.kind, attachmentId: pick.id })
    const saved = await window.miko.whatsappAttachmentSave({
      expectHeader: header,
      filename: pick.filename,
      id: pick.id
    })
    if (token !== attachmentToken.current || activeTaskRef.current?.id !== taskId || activeTaskRef.current?.phase === 'cancelled') {
      if (saved.verified && saved.path && saved.provenance === 'ax-new-file') {
        rememberRetrievedFile({
          path: saved.path,
          filename: saved.filename || pick.filename,
          bytes: saved.bytes,
          chatName: header,
          attachmentId: pick.id,
          scopeLabel: 'latest-visible'
        })
        patchWaFile(id, {
          status: 'cancelled',
          path: saved.path,
          filename: saved.filename || pick.filename,
          bytes: saved.bytes,
          verified: true,
          notice: `Cancelled after download — file kept at ${saved.path}. No further copy/attach from this request.`
        })
      } else {
        patchWaFile(id, { status: 'cancelled', notice: 'Cancelled before the file was verified.' })
      }
      return
    }
    if (saved.status === 'candidate' && saved.path) {
      patchWaFile(id, {
        status: 'failed',
        path: saved.path,
        filename: saved.filename || pick.filename,
        bytes: saved.bytes,
        verified: false,
        notice: 'Unverified Downloads candidate — choose below.'
      })
      pushEntry({
        id: 0,
        kind: 'choices',
        purpose: 'wa-download-candidate',
        text: `“${saved.filename || pick.filename}” is already in Downloads (${saved.bytes} bytes), but filename/size alone don’t prove it came from this WhatsApp message. What should I do?`,
        options: [
          {
            id: `use:${saved.path}`,
            name: 'Use this Downloads file (candidate)',
            familiar: true,
            detail: saved.path
          },
          { id: 'retry', name: 'Try Save to Downloads again', familiar: true },
          { id: 'cancel', name: 'Cancel', familiar: true }
        ],
        payload: JSON.stringify({
          header,
          intent,
          taskId,
          entryId: id,
          attachmentId: pick.id,
          filename: pick.filename,
          candidatePath: saved.path
        })
      })
      return
    }
    if (!saved.verified || !saved.path) {
      patchWaFile(id, {
        status: 'failed',
        notice: saved.reason || 'Download didn’t produce a verified local file.'
      })
      return
    }
    await finishRetrievedAttachment(id, pick, header, intent, token, taskId, saved)
  }

  async function finishRetrievedAttachment(
    entryId: number,
    pick: ParsedAttachmentBubble,
    header: string,
    intent: WhatsAppAttachmentIntent,
    token: number,
    _taskId: string,
    saved: {
      path: string
      filename: string
      bytes: number
      header: string
      reason: string
      provenance?: string
    }
  ): Promise<void> {
    rememberRetrievedFile({
      path: saved.path,
      filename: saved.filename || pick.filename,
      bytes: saved.bytes,
      chatName: saved.header || header,
      attachmentId: pick.id,
      scopeLabel: 'latest-visible'
    })
    setWhatsAppTarget(saved.header || header)
    const provenanceNote =
      saved.provenance === 'user-accepted-candidate'
        ? 'owner-accepted Downloads candidate'
        : saved.provenance === 'ax-new-file'
          ? 'new WhatsApp Save to Downloads'
          : undefined
    patchWaFile(entryId, {
      status: 'ready',
      path: saved.path,
      filename: saved.filename || pick.filename,
      bytes: saved.bytes,
      verified: true,
      chatName: saved.header || header,
      detail: provenanceNote,
      notice: saved.reason
    })
    if (token !== attachmentToken.current) return
    if (intent.op === 'copy-file') {
      const copied = await window.miko.clipboardFile(saved.path)
      if (token !== attachmentToken.current) return
      pushEntry({
        id: 0,
        kind: 'note',
        text: copied.verified
          ? `Copied “${saved.filename}” as a file.`
          : copied.reason || 'File saved, but clipboard copy failed.'
      })
    } else if (intent.op === 'show-finder') {
      await window.miko.revealFile(saved.path)
    } else if (intent.op === 'open') {
      await window.miko.openLocalFile(saved.path)
    } else if (intent.op === 'attach-here' || intent.op === 'attach-elsewhere') {
      await attachRetrievedFile(saved.path, saved.filename || pick.filename, intent.op === 'attach-elsewhere', token)
    }
  }

  async function startWhatsAppAttachment(intent: WhatsAppAttachmentIntent): Promise<void> {
    const token = ++attachmentToken.current
    const task = createTask({
      id: newActionId(),
      source: 'typed',
      original: intent.op,
      steps: [
        { kind: 'list_whatsapp_attachments' },
        { kind: 'fetch_whatsapp_attachment', dependsOn: [0] }
      ],
      clarification: null,
      pending: null
    })
    activeTaskRef.current = task
    workingContextRef.current = { ...workingContextRef.current, taskId: task.id, updatedAt: Date.now() }

    if (await runFollowUpOnRetrieved(intent, token)) return

    const entryId = pushEntry({
      id: 0,
      kind: 'wa-file',
      chatName: waChatRef.current || '…',
      filename: '',
      fileKind: '',
      bytes: 0,
      path: '',
      status: 'listing',
      scopeLabel: 'Latest visible attachment (visible messages only)',
      verified: false,
      attachmentId: '',
      taskId: task.id
    })

    const listed = await window.miko.whatsappAttachmentsList()
    if (token !== attachmentToken.current || activeTaskRef.current?.id !== task.id) {
      patchWaFile(entryId, { status: 'cancelled', notice: 'Cancelled.' })
      return
    }
    if (listed.status !== 'listed') {
      patchWaFile(entryId, {
        status: 'failed',
        notice: listed.reason || 'I couldn’t list attachments in the open WhatsApp chat.'
      })
      return
    }
    setWhatsAppTarget(listed.header)
    workingContextRef.current = {
      ...workingContextRef.current,
      whatsapp: { header: listed.header, verifiedAt: Date.now(), atLatest: listed.atLatest },
      updatedAt: Date.now()
    }
    const matches = filterAttachments(listed.attachments, intent)
    const scopeLabel = listed.atLatest
      ? 'Latest visible attachment (visible messages only — not full chat history)'
      : 'Latest visible attachment (older history is on screen — not full chat history)'
    patchWaFile(entryId, { chatName: listed.header, scopeLabel })

    if (matches.length === 0) {
      patchWaFile(entryId, {
        status: 'failed',
        notice:
          listed.attachments.length === 0
            ? `No downloadable documents in the visible messages of “${listed.header}”.`
            : `No ${intent.direction === 'incoming' ? 'incoming' : intent.direction === 'outgoing' ? 'outgoing' : 'matching'} attachment in the visible messages of “${listed.header}”.`
      })
      return
    }

    if (matches.length > 1 && !intent.latest && !intent.nameHint) {
      pushEntry({
        id: 0,
        kind: 'choices',
        purpose: 'wa-attachment',
        text: `Several attachments in “${listed.header}” (visible only). Which one?`,
        options: matches.map((m) => ({
          id: m.id,
          name: m.filename,
          familiar: true,
          detail: [m.kind.toUpperCase(), m.detail, m.time, m.mine ? 'outgoing' : 'incoming'].filter(Boolean).join(' · ')
        })),
        payload: JSON.stringify({ header: listed.header, intent, taskId: task.id })
      })
      patchWaFile(entryId, { status: 'failed', notice: 'Pick an attachment above.' })
      return
    }

    const pick = intent.latest || matches.length > 1 ? pickLatest(matches) : matches[0]!
    if (!pick) {
      patchWaFile(entryId, { status: 'failed', notice: 'I couldn’t pick an attachment.' })
      return
    }
    // When several match “latest”, still auto-pick the newest visible; mention the count.
    if (matches.length > 1 && intent.latest) {
      pushEntry({
        id: 0,
        kind: 'note',
        text: `Using the latest visible of ${matches.length} matching files: “${pick.filename}”.`
      })
    }
    await retrieveAndShowAttachment(pick, listed.header, intent, token, task.id, entryId)
  }

  async function interpretUnfamiliar(text: string, source: 'typed' | 'voice'): Promise<ActionPlan | null> {
    const deterministic = tryDeterministicPlan(text, source)
    if (deterministic) return deterministic

    const status = await window.miko.bridgeStatus()
    if (!status?.enabled || !status.available || !status.signedIn) return null
    if (status.busy) {
      pushEntry({ id: 0, kind: 'note', text: 'MIKO is still answering something else. Try that request again in a moment.' })
      return null
    }

    const task = createTask({
      id: newActionId(),
      source: 'interpreted',
      original: text,
      steps: [{ kind: 'clarify' }],
      clarification: null,
      pending: null
    })
    activeTaskRef.current = task
    const token = ++interpretToken.current
    const examples = await window.miko.examplesList()
    const prefs = await window.miko.prefsStructuredGet()
    const requestId = `interp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
    const prompt = interpretPrompt(text, {
      platform: navigator.platform.toLowerCase().includes('win') ? 'win32' : 'darwin',
      waChat: waChatRef.current,
      lastWebsite: lastWebsiteRef.current?.name ?? null,
      preferredBrowser: prefs?.preferredBrowser ?? null,
      examples: examples.slice(0, 3),
      preferences: prefs
    })

    pushEntry({ id: 0, kind: 'note', text: 'Understanding…' })
    const reply = await new Promise<string | null>((resolve) => {
      interpretWaiters.current.set(requestId, { resolve, token, taskId: task.id })
      void window.miko.bridgeSend(requestId, prompt, { fresh: true }).then((sent) => {
        if (!sent.ok) {
          interpretWaiters.current.delete(requestId)
          resolve(null)
          pushEntry({ id: 0, kind: 'note', text: sent.reason || 'I couldn’t interpret that.' })
        }
      })
    })

    if (token !== interpretToken.current || activeTaskRef.current?.phase === 'cancelled') return null
    if (reply === null) return null

    const plan = parseInterpretResult(reply, text, source)
    if (!plan) {
      pushEntry({
        id: 0,
        kind: 'note',
        text: 'I couldn’t turn that into a safe action plan. Try a clearer command, or Ask MIKO for a normal answer.'
      })
      return null
    }
    if (plan.clarification && (plan.steps.length === 0 || plan.steps.every((s) => s.kind === 'clarify'))) {
      pushEntry({ id: 0, kind: 'note', text: plan.clarification })
      activeTaskRef.current = { ...task, phase: 'needs_choice', progress: plan.clarification }
      return null
    }
    return plan
  }

  async function runActionPlan(plan: ActionPlan): Promise<void> {
    const task = createTask(plan)
    activeTaskRef.current = task
    workingContextRef.current = { ...workingContextRef.current, taskId: task.id, updatedAt: Date.now() }
    const platform = navigator.platform.toLowerCase().includes('win') ? 'win32' : 'darwin'
    const allowed = new Set(availableKinds(platform))

    const aborted = (): boolean => {
      const cur = activeTaskRef.current
      return !cur || cur.id !== task.id || cur.phase === 'cancelled'
    }

    for (let i = 0; i < plan.steps.length; i += 1) {
      if (aborted()) return
      const step = plan.steps[i]
      const meta = capability(step.kind)
      if (!meta || !allowed.has(step.kind)) {
        pushEntry({
          id: 0,
          kind: 'note',
          text: `“${step.kind}” isn’t available on this Mac yet.`
        })
        return
      }

      if (step.kind === 'cancel_task') {
        cancelWorkflow('Okay. Cancelled.')
        return
      }
      if (step.kind === 'clarify') {
        pushEntry({ id: 0, kind: 'note', text: plan.clarification || 'Could you clarify that?' })
        activeTaskRef.current = { ...activeTaskRef.current, phase: 'needs_choice' }
        return
      }
      if (step.kind === 'unsupported') {
        pushEntry({ id: 0, kind: 'note', text: 'I can’t do that on this Mac yet.' })
        return
      }
      if (step.kind === 'open_whatsapp_chat' && step.target) {
        pushEntry({ id: 0, kind: 'note', text: `Finding ${step.target}…` })
        if (plan.pending?.content) pendingWaDraftRef.current = plan.pending.content
        else if (step.content) pendingWaDraftRef.current = step.content
        // Hold draft content from a following draft step; that step is skipped after open resumes it.
        const next = plan.steps[i + 1]
        let skipNextDraft = false
        if (next?.kind === 'draft_whatsapp' && next.content) {
          const toneBit =
            next.tone === 'formal' || next.tone === 'professional'
              ? `${next.content} professionally`
              : next.tone === 'friendly'
                ? `${next.content} friendly`
                : next.content
          pendingWaDraftRef.current = toneBit
          skipNextDraft = true
        }
        messagingRef.current = 'whatsapp'
        await runWhatsApp(step.target, step.target)
        if (aborted()) return
        if (skipNextDraft) i += 1
        continue
      }
      if (step.kind === 'draft_whatsapp' && step.content) {
        // Revalidate target before drafting/inserting.
        const peek = await window.miko.whatsappPeek(false)
        if (aborted()) return
        if (peek.status !== 'peeked' || !peek.header) {
          pushEntry({ id: 0, kind: 'note', text: peek.reason || 'Open the WhatsApp chat first, then try again.' })
          return
        }
        if (step.target && !recipientMatchesOpenChat(step.target, peek.header)) {
          pushEntry({
            id: 0,
            kind: 'note',
            text: `The open chat is “${peek.header}”, not “${step.target}”. I didn’t insert anything.`
          })
          setWhatsAppTarget(peek.header)
          return
        }
        setWhatsAppTarget(peek.header)
        const toneBit =
          step.tone === 'formal' || step.tone === 'professional'
            ? `Write this in a formal, polished way: ${step.content}`
            : step.tone === 'friendly'
              ? `Write this in a friendly way: ${step.content}`
              : step.content
        pushEntry({ id: 0, kind: 'note', text: 'Preparing your reply…' })
        await startWhatsAppReply({
          instruction: toneBit,
          recipient: step.target || undefined,
          needsContext: false,
          autoInsert: true,
          replyHere: !step.target
        })
        continue
      }
      if (step.kind === 'refine_draft') {
        await startWhatsAppReply({
          instruction: step.content || 'shorter',
          needsContext: false,
          autoInsert: true,
          refine: true
        })
        continue
      }
      if (step.kind === 'summarize_whatsapp') {
        pushEntry({ id: 0, kind: 'note', text: 'Reading the latest message…' })
        await startWhatsAppSummarize({
          scope: step.scope === 'conversation' || step.scope === 'visible' ? step.scope : 'incoming',
          preferLatest: step.scope !== 'visible' && step.scope !== 'conversation',
          replyHere: true
        })
        continue
      }
      if (
        step.kind === 'list_whatsapp_attachments' ||
        step.kind === 'fetch_whatsapp_attachment' ||
        step.kind === 'copy_file' ||
        step.kind === 'attach_file'
      ) {
        await startWhatsAppAttachment({
          op:
            step.kind === 'attach_file'
              ? 'attach-here'
              : step.kind === 'copy_file'
                ? 'copy-file'
                : 'fetch',
          kind: 'any',
          direction: step.scope === 'incoming' ? 'incoming' : 'any',
          latest: true
        })
        continue
      }
      if (step.kind === 'open_website' && (step.url || step.target)) {
        await runDecision({
          type: 'open-url',
          url: step.url || `https://${step.target}`,
          name: step.target || 'site',
          browser: step.browser
        })
        continue
      }
      if (step.kind === 'close_website' || step.kind === 'close_browser_tab') {
        await runDecision({
          type: 'close-website',
          name: step.target || lastWebsiteRef.current?.name || 'site',
          url: step.url || lastWebsiteRef.current?.url,
          host: step.target || undefined,
          all: /all/i.test(plan.original)
        })
        continue
      }
      if (step.kind === 'ask_assistant') {
        await startAssistant(plan.original)
        continue
      }
      if (step.kind === 'search_mail' && step.content) {
        showMailTab()
        mailActions.applyIntent({ kind: 'search', query: step.content })
        continue
      }
    }
    if (activeTaskRef.current?.id === task.id && activeTaskRef.current.phase !== 'cancelled') {
      activeTaskRef.current = { ...activeTaskRef.current, phase: 'completed', progress: 'Done.' }
    }
  }

  async function onSubmit(): Promise<void> {
    const text = draft.trim()
    if (!text || typeof window.miko === 'undefined') return
    setDraft('')
    if (await takeWhatsAppChooserPick(text)) return
    if (await takeTabChooserPick(text)) return
    if (await takeChromeChooserPick(text)) return
    const catalog = await loadCatalog()
    if (!catalog) return
    await revalidateMessagingContext()
    const ctx = commandContext()
    // Selection summarize only when the owner clearly refers to the selection, or when there is no WA chat.
    const sel = latestSelection()
    const selCmd = sel ? parseSelectionCommand(text) : null
    const refersToSelection = /\b(?:this|it|selection|selected)\b/i.test(text) || /summari[sz]e\s+(?:this|it)\b/i.test(text)
    const waSummarizePreferred =
      Boolean(ctx.waChat || ctx.messaging === 'whatsapp') && /^summari[sz]e(?:\s+(?:for\s+me)?)?[.!]?$/i.test(text.trim())
    if (sel && selCmd && !waSummarizePreferred && (refersToSelection || !ctx.waChat)) {
      await runSelectionAction(sel.id, selCmd.action, selCmd.instruction)
      return
    }
    const decision = routeCommand(text, 'typed', catalog, await loadChats(), ctx)
    logRouteDecision(text, decision)
    if (shouldTryInterpreter(decision, text, ctx) && text.trim()) {
      const planned = tryDeterministicPlan(text, 'typed')
      if (planned) {
        await runActionPlan(planned)
        return
      }
      const interpreted = await interpretUnfamiliar(text, 'typed')
      if (interpreted) {
        await runActionPlan(interpreted)
        return
      }
      // Interpreter unavailable / unclear: fall through to routed question, or free-text chooser for unknowns.
      if (decision.type === 'question' || decision.type === 'ask-gpt') {
        await runDecision(decision)
        return
      }
      if (decision.type === 'unknown') {
        const generic = /I can walk, sit, open or close/i.test(decision.text)
        if (!generic) {
          pushEntry({ id: 0, kind: 'note', text: decision.text })
          return
        }
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
    if (await takeWhatsAppChooserPick(text)) {
      if (auto) pushEntry({ id: 0, kind: 'note', text: `Heard: \u201c${text}\u201d` })
      return
    }
    if (await takeTabChooserPick(text)) {
      if (auto) pushEntry({ id: 0, kind: 'note', text: `Heard: \u201c${text}\u201d` })
      return
    }
    if (await takeChromeChooserPick(text)) {
      if (auto) pushEntry({ id: 0, kind: 'note', text: `Heard: \u201c${text}\u201d` })
      return
    }
    // Reply mode in the Mail tab: dictation fills the reply box, except mail commands ("cancel reply", "reply to the third email").
    if (tabRef.current === 'mail' && mailActions.replyActive()) {
      const mailCommand = parseMailCommand(text)
      if (!mailCommand && mailActions.dictate(text)) return
    }
    if (auto) pushEntry({ id: 0, kind: 'note', text: `Heard: \u201c${text}\u201d` })
    const catalog = auto ? await loadCatalog() : []
    if (!catalog) {
      setDraft(text)
      return
    }
    await revalidateMessagingContext()
    const ctx = commandContext()
    const sel = latestSelection()
    const selCmd = sel ? parseSelectionCommand(text) : null
    const refersToSelection = /\b(?:this|it|selection|selected)\b/i.test(text) || /summari[sz]e\s+(?:this|it)\b/i.test(text)
    const waSummarizePreferred =
      Boolean(ctx.waChat || ctx.messaging === 'whatsapp') && /^summari[sz]e(?:\s+(?:for\s+me)?)?[.!]?$/i.test(text.trim())
    if (sel && selCmd && !waSummarizePreferred && (refersToSelection || !ctx.waChat)) {
      await runSelectionAction(sel.id, selCmd.action, selCmd.instruction)
      return
    }
    const decision = routeCommand(text, 'voice', catalog, await loadChats(), ctx)
    logRouteDecision(text, decision)
    // Same unfamiliar-wording path as typed when automatic voice execution is on.
    if (auto && shouldTryInterpreter(decision, text, ctx) && text.trim()) {
      const planned = tryDeterministicPlan(text, 'voice')
      if (planned) {
        await runActionPlan(planned)
        return
      }
      const interpreted = await interpretUnfamiliar(text, 'voice')
      if (interpreted) {
        await runActionPlan(interpreted)
        return
      }
    }
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
    if (decision.type === 'clear') {
      // Wipe MIKO's panel and stop anything still pending from it. The assistant conversation is kept
      // ("new conversation" starts a fresh one).
      for (const e of entriesRef.current) {
        if (e.kind === 'bridge' && (e.status === 'sending' || e.status === 'running')) window.miko.bridgeCancel(e.requestId)
        if (e.kind === 'wa-reply' && e.requestId) window.miko.bridgeCancel(e.requestId)
      }
      waReplyToken.current += 1
      window.miko.whatsappCancel()
      window.miko.pasteCancel()
      window.miko.listenCancel()
      setListening(false)
      setPasteBanner(null)
      pasteEntryRef.current = 0
      setDraft('')
      setEntries([])
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
          const text =
            decision.intent.kind === 'reply' || decision.intent.kind === 'cancel-reply'
              ? 'Replies are drafted from mail MIKO can read. Connect Gmail in the Mail tab first.'
              : 'Your mail is in ChatGPT, not MIKO, so open that message there.'
          pushEntry({ id: 0, kind: 'note', text })
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
    if (decision.type === 'cancel-workflow') {
      cancelWorkflow('Okay. Cancelled.')
      return
    }
    if (decision.type === 'chrome-profiles') {
      await beginChromeProfiles({
        forceChooser: decision.forceChooser,
        profileQuery: decision.profileQuery,
        url: decision.url,
        name: decision.name
      })
      return
    }
    if (decision.type === 'open-url') {
      pendingUrlRef.current = { url: decision.url, name: decision.name }
      // Chrome opens go through the profile fan / default / explicit profile — not a silent first-profile pick.
      if ((decision.browser || '').toLowerCase() === 'chrome') {
        await beginChromeProfiles({
          forceChooser: false,
          profileQuery: decision.chromeProfileQuery,
          url: decision.url,
          name: decision.name
        })
        return
      }
      const result = await window.miko.openUrl(decision.url, decision.name, decision.browser)
      if (result.ok) {
        lastWebsiteRef.current = {
          url: result.url || decision.url,
          name: result.name || decision.name,
          browser: decision.browser || result.browser || null,
          openedAt: Date.now()
        }
        workingContextRef.current = {
          ...workingContextRef.current,
          lastWebsite: lastWebsiteRef.current,
          updatedAt: Date.now()
        }
        const where = result.browser ? ` in ${result.browser}` : ''
        pushEntry({
          id: 0,
          kind: 'note',
          text: result.reason || `Opened ${result.name || decision.name}${where}.`
        })
      } else {
        pushEntry({ id: 0, kind: 'note', text: result.reason || `I couldn’t open ${decision.name}.` })
      }
      return
    }
    if (decision.type === 'close-website') {
      pushEntry({ id: 0, kind: 'note', text: decision.thisTab ? 'Which tab should I close?' : `Closing ${decision.name}…` })
      const result = await window.miko.closeWebsite({
        host: decision.host,
        url: decision.url,
        all: decision.all,
        thisTab: decision.thisTab
      })
      if (result.status === 'closed') {
        pushEntry({
          id: 0,
          kind: 'note',
          text: result.closed === 1 ? `Closed the ${decision.name} tab.` : `Closed ${result.closed} ${decision.name} tabs.`
        })
        if (!decision.all) lastWebsiteRef.current = null
        return
      }
      if (result.status === 'choices') {
        pushEntry({
          id: 0,
          kind: 'choices',
          purpose: 'close-tab',
          text: result.reason || 'Which tab should I close?',
          options: result.tabs.map((t) => ({
            id: `${t.browser}:${t.window}:${t.tab}`,
            name: `${t.browser === 'chrome' ? 'Chrome' : 'Safari'}: ${t.title || t.url}`,
            familiar: true,
            detail: t.url
          }))
        })
        return
      }
      pushEntry({ id: 0, kind: 'note', text: result.reason || `I couldn’t close ${decision.name}.` })
      return
    }
    if (decision.type === 'whatsapp') {
      messagingRef.current = 'whatsapp'
      if (decision.pendingDraft) pendingWaDraftRef.current = decision.pendingDraft
      await runWhatsApp(decision.query, decision.query)
      return
    }
    if (decision.type === 'whatsapp-summarize') {
      await startWhatsAppSummarize(decision.intent)
      return
    }
    if (decision.type === 'whatsapp-attachment') {
      await startWhatsAppAttachment(decision.intent)
      return
    }
    if (decision.type === 'whatsapp-reply') {
      await startWhatsAppReply(decision.intent)
      return
    }
    if (decision.type === 'chat-or-whatsapp') {
      pushEntry({
        id: 0,
        kind: 'choices',
        purpose: 'chat-or-whatsapp',
        text: `“${decision.name}” — WhatsApp or a saved ChatGPT chat?`,
        options: [
          { id: `wa:${decision.name}`, name: 'WhatsApp', familiar: true },
          { id: `gpt:${decision.name}`, name: 'Saved ChatGPT chat', familiar: true }
        ]
      })
      return
    }
    if (decision.type === 'whatsapp-aliases') {
      const list = await window.miko.whatsappAliases()
      pushEntry(
        list.length === 0
          ? { id: 0, kind: 'note', text: 'No WhatsApp names saved.' }
          : {
              id: 0,
              kind: 'choices',
              purpose: 'whatsapp-forget',
              text: 'Forget a saved WhatsApp name?',
              options: list.map((item) => ({ id: item.alias, name: `${item.alias} → ${item.name}`, familiar: true }))
            }
      )
      return
    }
    if (decision.type === 'whatsapp-forget') {
      const saved = await window.miko.whatsappForget(decision.alias)
      pushEntry({ id: 0, kind: 'note', text: saved.ok ? `Forgot “${decision.alias}” for WhatsApp.` : saved.reason })
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
    if (decision.type === 'pet') {
      await switchPet(decision.pet, true)
      return
    }
    if (decision.type === 'pet-choose') {
      await openPetChooser()
      return
    }
    // Remaining CommandResult: launch (confirm already returned above).
    if (decision.appId === 'whatsapp') messagingRef.current = 'whatsapp'
    pushEntry({ id: 0, kind: 'note', text: `Opening ${decision.name}.` })
    const result = await window.miko.launchApp({ id: decision.appId, confirm: true })
    if (!result.ok) pushEntry({ id: 0, kind: 'note', text: result.reason })
  }

  function logRouteDecision(raw: string, decision: CommandResult): void {
    // Dev diagnostics only: normalized instruction → action → capability (no chat bodies).
    try {
      if (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.DEV) {
        const d = routeDiagnostics(raw, decision)
        console.info('[miko:route]', d.normalized, '→', d.action, `(${d.capability})`)
      }
    } catch {
      /* ignore */
    }
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
      replaceEntry(id, { ...entry, detail: 'Paste reply brings ChatGPT\u2019s answer back here. In ChatGPT, select the answer and press \u2318C (or use its copy button), then press Paste reply.' })
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
    if (entry.purpose === 'chrome-fallback') {
      const kind = option.id === 'profile-picker' || option.id === 'normal' ? option.id : null
      if (!kind) return
      const url = entry.payload || null
      const result = await window.miko.chromeProfilesFallback(kind, url)
      replaceEntry(entryId, {
        id: entryId,
        kind: 'note',
        text: result.ok ? `${result.reason} ${result.verificationNote}`.trim() : result.reason
      })
      return
    }
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
    if (entry.purpose === 'chat-or-whatsapp') {
      const name = option.id.replace(/^(?:wa|gpt):/, '')
      if (option.id.startsWith('wa:')) {
        messagingRef.current = 'whatsapp'
        replaceEntry(entryId, { id: entryId, kind: 'note', text: `WhatsApp for \u201c${name}\u201d.` })
        await runWhatsApp(name, name)
      } else {
        setWhatsAppTarget(null)
        replaceEntry(entryId, { id: entryId, kind: 'note', text: `Looking for a saved chat called \u201c${name}\u201d.` })
        const catalog = await loadCatalog()
        if (!catalog) return
        await runDecision(routeCommand(`open my ${name} chat`, 'typed', catalog, await loadChats(), commandContext()))
      }
      return
    }
    if (entry.purpose === 'whatsapp') {
      const rememberAs = entry.payload || option.name
      await runWhatsApp(rememberAs, rememberAs, option.id, entryId)
      return
    }
    if (entry.purpose === 'close-tab') {
      const [browser, winStr, tabStr] = option.id.split(':')
      if ((browser === 'chrome' || browser === 'safari') && winStr && tabStr) {
        replaceEntry(entryId, { id: entryId, kind: 'note', text: `Closing “${option.name}”…` })
        const result = await window.miko.closeWebsite({
          pick: { browser, window: Number(winStr), tab: Number(tabStr) }
        })
        replaceEntry(entryId, {
          id: entryId,
          kind: 'note',
          text: result.status === 'closed' ? 'Closed that tab.' : 'reason' in result ? result.reason : 'I couldn’t close that tab.'
        })
      }
      return
    }
    if (entry.purpose === 'wa-summarize-range') {
      replaceEntry(entryId, { id: entryId, kind: 'note', text: option.id === 'latest' ? 'Going to the latest messages…' : 'Summarizing visible messages…' })
      await startWhatsAppSummarize({
        scope: option.id === 'visible' ? 'visible' : 'incoming',
        preferLatest: option.id === 'latest',
        replyHere: true
      })
      return
    }
    if (entry.purpose === 'wa-download-candidate') {
      let meta: {
        header?: string
        intent?: WhatsAppAttachmentIntent
        taskId?: string
        entryId?: number
        attachmentId?: string
        filename?: string
        candidatePath?: string
      } = {}
      try {
        meta = JSON.parse(entry.payload || '{}') as typeof meta
      } catch {
        meta = {}
      }
      if (option.id === 'cancel') {
        replaceEntry(entryId, { id: entryId, kind: 'note', text: 'Left the unverified Downloads candidate unused.' })
        return
      }
      const token = attachmentToken.current
      const header = meta.header || waChatRef.current || ''
      const filename = meta.filename || 'attachment'
      const attachmentId = meta.attachmentId || ''
      const intent = meta.intent || { op: 'fetch' as const, kind: 'any' as const, direction: 'any' as const, latest: true }
      const fileEntryId = meta.entryId
      if (option.id === 'retry') {
        replaceEntry(entryId, { id: entryId, kind: 'note', text: 'Trying Save to Downloads again…' })
        if (fileEntryId) patchWaFile(fileEntryId, { status: 'downloading', notice: 'Saving to Downloads…' })
        const saved = await window.miko.whatsappAttachmentSave({
          expectHeader: header,
          filename,
          id: attachmentId || undefined
        })
        if (attachmentWorkCancelled(token, meta.taskId)) {
          replaceEntry(entryId, { id: entryId, kind: 'note', text: 'Cancelled.' })
          return
        }
        if (saved.status === 'candidate') {
          replaceEntry(entryId, {
            id: entryId,
            kind: 'note',
            text: 'WhatsApp still didn’t write a new file. Rename or move the existing Downloads copy, then retry — or accept the candidate.'
          })
          return
        }
        if (!saved.verified || !saved.path) {
          replaceEntry(entryId, { id: entryId, kind: 'note', text: saved.reason || 'Download failed.' })
          return
        }
        replaceEntry(entryId, { id: entryId, kind: 'note', text: saved.reason })
        if (fileEntryId) {
          await finishRetrievedAttachment(
            fileEntryId,
            {
              id: attachmentId,
              filename,
              kind: filename.split('.').pop() || 'file',
              detail: null,
              time: null,
              mine: false,
              raw: filename
            },
            header,
            intent,
            token,
            meta.taskId || '',
            saved
          )
        }
        return
      }
      if (option.id.startsWith('use:')) {
        const candidatePath = option.id.slice(4) || meta.candidatePath || ''
        replaceEntry(entryId, { id: entryId, kind: 'note', text: 'Using the Downloads candidate you chose…' })
        const saved = await window.miko.whatsappAttachmentSave({
          expectHeader: header,
          filename,
          id: attachmentId || undefined,
          acceptCandidatePath: candidatePath
        })
        if (attachmentWorkCancelled(token, meta.taskId)) {
          replaceEntry(entryId, { id: entryId, kind: 'note', text: 'Cancelled.' })
          return
        }
        if (!saved.verified || !saved.path) {
          replaceEntry(entryId, { id: entryId, kind: 'note', text: saved.reason || 'Couldn’t use that candidate.' })
          return
        }
        replaceEntry(entryId, { id: entryId, kind: 'note', text: saved.reason })
        if (fileEntryId) {
          await finishRetrievedAttachment(
            fileEntryId,
            {
              id: attachmentId,
              filename,
              kind: filename.split('.').pop() || 'file',
              detail: null,
              time: null,
              mine: false,
              raw: filename
            },
            header,
            intent,
            token,
            meta.taskId || '',
            saved
          )
        }
        return
      }
      return
    }
    if (entry.purpose === 'wa-attachment') {
      let meta: { header?: string; intent?: WhatsAppAttachmentIntent; taskId?: string } = {}
      try {
        meta = JSON.parse(entry.payload || '{}') as typeof meta
      } catch {
        meta = {}
      }
      const listed = await window.miko.whatsappAttachmentsList()
      if (listed.status !== 'listed') {
        replaceEntry(entryId, { id: entryId, kind: 'note', text: listed.reason || 'I couldn’t list attachments.' })
        return
      }
      const pick = listed.attachments.find((a) => a.id === option.id)
      if (!pick) {
        replaceEntry(entryId, { id: entryId, kind: 'note', text: 'That attachment isn’t visible anymore.' })
        return
      }
      replaceEntry(entryId, { id: entryId, kind: 'note', text: `Fetching “${pick.filename}”…` })
      const token = ++attachmentToken.current
      const taskId = meta.taskId || activeTaskRef.current?.id || newActionId()
      await retrieveAndShowAttachment(
        pick,
        listed.header,
        meta.intent || { op: 'fetch', kind: 'any', direction: 'any', latest: false },
        token,
        taskId
      )
      return
    }
    if (entry.purpose === 'wa-attach-dest') {
      let meta: { path?: string; filename?: string; taskId?: string } = {}
      try {
        meta = JSON.parse(entry.payload || '{}') as typeof meta
      } catch {
        meta = workingContextRef.current.pendingAttach || {}
      }
      const path = meta.path || workingContextRef.current.retrievedFile?.path || ''
      const filename = meta.filename || workingContextRef.current.retrievedFile?.filename || 'file'
      if (meta.taskId && activeTaskRef.current?.id && meta.taskId !== activeTaskRef.current.id) {
        replaceEntry(entryId, { id: entryId, kind: 'note', text: 'That attach request is stale — cancelled.' })
        return
      }
      if (attachmentWorkCancelled(attachmentToken.current, meta.taskId)) {
        replaceEntry(entryId, { id: entryId, kind: 'note', text: 'Cancelled — I won’t attach that file.' })
        return
      }
      if (option.id === 'copy') {
        const copied = await window.miko.clipboardFile(path)
        replaceEntry(entryId, {
          id: entryId,
          kind: 'note',
          text: copied.verified ? `Copied “${filename}” as a file.` : copied.reason
        })
        return
      }
      if (option.id === 'finder') {
        const ok = await window.miko.revealFile(path)
        replaceEntry(entryId, { id: entryId, kind: 'note', text: ok ? 'Showing it in Finder.' : 'That file isn’t on disk.' })
        return
      }
      if (option.id.startsWith('wa:')) {
        const expect = option.id.slice(3)
        replaceEntry(entryId, { id: entryId, kind: 'note', text: `Attaching in “${expect}” (unsent)…` })
        const token = attachmentToken.current
        const result = await window.miko.pasteFileWhatsApp({ expectHeader: expect, path })
        if (attachmentWorkCancelled(token, meta.taskId)) {
          replaceEntry(entryId, {
            id: entryId,
            kind: 'note',
            text: 'Cancelled — I won’t finish attaching from a late callback.'
          })
          return
        }
        replaceEntry(entryId, {
          id: entryId,
          kind: 'note',
          text:
            result.status === 'attached' && result.verified
              ? result.reason
              : result.reason || 'Attach failed or couldn’t be verified. Nothing was sent.'
        })
        workingContextRef.current = { ...workingContextRef.current, pendingAttach: null, updatedAt: Date.now() }
        return
      }
      if (option.id.startsWith('app:')) {
        const copied = await window.miko.clipboardFile(path)
        replaceEntry(entryId, {
          id: entryId,
          kind: 'note',
          text: copied.verified
            ? `That app isn’t a verified file-insert target. Copied “${filename}” as a file — paste it there, or use Show in Finder.`
            : copied.reason || 'I couldn’t copy the file for that destination.'
        })
        return
      }
      return
    }
    if (entry.purpose === 'whatsapp-forget') {
      const saved = await window.miko.whatsappForget(option.id)
      replaceEntry(entryId, { id: entryId, kind: 'note', text: saved.ok ? `Forgot \u201c${option.id}\u201d for WhatsApp.` : saved.reason })
      return
    }
    replaceEntry(entryId, { id: entryId, kind: 'note', text: `Opening ${option.name}.` })
    const result = await window.miko.launchApp({ id: appId, confirm: true })
    if (!result.ok) pushEntry({ id: 0, kind: 'note', text: result.reason })
  }

  async function onConfirm(id: number): Promise<void> {
    const entry = entries.find((item) => item.id === id)
    if (!entry || entry.kind !== 'confirm' || typeof window.miko === 'undefined') return
    if (entry.purpose === 'alias' && entry.alias && entry.destination) {
      const saved = await window.miko.whatsappRemember(entry.alias, entry.destination)
      replaceEntry(id, {
        id,
        kind: 'note',
        text: saved.ok ? `I’ll use “${entry.alias}” for “${entry.destination}” in WhatsApp.` : saved.reason
      })
      return
    }
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
    if (entry.appId === 'whatsapp') messagingRef.current = 'whatsapp'
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
          sizing={{ side: panelSide, onPreset: (p) => void presetPanel(p), onResizeStart: startPanelResize }}
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
                  await runDecision(routeCommand(text, 'typed', catalog, await loadChats(), { ...commandContext(), mailTab: true }))
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
          onView={(next) => {
            if (next === 'chats') {
              showChats()
              return
            }
            if (next === 'prefs') {
              void refreshPets()
              void window.miko.prefsStructuredGet().then((p) => {
                if (p) setStructuredPrefs(p)
              })
              void window.miko.whatsappAliases().then(setPrefAliases)
              void window.miko.examplesList().then(setPrefExamples)
            }
            setPanelView(next)
          }}
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
            pets: petListing
              ? {
                  available: petListing.available,
                  selected: petListing.selected,
                  busy: petBusy,
                  message: petMessage,
                  thumbs: petThumbs,
                  focus: petFocus,
                  onChoose: (id) => void switchPet(id, false)
                }
              : undefined,
            text: prefs,
            message: prefsMessage,
            shortcut: selectionKey,
            structured: structuredPrefs,
            aliases: prefAliases,
            examples: prefExamples,
            onSaveShortcut: async (value) => {
              const r = await window.miko.selectionShortcutSet(value)
              setSelectionKey(r.shortcut)
              setPrefsMessage(r.ok ? `Selection shortcut: ${r.shortcut}` : r.reason)
            },
            onSave: async (text) => {
              const ok = await window.miko.prefsSet(text)
              if (ok) setPrefs(text.slice(0, 2000))
              setPrefsMessage(ok ? 'Saved. New MIKO assistant conversations will use these.' : 'Couldn\u2019t save.')
            },
            onSaveStructured: async (next) => {
              const ok = await window.miko.prefsStructuredSet(next)
              if (ok) setStructuredPrefs(next)
              setPrefsMessage(ok ? 'Structured preferences saved.' : 'Couldn’t save structured preferences.')
            },
            onForgetAlias: async (alias) => {
              const saved = await window.miko.whatsappForget(alias)
              setPrefAliases(saved.list.map((a) => ({ alias: a.alias, name: a.name })))
              setPrefsMessage(saved.ok ? `Forgot “${alias}”.` : saved.reason)
            },
            onRemoveExample: async (id) => {
              const list = await window.miko.examplesRemove(id)
              setPrefExamples(list)
              setPrefsMessage('Removed correction example.')
            },
            onAddExample: async (example) => {
              const list = await window.miko.examplesAdd(example)
              setPrefExamples(list)
              setPrefsMessage('Added correction example.')
            },
            onOpenChromeChooser: () => {
              setPanelView('log')
              void beginChromeProfiles({ forceChooser: true, profileQuery: null, url: null, name: null })
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
          onDismiss={(id) => {
            const entry = entriesRef.current.find((item) => item.id === id)
            replaceEntry(id, {
              id,
              kind: 'note',
              text: entry?.kind === 'confirm' && entry.purpose === 'alias' ? 'I won’t remember that.' : 'Left it closed.'
            })
          }}
          onWhatsAppCancel={() => {
            whatsAppToken.current += 1
            window.miko.whatsappCancel()
            clearWhatsAppChoosers()
            const working = [...entriesRef.current].reverse().find((item) => item.kind === 'whatsapp')
            if (working) replaceEntry(working.id, { id: working.id, kind: 'note', text: 'WhatsApp search cancelled.' })
          }}
          onWhatsAppRefine={(entryId) => {
            const entry = entriesRef.current.find((item) => item.id === entryId)
            if (entry?.kind !== 'choices' || entry.purpose !== 'whatsapp') return
            whatsAppToken.current += 1
            window.miko.whatsappCancel()
            setDraft(entry.payload || '')
            replaceEntry(entryId, {
              id: entryId,
              kind: 'note',
              text: 'Edit the name below and Send, or say a shorter WhatsApp search.'
            })
          }}
          onWaFile={(entryId, action) => {
            void (async () => {
              const entry = entriesRef.current.find((item) => item.id === entryId)
              if (entry?.kind !== 'wa-file') return
              if (action.type === 'cancel') {
                attachmentToken.current += 1
                window.miko.whatsappCancel()
                const kept = entry.path || workingContextRef.current.retrievedFile?.path
                patchWaFile(entryId, {
                  status: 'cancelled',
                  notice: kept
                    ? `Cancelled. Local file kept${entry.path ? ` at ${entry.path}` : ''}.`
                    : 'Cancelled.'
                })
                workingContextRef.current = {
                  ...workingContextRef.current,
                  pendingAttach: null,
                  updatedAt: Date.now()
                }
                return
              }
              if (entry.status !== 'ready' || !entry.path) return
              if (action.type === 'open') {
                const err = await window.miko.openLocalFile(entry.path)
                pushEntry({ id: 0, kind: 'note', text: err || `Opened “${entry.filename}”.` })
                return
              }
              if (action.type === 'reveal') {
                const ok = await window.miko.revealFile(entry.path)
                pushEntry({ id: 0, kind: 'note', text: ok ? 'Showing it in Finder.' : 'That file isn’t on disk.' })
                return
              }
              if (action.type === 'copy-file') {
                const copied = await window.miko.clipboardFile(entry.path)
                pushEntry({
                  id: 0,
                  kind: 'note',
                  text: copied.verified
                    ? `Copied “${entry.filename}” as a file (not just the name).`
                    : copied.reason || 'Clipboard didn’t accept a file reference.'
                })
                return
              }
              if (action.type === 'copy-filename') {
                const ok = await window.miko.copyText(entry.filename)
                pushEntry({ id: 0, kind: 'note', text: ok ? 'Copied the filename.' : 'Couldn’t copy the filename.' })
                return
              }
              if (action.type === 'copy-path') {
                const ok = await window.miko.copyText(entry.path)
                pushEntry({ id: 0, kind: 'note', text: ok ? 'Copied the path.' : 'Couldn’t copy the path.' })
                return
              }
              if (action.type === 'attach-here' || action.type === 'attach-elsewhere') {
                const token = attachmentToken.current
                await attachRetrievedFile(entry.path, entry.filename, action.type === 'attach-elsewhere', token)
              }
            })()
          }}
          onWaReply={(entryId, action) => {
            void (async () => {
              const entry = entriesRef.current.find((item) => item.id === entryId)
              if (entry?.kind !== 'wa-reply') return
              if (action.type === 'cancel') {
                if (entry.requestId) window.miko.bridgeCancel(entry.requestId)
                waReplyToken.current += 1
                window.miko.whatsappCancel()
                replaceEntry(entryId, { id: entryId, kind: 'note', text: 'WhatsApp reply cancelled. Nothing was sent.' })
                return
              }
              if (action.type === 'set-context') {
                patchWaReply(entryId, { context: action.context })
                return
              }
              if (action.type === 'set-instruction') {
                patchWaReply(entryId, { instruction: action.instruction })
                return
              }
              if (action.type === 'set-draft') {
                patchWaReply(entryId, { draft: action.draft })
                return
              }
              if (action.type === 'set-follow-up') {
                patchWaReply(entryId, { followUp: action.followUp })
                return
              }
              if (action.type === 'set-answer') {
                patchWaReply(entryId, { answer: action.answer })
                return
              }
              if (action.type === 'use-context' || action.type === 'skip-context') {
                const token = waReplyToken.current
                const locked = await recheckWhatsAppChat(entry.chatName, token)
                if (!locked.ok) {
                  if (locked.reason === 'cancelled') return
                  patchWaReply(entryId, {
                    status: 'switched',
                    pendingHeader: locked.header,
                    notice: locked.reason,
                    draft: entry.draft
                  })
                  return
                }
                const context = action.type === 'skip-context' ? '' : entry.context
                if (action.type === 'skip-context') patchWaReply(entryId, { context: '' })
                await sendWaDraft(entryId, { chatName: locked.header, instruction: entry.instruction, context })
                return
              }
              if (action.type === 'go-latest') {
                const token = waReplyToken.current
                patchWaReply(entryId, { status: 'capturing', notice: 'Scrolling to the latest messages…' })
                await presentWhatsAppContext(entryId, entry.chatName, token, true)
                return
              }
              if (action.type === 'draft') {
                await sendWaDraft(entryId, { chatName: entry.chatName, instruction: entry.instruction, context: entry.context })
                return
              }
              if (action.type === 'answer') {
                const instruction = `${entry.instruction}\n(You asked: “${entry.question ?? ''}” My answer: ${(entry.answer ?? '').trim()})`
                patchWaReply(entryId, { instruction, question: '', answer: '' })
                await sendWaDraft(entryId, { chatName: entry.chatName, instruction, context: entry.context })
                return
              }
              if (action.type === 'resolve-time') {
                const token = entry.ambiguousTimeToken || ''
                const source =
                  (entry.pendingAdditiveRefine ? entry.pendingAdditive : entry.instruction) || entry.instruction
                const choice = action.choice.trim()
                const isPreset =
                  /^keep as written$/i.test(choice) ||
                  /^\d{1,2}:\d{2}\s*(?:A\.?M\.?|P\.?M\.?)$/i.test(choice) ||
                  /^keep\s+.+/i.test(choice)
                const finalInstruction = isPreset ? applyTimeClarification(source, token, choice) : choice
                const additiveRefine = Boolean(entry.pendingAdditiveRefine && entry.draft)
                patchWaReply(entryId, {
                  instruction: additiveRefine ? entry.instruction : finalInstruction,
                  pendingAdditive: '',
                  pendingAdditiveRefine: false,
                  question: '',
                  answer: '',
                  timeChoices: [],
                  ambiguousTimeToken: '',
                  notice: ''
                })
                if (additiveRefine) {
                  const change = `Add this to the existing draft (keep prior content; integrate naturally; strip tell/say/ask framing): ${finalInstruction}`
                  await sendWaDraft(entryId, {
                    chatName: entry.chatName,
                    instruction: `${entry.instruction}; also: ${finalInstruction}`,
                    context: entry.context,
                    previous: entry.draft,
                    change,
                    pronoun: entry.pronoun
                  })
                  return
                }
                await sendWaDraft(entryId, {
                  chatName: entry.chatName,
                  instruction: finalInstruction,
                  context: entry.context,
                  pronoun: entry.pronoun
                })
                return
              }
              if (action.type === 'refine') {
                if (!entry.draft.trim()) return
                const editedLocally = Boolean(entry.insertedText && entry.draft !== entry.insertedText)
                if (editedLocally && !waOverwriteOk.current.has(entryId)) {
                  waOverwriteOk.current.add(entryId)
                  patchWaReply(entryId, {
                    followUp: action.change,
                    status: 'ready',
                    notice: 'You edited the draft in MIKO. Click refine again to overwrite it, or Retry insertion for your edit.'
                  })
                  return
                }
                waOverwriteOk.current.delete(entryId)
                if (entry.insertedText && entry.status === 'inserted') {
                  const check = await window.miko.whatsappInsert({ expectHeader: entry.chatName, text: '', mode: 'ask' })
                  if (check.status === 'has-text' && check.composerText !== entry.insertedText) {
                    patchWaReply(entryId, {
                      status: 'ready',
                      autoInsert: false,
                      notice: 'The WhatsApp message box was edited. I’ll refine the draft here only.'
                    })
                  }
                }
                await sendWaDraft(entryId, {
                  chatName: entry.chatName,
                  instruction: entry.instruction,
                  context: entry.context,
                  previous: entry.draft,
                  change: action.change
                })
                return
              }
              if (action.type === 'insert' || action.type === 'retry') {
                const token = waReplyToken.current
                const mode = action.type === 'insert' ? action.mode : 'replace'
                if (action.type === 'retry') {
                  const check = await window.miko.whatsappInsert({ expectHeader: entry.chatName, text: '', mode: 'ask' })
                  if (check.status === 'has-text' && check.composerText && check.composerText !== entry.insertedText && check.composerText !== entry.draft) {
                    patchWaReply(entryId, { status: 'choose-insert' })
                    return
                  }
                  if (check.status === 'switched') {
                    patchWaReply(entryId, { status: 'switched', pendingHeader: check.header })
                    return
                  }
                }
                await insertWaDraft(entryId, mode, token)
                return
              }
              if (action.type === 'copy') {
                const ok = await window.miko.copyText(entry.draft)
                patchWaReply(entryId, { notice: ok ? 'Draft copied.' : 'Couldn’t copy.' })
                return
              }
              if (action.type === 'return-chat') {
                await runWhatsApp(entry.chatName, entry.chatName)
                const token = waReplyToken.current
                await insertWaDraft(entryId, 'replace', token)
                return
              }
              if (action.type === 'keep-here') {
                patchWaReply(entryId, { status: 'ready', notice: 'Draft kept in MIKO. Nothing was inserted.' })
              }
            })()
          }}
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
      <div className={chromeChooser ? 'pet-slot is-motion has-chrome-chooser' : 'pet-slot is-motion'}>
        <canvas ref={canvasRef} className="motion-canvas" />
        {chromeChooser ? (
          <div
            className="chrome-profile-fan-anchor"
            style={{
              left: hit.x + hit.width / 2,
              top: Math.max(8, hit.y - 4),
              position: 'absolute',
              transform: 'translate(-50%, -100%)',
              zIndex: 20,
              pointerEvents: 'auto',
              maxWidth: 'min(420px, 92vw)'
            }}
          >
            <ChromeProfileFan
              profiles={chromeChooser.profiles}
              pendingLabel={chromeChooser.pendingUrl?.name ?? null}
              reducedMotion={reducedMotion}
              onCancel={() => {
                dismissChromeChooser()
                pendingUrlRef.current = null
                pushEntry({ id: 0, kind: 'note', text: 'Okay. Cancelled — Chrome wasn’t opened.' })
              }}
              onChoose={(directoryId, opts) => {
                const token = chromeChooser.token
                const profile = chromeChooser.profiles.find((p) => p.directoryId === directoryId)
                if (!profile) return
                void launchChromeDirectory(
                  profile.directoryId,
                  profile.displayName,
                  chromeChooser.pendingUrl?.url ?? null,
                  token,
                  opts?.always === true
                )
              }}
            />
          </div>
        ) : null}
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
