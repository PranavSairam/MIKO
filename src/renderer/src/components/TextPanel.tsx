import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import type { PetId, SavedChat } from '../../../shared/api'
import {
  prefsStoredOnlyMessage,
  prefsUpdateHelp,
  releaseLinkLabel,
  isWindowsPlatform
} from '../../../shared/platform-copy'
import { SavedChats, type SavedChatsProps } from './SavedChats'
import { FeedbackForm } from './FeedbackForm'
import { SetupTutorial } from './SetupTutorial'

export const COMMANDS_LATER = 'Commands are coming next.'

export interface PanelChoice {
  id: string
  name: string
  familiar: boolean
  /** Secondary line for WhatsApp results (last-message preview). */
  detail?: string
  kind?: 'contact' | 'group'
  exact?: boolean
}

export type VoiceHelp = 'microphone-privacy' | 'sound-input' | 'speech-language'

export type PanelEntry =
  | { id: number; kind: 'note'; text: string }
  /** Mic couldn't start or heard nothing usable: plain reason, Retry, and the settings page that fixes it. */
  | { id: number; kind: 'voice-problem'; text: string; help?: VoiceHelp }
  | {
      id: number
      kind: 'handoff'
      prompt: string
      status: 'ready' | 'copied' | 'copied-only' | 'browser-only' | 'pasted'
      detail: string
      reply?: string
      /** Saved chat name to open on handoff; '' means ChatGPT itself. */
      destination?: string
      /** 'mail': the expanded "check mail" request (no destination picker). */
      variant?: 'mail'
      /** ChatGPT's box already has text: ask Append or Replace. */
      choose?: boolean
      /** Auto-paste happened unchecked: offer the click + ⌃⌥V route. */
      pasteAgain?: boolean
    }
  | {
      id: number
      kind: 'choices'
      purpose:
        | 'open'
        | 'close'
        | 'chat'
        | 'mail-or-app'
        | 'free-text'
        | 'chat-or-whatsapp'
        | 'whatsapp'
        | 'whatsapp-forget'
        | 'close-tab'
        | 'wa-summarize-range'
        | 'wa-attachment'
        | 'wa-attach-dest'
        | 'wa-download-candidate'
        | 'chrome-fallback'
        | 'send-destination'
      text: string
      options: PanelChoice[]
      payload?: string
    }
  | { id: number; kind: 'confirm'; purpose: 'launch' | 'force' | 'quit' | 'close' | 'alias'; text: string; appId: string; name: string; alias?: string; destination?: string }
  | { id: number; kind: 'whatsapp'; text: string }
  /** Contact search returned no match; keep pending draft and ask for a corrected name. */
  | { id: number; kind: 'wa-recipient'; text: string; query: string }
  | {
      id: number
      kind: 'wa-reply'
      chatName: string
      instruction: string
      context: string
      draft: string
      /** Last text MIKO inserted; used to detect manual edits before refine overwrite. */
      insertedText: string
      status:
        | 'capturing'
        | 'review'
        | 'drafting'
        | 'question'
        | 'clarify-time'
        | 'ready'
        | 'choose-insert'
        | 'inserting'
        | 'switched'
        | 'inserted'
        | 'failed'
      autoInsert: boolean
      contextNotice: boolean
      notice?: string
      question?: string
      answer?: string
      followUp?: string
      requestId?: string
      error?: string
      pendingHeader?: string
      /** From “tell her/him/them” — used only for drafting POV. */
      pronoun?: 'him' | 'her' | 'them'
      /** Insertion result vs later observation of Send. */
      sendStatus?: 'not-sent' | 'unverified' | 'sent'
      /** Ambiguous time choices (clarify-time). */
      timeChoices?: string[]
      ambiguousTimeToken?: string
      /** Voice/typed source kept while clarifying times. */
      originalTranscript?: string
      /** Additive instruction waiting on time clarification. */
      pendingAdditive?: string
      /** True when clarifying before merging into an unsent draft. */
      pendingAdditiveRefine?: boolean
    }
  | {
      id: number
      kind: 'type-dest'
      /** Destination label shown to the owner. */
      destinationLabel: string
      draft: string
      status: 'preparing' | 'ready' | 'choose-insert' | 'inserting' | 'inserted' | 'unverified' | 'failed' | 'choose-field'
      detail: string
      literal?: boolean
      submitRequested?: boolean
      error?: string
    }
  | {
      id: number
      kind: 'gpt-mode'
      requestId: string
      text: string
      status:
        | 'preparing'
        | 'text-inserted'
        | 'submitted'
        | 'delivery-unverified'
        | 'choose-insert'
        | 'failed'
        | 'cancelled'
      detail: string
    }
  | { id: number; kind: 'closing'; appId: string; name: string; text: string }
  | {
      id: number
      kind: 'bridge'
      requestId: string
      prompt: string
      status: 'sending' | 'running' | 'done' | 'failed' | 'cancelled' | 'timeout'
      reply: string
      thread: string
      detail: string
      kept: boolean
      startedAt?: number
      /** Message number within its conversation. */
      turn?: number
      /** Set when this is a selected-text action. */
      selection?: { captureId: string; action: string; label: string; instruction: string; canReplace: boolean; app: string; text: string }
      question?: string
      after?: string
    }
  | {
      id: number
      kind: 'selection'
      captureId: string
      ok: boolean
      text: string
      app: string
      method: string
      canReplace: boolean
      reason: string
    }
  | {
      id: number
      kind: 'wa-file'
      chatName: string
      filename: string
      fileKind: string
      bytes: number
      path: string
      status: 'listing' | 'downloading' | 'ready' | 'failed' | 'cancelled'
      scopeLabel: string
      detail?: string
      verified: boolean
      attachmentId: string
      taskId: string
      notice?: string
    }

interface TextPanelProps {
  onClose: () => void
  draft?: string
  onDraft?: (value: string) => void
  replies?: string[]
  entries?: PanelEntry[]
  onSubmit?: () => void
  onUseChatGpt?: (id: number) => void
  onPasteReply?: (id: number) => void
  onChoose?: (entryId: number, appId: string) => void
  onConfirm?: (id: number) => void
  onDismiss?: (id: number) => void
  onWhatsAppCancel?: () => void
  onWhatsAppRefine?: (entryId: number) => void
  onWaRecipientRetry?: (entryId: number, query: string) => void
  onTypeDest?: (
    entryId: number,
    action: 'replace' | 'append' | 'cancel' | 'copy' | 'paste-now' | 'draft'
  ) => void
  onWaRecipientCancel?: (entryId: number) => void
  onWaReply?: (
    entryId: number,
    action:
      | { type: 'use-context' }
      | { type: 'skip-context' }
      | { type: 'go-latest' }
      | { type: 'set-context'; context: string }
      | { type: 'set-instruction'; instruction: string }
      | { type: 'set-draft'; draft: string }
      | { type: 'set-follow-up'; followUp: string }
      | { type: 'set-answer'; answer: string }
      | { type: 'draft' }
      | { type: 'refine'; change: string }
      | { type: 'answer' }
      | { type: 'resolve-time'; choice: string }
      | { type: 'insert'; mode: 'replace' | 'append' }
      | { type: 'retry' }
      | { type: 'copy' }
      | { type: 'cancel' }
      | { type: 'return-chat' }
      | { type: 'keep-here' }
      | { type: 'report' }
  ) => void
  onWaFile?: (
    entryId: number,
    action:
      | { type: 'open' }
      | { type: 'reveal' }
      | { type: 'copy-file' }
      | { type: 'copy-filename' }
      | { type: 'copy-path' }
      | { type: 'attach-here' }
      | { type: 'attach-elsewhere' }
      | { type: 'cancel' }
  ) => void
  listening?: boolean
  listenDetail?: string
  onListen?: () => void
  /** Opens the Windows/macOS settings page that fixes a voice problem. */
  onVoiceHelp?: (help: VoiceHelp) => void
  onListenStop?: () => void
  onListenCancel?: () => void
  canSpeak?: boolean
  onSpeak?: (text: string) => void
  /** 'chats' swaps the conversation for the Saved chats manager; 'feedback' is the private report form; 'setup' is first-run / tutorial. */
  view?: 'log' | 'chats' | 'prefs' | 'feedback' | 'setup'
  onView?: (view: 'log' | 'chats' | 'prefs' | 'feedback' | 'setup') => void
  setup?: {
    platform: string
    pets?: ReactNode
    onOpenInteractiveGpt?: () => void
  }
  feedback?: {
    lastCommand: string
    actionType?: string | null
    errorCode?: string | null
  }
  chats?: SavedChat[]
  chatTools?: Omit<SavedChatsProps, 'chats'>
  onDestination?: (id: number, name: string) => void
  onInsertChoice?: (id: number, mode: 'append' | 'replace' | null) => void
  onPasteAgain?: (id: number) => void
  onSelectionAction?: (id: number, action: string, instruction: string) => void
  onUseClipboard?: () => void
  onResultCopy?: (id: number) => void
  onResultReplace?: (id: number) => void
  onResultPaste?: (id: number) => void
  onResultAnswer?: (id: number, answer: string) => void
  pasteBanner?: { entryId: number; text: string; armed: boolean } | null
  onPasteCancel?: () => void
  onBridgeCancel?: (requestId: string) => void
  onBridgeNew?: () => void
  onAskInChatGpt?: (prompt: string) => void
  assistantThread?: string
  prefs?: {
    text: string
    message: string
    onSave: (text: string) => Promise<void>
    shortcut: string
    onSaveShortcut: (value: string) => Promise<void>
    structured: import('../../../shared/preferences').MikoStructuredPreferences
    onSaveStructured: (prefs: import('../../../shared/preferences').MikoStructuredPreferences) => Promise<void>
    aliases: { alias: string; name: string }[]
    onForgetAlias: (alias: string) => Promise<void>
    examples: import('../../../shared/preferences').CorrectionExample[]
    onRemoveExample: (id: string) => Promise<void>
    onAddExample: (example: {
      wording: string
      actionKind: string
      targetAlias?: string
      note?: string
    }) => Promise<void>
    onOpenChromeChooser?: () => void
    onOpenFeedback?: () => void
    onRunTutorial?: () => void
    platform?: string
    selectionAvailable?: boolean
    pets?: PetChooserProps
    versionLine?: string
    assistantStatus?: string
    update?: {
      statusLine: string
      busy: boolean
      mode: 'manual' | 'auto'
      downloadUrl: string
      canRestart: boolean
      canDownload: boolean
      canLater: boolean
      onCheck: () => void
      onDownload: () => void
      onRestart: () => void
      onLater: () => void
      onSaveDownloadUrl: (url: string) => void
    }
  }
  /** Chat / Mail tabs. Mail content replaces the conversation. */
  tab?: 'chat' | 'mail'
  onTab?: (tab: 'chat' | 'mail') => void
  mail?: ReactNode
  /** Panel size: presets for this tab, and a drag corner on the side away from the dog. */
  sizing?: {
    side: 'left' | 'right'
    onPreset: (preset: 'small' | 'medium' | 'large' | 'reset') => void
    onResizeStart: (event: ReactPointerEvent<HTMLElement>) => void
  }
  /** Opt-in GPT Mode (ChatGPT app). Separate from MIKO assistant. */
  gptMode?: {
    phase: 'off' | 'paused' | 'active'
    banner: string
    lastDetail: string
    liveView: boolean
    detailsOpen: boolean
    onToggleDetails: () => void
    onToggle: () => void
    onPause: () => void
    onResume: () => void
    onExit: () => void
    onNewChat: () => void
    onViewChatGpt: () => void
    onToggleLiveView: () => void
    onChooseWindow: () => void
  }
  /** Optional real chatgpt.com workspace (separate session from GPT Mode / Lens). */
  onOpenChatGptWeb?: () => void
  onGptMode?: (
    entryId: number,
    action: 'replace' | 'append' | 'cancel' | 'view'
  ) => void
}

export const MAIL_NOTE =
  'ChatGPT does the checking with the mail accounts connected to your ChatGPT account. MIKO never sees your mail or the summary.'

export const ASSISTANT_NOTE =
  'Runs on Codex with your ChatGPT sign-in, in its own MIKO conversation. It can\u2019t see your ChatGPT chats, memory, files or mail. Say \u201cask GPT \u2026\u201d for your ChatGPT chats.'

export const HANDOFF_NOTE =
  'Continuing in ChatGPT uses that conversation\u2019s context and your account\u2019s memory settings. MIKO hasn\u2019t read any of it.'

export function TextPanel({
  onClose,
  draft,
  onDraft,
  replies,
  entries,
  onSubmit,
  onUseChatGpt,
  onPasteReply,
  onChoose,
  onConfirm,
  onDismiss,
  onWhatsAppCancel,
  onWhatsAppRefine,
  onWaRecipientRetry,
  onWaRecipientCancel,
  onWaReply,
  onTypeDest,
  onWaFile,
  gptMode,
  onOpenChatGptWeb,
  onGptMode,
  listening = false,
  listenDetail = '',
  onListen,
  onVoiceHelp,
  onListenStop,
  onListenCancel,
  canSpeak = false,
  onSpeak,
  view = 'log',
  onView,
  chats = [],
  chatTools,
  onDestination,
  onBridgeCancel,
  onInsertChoice,
  onPasteAgain,
  onSelectionAction,
  onUseClipboard,
  onResultCopy,
  onResultReplace,
  onResultPaste,
  onResultAnswer,
  pasteBanner,
  onPasteCancel,
  onBridgeNew,
  onAskInChatGpt,
  assistantThread = '',
  prefs,
  setup,
  feedback,
  tab = 'chat',
  onTab,
  mail,
  sizing
}: TextPanelProps) {
  const [sizeMenu, setSizeMenu] = useState(false)
  const [localDraft, setLocalDraft] = useState('')
  const [localReplies, setLocalReplies] = useState<string[]>([])
  const logRef = useRef<HTMLDivElement>(null)
  const value = draft ?? localDraft
  const notes = entries ?? (replies ?? localReplies).map((text, index) => ({ id: index, kind: 'note' as const, text }))

  useEffect(() => {
    const log = logRef.current
    if (!log) return
    // Show the start of the newest entry; a tall card (question + actions) would otherwise show only its buttons.
    const last = log.lastElementChild as HTMLElement | null
    log.scrollTop = last ? Math.max(0, last.offsetTop - log.offsetTop) : log.scrollHeight
  }, [entries, replies, localReplies])

  function setValue(next: string): void {
    if (onDraft) onDraft(next)
    else setLocalDraft(next)
  }

  function submit(): void {
    if (value.trim().length === 0) return
    if (onSubmit) onSubmit()
    else {
      setLocalReplies((items) => [...items, COMMANDS_LATER])
      setLocalDraft('')
    }
  }

  return (
    <section className={tab === 'mail' ? 'panel glass is-mail' : 'panel glass'} data-hit="panel" aria-label="Talk to MIKO">
      <header className="panel-bar">
        <h1>{view === 'chats' && tab === 'chat' ? 'Saved chats' : 'MIKO'}</h1>
        {onTab ? (
          <div className="tabs" role="tablist" aria-label="Panel">
            {(['chat', 'mail'] as const).map((t) => (
              <button
                type="button"
                role="tab"
                key={t}
                aria-selected={tab === t}
                className={tab === t ? 'tab is-on' : 'tab'}
                onClick={() => onTab(t)}
              >
                {t === 'chat' ? 'Chat' : 'Mail'}
              </button>
            ))}
          </div>
        ) : null}
        {onView && prefs && tab === 'chat' ? (
          <button
            type="button"
            className="icon-button"
            aria-label={view === 'prefs' || view === 'feedback' || view === 'setup' ? 'Back' : 'MIKO preferences'}
            title="MIKO preferences"
            onClick={() => onView(view === 'prefs' || view === 'feedback' || view === 'setup' ? 'log' : 'prefs')}
          >
            {view === 'prefs' || view === 'feedback' || view === 'setup' ? '←' : '⚙'}
          </button>
        ) : null}
        {onView && tab === 'chat' && view !== 'prefs' && view !== 'feedback' && view !== 'setup' ? (
          <button
            type="button"
            className="text-button secondary bar-button"
            onClick={() => onView(view === 'chats' ? 'log' : 'chats')}
          >
            {view === 'chats' ? 'Back' : 'Saved chats'}
          </button>
        ) : null}
        {sizing ? (
          <span className="size-control">
            <button
              type="button"
              className="icon-button"
              aria-label="Panel size"
              title="Panel size"
              aria-expanded={sizeMenu}
              onClick={() => setSizeMenu((v) => !v)}
            >
              ⤢
            </button>
            {sizeMenu ? (
              <span className="size-menu" role="menu">
                {(['small', 'medium', 'large'] as const).map((p) => (
                  <button
                    type="button"
                    role="menuitem"
                    key={p}
                    className="chip"
                    onClick={() => {
                      setSizeMenu(false)
                      sizing.onPreset(p)
                    }}
                  >
                    {p === 'small' ? 'Small' : p === 'medium' ? 'Medium' : 'Large'}
                  </button>
                ))}
                <button
                  type="button"
                  role="menuitem"
                  className="chip subtle"
                  onClick={() => {
                    setSizeMenu(false)
                    sizing.onPreset('reset')
                  }}
                >
                  Default
                </button>
                <span className="size-hint">Or drag the panel’s corner. {tab === 'mail' ? 'Mail' : 'Chat'} keeps its own size.</span>
              </span>
            ) : null}
          </span>
        ) : null}
        <div className="panel-bar-actions">
          {gptMode && tab === 'chat' ? (
            <button
              type="button"
              className={gptMode.phase !== 'off' ? 'text-button bar-button' : 'text-button secondary bar-button'}
              aria-pressed={gptMode.phase !== 'off'}
              title="GPT Mode: forward ordinary MIKO messages to the ChatGPT app (not Interactive GPT)"
              onClick={() => gptMode.onToggle()}
            >
              GPT Mode
            </button>
          ) : null}
          {onOpenChatGptWeb && tab === 'chat' ? (
            <button
              type="button"
              className="text-button secondary bar-button interactive-gpt-btn"
              title="Interactive GPT: use ChatGPT directly inside MIKO (sandboxed chatgpt.com — not GPT Mode, not Lens)"
              onClick={() => onOpenChatGptWeb()}
            >
              Interactive GPT
            </button>
          ) : null}
          <button type="button" className="close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
      </header>
      {gptMode && gptMode.phase !== 'off' && tab === 'chat' && view === 'log' ? (
        <div className="gpt-mode-banner" data-hit="gpt-mode">
          <div className="gpt-mode-banner-row">
            <strong>{gptMode.banner || 'GPT Mode'}</strong>
            <button type="button" className="text-button secondary" onClick={() => gptMode.onToggleDetails()}>
              {gptMode.detailsOpen ? 'Hide details' : 'Details'}
            </button>
          </div>
          {gptMode.detailsOpen && gptMode.lastDetail ? <p className="panel-detail note">{gptMode.lastDetail}</p> : null}
          <div className="panel-inline">
            {gptMode.phase === 'active' ? (
              <button type="button" className="text-button secondary" onClick={() => gptMode.onPause()}>
                Pause
              </button>
            ) : (
              <button type="button" className="text-button" onClick={() => gptMode.onResume()}>
                Resume
              </button>
            )}
            <button type="button" className="text-button secondary" onClick={() => gptMode.onNewChat()}>
              New chat
            </button>
            <button type="button" className="text-button secondary" onClick={() => gptMode.onViewChatGpt()}>
              View in ChatGPT
            </button>
            <button type="button" className="text-button secondary" onClick={() => gptMode.onToggleLiveView()}>
              {gptMode.liveView ? 'Hide MIKO Lens' : 'MIKO Lens'}
            </button>
            {gptMode.liveView ? (
              <button type="button" className="text-button secondary" onClick={() => gptMode.onChooseWindow()}>
                Choose window
              </button>
            ) : null}
            <button type="button" className="text-button secondary" onClick={() => gptMode.onExit()}>
              Exit
            </button>
          </div>
        </div>
      ) : null}
      {sizing ? (
        <span
          className={`resize-grip ${sizing.side === 'left' ? 'at-left' : 'at-right'}`}
          role="separator"
          aria-label="Resize panel"
          title="Drag to resize"
          onPointerDown={sizing.onResizeStart}
        />
      ) : null}
      {tab === 'mail' && mail ? (
        mail
      ) : view === 'setup' && onView ? (
        <SetupTutorial
          platform={setup?.platform || 'darwin'}
          pets={setup?.pets}
          onOpenInteractiveGpt={setup?.onOpenInteractiveGpt}
          onClose={() => onView('log')}
        />
      ) : view === 'feedback' && onView ? (
        <FeedbackForm
          lastCommand={feedback?.lastCommand || ''}
          actionType={feedback?.actionType}
          errorCode={feedback?.errorCode}
          onClose={() => onView('log')}
        />
      ) : view === 'prefs' && prefs ? (
        <Preferences {...prefs} />
      ) : view === 'chats' && chatTools ? (
        <SavedChats chats={chats} {...chatTools} />
      ) : (
      <>
      <div className="panel-log" ref={logRef} role="log" aria-live="polite" aria-label="MIKO replies">
        {notes.length === 0 ? (
          <p className="panel-empty">MIKO is listening.</p>
        ) : (
          notes.map((entry) => (
            <div className="panel-entry" key={entry.id}>
              {entry.kind === 'note' || entry.kind === 'closing' ? (
                <>
                  <p>{entry.text}</p>
                  {canSpeak && entry.kind === 'note' ? (
                    <div className="panel-inline">
                      <button type="button" className="text-button secondary" onClick={() => onSpeak?.(entry.text)}>
                        Read aloud
                      </button>
                    </div>
                  ) : null}
                </>
              ) : null}
              {entry.kind === 'voice-problem' ? (
                <>
                  <p>{entry.text}</p>
                  <div className="panel-inline">
                    {onListen ? (
                      <button type="button" className="text-button" disabled={listening} onClick={() => onListen()}>
                        Retry
                      </button>
                    ) : null}
                    {entry.help && onVoiceHelp ? (
                      <button type="button" className="text-button secondary" onClick={() => onVoiceHelp(entry.help as VoiceHelp)}>
                        {entry.help === 'microphone-privacy'
                          ? 'Microphone privacy settings'
                          : entry.help === 'sound-input'
                            ? 'Choose microphone'
                            : 'Speech settings'}
                      </button>
                    ) : null}
                  </div>
                </>
              ) : null}
              {entry.kind === 'handoff' ? (
                <>
                  <p className="prompt">{entry.prompt}</p>
                  {chats.length > 0 && entry.variant !== 'mail' ? (
                    <label className="destination">
                      Send to{' '}
                      <select
                        value={entry.destination ?? ''}
                        onChange={(event) => onDestination?.(entry.id, event.target.value)}
                      >
                        <option value="">ChatGPT</option>
                        {chats.map((chat) => (
                          <option key={chat.name} value={chat.name}>
                            {chat.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : null}
                  <p className="panel-detail">{entry.detail}</p>
                  {pasteBanner && pasteBanner.entryId === entry.id ? (
                    <div className="paste-banner" role="status">
                      <span>{pasteBanner.text}</span>
                      {pasteBanner.armed ? (
                        <button type="button" className="text-button secondary" onClick={() => onPasteCancel?.()}>
                          Cancel
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                  <p className="panel-detail note">{entry.variant === 'mail' ? MAIL_NOTE : HANDOFF_NOTE}</p>
                  {entry.reply ? <p className="pasted">{entry.reply}</p> : null}
                  <div className="panel-inline">
                    <button type="button" className="text-button" onClick={() => onUseChatGpt?.(entry.id)}>
                      {entry.variant === 'mail' ? 'Continue in ChatGPT' : 'Ask in ChatGPT'}
                    </button>
                    {entry.pasteAgain ? (
                      <button type="button" className="text-button secondary" onClick={() => onPasteAgain?.(entry.id)}>
                        Paste again
                      </button>
                    ) : null}
                    {entry.choose ? (
                      <>
                        <button type="button" className="text-button" onClick={() => onInsertChoice?.(entry.id, 'append')}>
                          Append
                        </button>
                        <button type="button" className="text-button" onClick={() => onInsertChoice?.(entry.id, 'replace')}>
                          Replace
                        </button>
                        <button type="button" className="text-button secondary" onClick={() => onInsertChoice?.(entry.id, null)}>
                          Cancel
                        </button>
                      </>
                    ) : null}
                    <button type="button" className="text-button secondary" onClick={() => onPasteReply?.(entry.id)}>
                      Paste reply
                    </button>
                  </div>
                </>
              ) : null}
              {entry.kind === 'selection' ? (
                <SelectionCard entry={entry} onAction={onSelectionAction} onUseClipboard={onUseClipboard} />
              ) : null}
              {entry.kind === 'bridge' && entry.selection ? (
                <ResultCard
                  entry={entry}
                  onCancel={onBridgeCancel}
                  onCopy={onResultCopy}
                  onReplace={onResultReplace}
                  onPaste={onResultPaste}
                  onAnswer={onResultAnswer}
                  paste={pasteBanner && pasteBanner.entryId === entry.id ? pasteBanner : null}
                  onPasteCancel={onPasteCancel}
                />
              ) : null}
              {entry.kind === 'bridge' && !entry.selection ? (
                <>
                  <p className="assistant-label">
                    MIKO assistant · {entry.thread ? `conversation ${entry.thread.slice(0, 8)}` : 'new conversation'}
                    {entry.turn && entry.turn > 1 ? ` · follow-up ${entry.turn - 1}` : ''}
                  </p>
                  <p className="prompt">{entry.prompt}</p>
                  {entry.status === 'sending' || entry.status === 'running' ? (
                    <p className="panel-detail">
                      Thinking… {entry.startedAt ? Math.floor((Date.now() - entry.startedAt) / 1000) : 0} s
                    </p>
                  ) : null}
                  {entry.status === 'done' ? <p className="assistant-reply">{entry.reply}</p> : null}
                  {entry.detail ? <p className="panel-detail">{entry.detail}</p> : null}
                  <div className="panel-inline">
                    {entry.status === 'sending' || entry.status === 'running' ? (
                      <button type="button" className="text-button secondary" onClick={() => onBridgeCancel?.(entry.requestId)}>
                        Cancel
                      </button>
                    ) : null}
                    {entry.status === 'done' && entry.thread && entry.thread === assistantThread ? (
                      <button type="button" className="text-button secondary" onClick={() => onBridgeNew?.()}>
                        New conversation
                      </button>
                    ) : null}
                    {entry.status !== 'sending' && entry.status !== 'running' ? (
                      <button type="button" className="text-button secondary" onClick={() => onAskInChatGpt?.(entry.prompt)}>
                        Ask in ChatGPT app
                      </button>
                    ) : null}
                  </div>
                  <p className="panel-detail note">{ASSISTANT_NOTE}</p>
                </>
              ) : null}
              {entry.kind === 'whatsapp' ? (
                <>
                  <p>{entry.text}</p>
                  <div className="panel-inline">
                    <button type="button" className="text-button secondary" onClick={() => onWhatsAppCancel?.()}>
                      Cancel
                    </button>
                  </div>
                </>
              ) : null}
              {entry.kind === 'wa-recipient' ? (
                <WhatsAppRecipientRetry
                  entryId={entry.id}
                  title={entry.text}
                  initialQuery={entry.query}
                  onRetry={(query) => onWaRecipientRetry?.(entry.id, query)}
                  onCancel={() => onWaRecipientCancel?.(entry.id)}
                />
              ) : null}
              {entry.kind === 'type-dest' ? (
                <div className="wa-reply">
                  <p className="panel-detail">
                    <strong>Destination:</strong> {entry.destinationLabel || 'Choose where to type'}
                  </p>
                  <p className="panel-detail">
                    {entry.status === 'preparing'
                      ? 'Preparing…'
                      : entry.status === 'inserting'
                        ? 'Inserting…'
                        : entry.status === 'inserted'
                          ? 'Inserted, not sent'
                          : entry.status === 'unverified'
                            ? 'Insertion unverified'
                            : entry.status === 'choose-insert'
                              ? 'That field already has text'
                              : entry.status === 'choose-field'
                                ? 'Click the field, then Paste now'
                                : entry.status === 'failed'
                                  ? entry.error || 'Failed'
                                  : 'Ready'}
                  </p>
                  {entry.detail ? <p className="panel-detail">{entry.detail}</p> : null}
                  {entry.draft ? <pre className="wa-reply-draft">{entry.draft}</pre> : null}
                  {entry.submitRequested ? (
                    <p className="panel-detail">Submit was requested — only available via a verified Send path. Draft left unsent.</p>
                  ) : null}
                  <div className="panel-inline">
                    {entry.status === 'choose-insert' ? (
                      <>
                        <button type="button" className="text-button" onClick={() => onTypeDest?.(entry.id, 'replace')}>
                          Replace
                        </button>
                        <button type="button" className="text-button secondary" onClick={() => onTypeDest?.(entry.id, 'append')}>
                          Append
                        </button>
                      </>
                    ) : null}
                    {entry.status === 'choose-field' || entry.status === 'ready' || entry.status === 'unverified' || entry.status === 'failed' ? (
                      <button type="button" className="text-button" onClick={() => onTypeDest?.(entry.id, 'paste-now')}>
                        Paste now
                      </button>
                    ) : null}
                    {entry.draft ? (
                      <button type="button" className="text-button secondary" onClick={() => onTypeDest?.(entry.id, 'copy')}>
                        Copy
                      </button>
                    ) : null}
                    <button type="button" className="text-button secondary" onClick={() => onTypeDest?.(entry.id, 'cancel')}>
                      Cancel
                    </button>
                  </div>
                </div>
              ) : null}
              {entry.kind === 'gpt-mode' ? (
                <div className="wa-reply gpt-mode-card">
                  <p className="panel-detail">
                    <strong>ChatGPT</strong> ·{' '}
                    {entry.status === 'preparing'
                      ? 'Preparing…'
                      : entry.status === 'text-inserted'
                        ? 'Text inserted'
                        : entry.status === 'submitted'
                          ? 'Submitted'
                          : entry.status === 'delivery-unverified'
                            ? 'Delivery unverified'
                            : entry.status === 'choose-insert'
                              ? 'Composer already has text'
                              : entry.status === 'cancelled'
                                ? 'Cancelled'
                                : 'Failed'}
                  </p>
                  {entry.detail ? <p className="panel-detail">{entry.detail}</p> : null}
                  {entry.text ? <pre className="wa-reply-draft">{entry.text}</pre> : null}
                  <div className="panel-inline">
                    {entry.status === 'choose-insert' ? (
                      <>
                        <button type="button" className="text-button" onClick={() => onGptMode?.(entry.id, 'replace')}>
                          Replace
                        </button>
                        <button type="button" className="text-button secondary" onClick={() => onGptMode?.(entry.id, 'append')}>
                          Append
                        </button>
                        <button type="button" className="text-button secondary" onClick={() => onGptMode?.(entry.id, 'cancel')}>
                          Cancel
                        </button>
                      </>
                    ) : null}
                    {entry.status === 'preparing' || entry.status === 'text-inserted' ? (
                      <button type="button" className="text-button secondary" onClick={() => onGptMode?.(entry.id, 'cancel')}>
                        Cancel
                      </button>
                    ) : null}
                    {entry.status === 'delivery-unverified' || entry.status === 'failed' || entry.status === 'submitted' ? (
                      <button type="button" className="text-button secondary" onClick={() => onGptMode?.(entry.id, 'view')}>
                        View in ChatGPT
                      </button>
                    ) : (
                      <button type="button" className="text-button secondary" onClick={() => onGptMode?.(entry.id, 'view')}>
                        View in ChatGPT
                      </button>
                    )}
                  </div>
                </div>
              ) : null}
              {entry.kind === 'wa-reply' ? <WhatsAppReplyCard entry={entry} onAction={(action) => onWaReply?.(entry.id, action)} /> : null}
              {entry.kind === 'wa-file' ? <WhatsAppFileCard entry={entry} onAction={(action) => onWaFile?.(entry.id, action)} /> : null}
              {entry.kind === 'choices' && entry.purpose === 'whatsapp' ? (
                <WhatsAppChooser
                  entryId={entry.id}
                  title={entry.text || 'Which chat did you mean?'}
                  options={entry.options}
                  onChoose={(optionId) => onChoose?.(entry.id, optionId)}
                  onCancel={() => onWhatsAppCancel?.()}
                  onRefine={() => onWhatsAppRefine?.(entry.id)}
                />
              ) : null}
              {entry.kind === 'choices' && entry.purpose !== 'whatsapp' ? (
                <>
                  <p>{entry.text}</p>
                  <div className="panel-inline">
                    {entry.options.map((option) => (
                      <button
                        type="button"
                        className="text-button"
                        key={option.id}
                        onClick={() => onChoose?.(entry.id, option.id)}
                      >
                        {option.name}
                      </button>
                    ))}
                  </div>
                </>
              ) : null}
              {entry.kind === 'confirm' ? (
                <>
                  <p>{entry.text}</p>
                  <div className="panel-inline">
                    <button type="button" className="text-button" onClick={() => onConfirm?.(entry.id)}>
                      {entry.purpose === 'force'
                        ? 'Force quit'
                        : entry.purpose === 'quit'
                          ? 'Quit MIKO'
                          : entry.purpose === 'close'
                            ? `Close ${entry.name}`
                            : entry.purpose === 'alias'
                              ? 'Remember'
                              : `Launch ${entry.name}`}
                    </button>
                    <button type="button" className="text-button secondary" onClick={() => onDismiss?.(entry.id)}>
                      Not now
                    </button>
                  </div>
                </>
              ) : null}
            </div>
          ))
        )}
      </div>
      <textarea
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' || event.shiftKey) return
          event.preventDefault()
          submit()
        }}
        placeholder="Say something…"
        maxLength={400}
        spellCheck={false}
        autoFocus
        aria-label="Message"
      />
      {listening ? (
        <div className="listen-bar" role="status">
          <span>{listenDetail || 'Listening…'}</span>
          <button type="button" className="text-button" onClick={onListenStop}>
            Stop
          </button>
          <button type="button" className="text-button secondary" onClick={onListenCancel}>
            Cancel
          </button>
        </div>
      ) : null}
      <div className="panel-actions">
        <button
          type="button"
          className={listening ? 'mic is-live' : 'mic'}
          aria-pressed={listening}
          aria-label={listening ? 'Listening' : 'Microphone'}
          onClick={onListen}
          disabled={listening}
        >
          Mic
        </button>
        <button type="button" className="send" onClick={submit} disabled={value.trim().length === 0}>
          Send
        </button>
      </div>
      </>
      )}
    </section>
  )
}

type PrefsProps = NonNullable<
  {
    text: string
    message: string
    onSave: (text: string) => Promise<void>
    shortcut: string
    onSaveShortcut: (value: string) => Promise<void>
    structured: import('../../../shared/preferences').MikoStructuredPreferences
    onSaveStructured: (prefs: import('../../../shared/preferences').MikoStructuredPreferences) => Promise<void>
    aliases: { alias: string; name: string }[]
    onForgetAlias: (alias: string) => Promise<void>
    examples: import('../../../shared/preferences').CorrectionExample[]
    onRemoveExample: (id: string) => Promise<void>
    onAddExample: (example: {
      wording: string
      actionKind: string
      targetAlias?: string
      note?: string
    }) => Promise<void>
    onOpenChromeChooser?: () => void
    onOpenFeedback?: () => void
    onRunTutorial?: () => void
    platform?: string
    selectionAvailable?: boolean
    versionLine?: string
    assistantStatus?: string
    update?: {
      statusLine: string
      busy: boolean
      mode: 'manual' | 'auto'
      downloadUrl: string
      canRestart: boolean
      canDownload: boolean
      canLater: boolean
      onCheck: () => void
      onDownload: () => void
      onRestart: () => void
      onLater: () => void
      onSaveDownloadUrl: (url: string) => void
    }
    /** Choose your pet: only pets whose assets exist are listed. */
    pets?: PetChooserProps
  }
>

export interface PetChooserProps {
  available: { id: PetId; name: string; blurb: string }[]
  selected: PetId
  busy: PetId | null
  message: string
  thumbs: Partial<Record<PetId, string>>
  /** Bumped to scroll the chooser into view (paw menu, "change pet"). */
  focus: number
  onChoose: (id: PetId) => void
}

export function PetChooser({
  available,
  selected,
  busy,
  message,
  thumbs,
  focus,
  onChoose
}: PetChooserProps) {
  const ref = useRef<HTMLElement>(null)
  useEffect(() => {
    if (focus > 0) ref.current?.scrollIntoView({ block: 'start', behavior: 'smooth' })
  }, [focus])
  return (
    <section className="pet-chooser" ref={ref} aria-label="Choose your pet">
      <p className="prefs-section">Choose your pet</p>
      <div className="pet-grid" role="radiogroup" aria-label="Pet">
        {available.map((pet) => {
          const on = pet.id === selected
          const loading = busy === pet.id
          return (
            <button
              type="button"
              role="radio"
              aria-checked={on}
              key={pet.id}
              className={`pet-card${on ? ' is-on' : ''}${loading ? ' is-loading' : ''}`}
              disabled={busy !== null}
              onClick={() => onChoose(pet.id)}
              title={pet.blurb}
            >
              <span className="pet-portrait">
                {thumbs[pet.id] ? <img src={thumbs[pet.id]} alt="" draggable={false} /> : <span className="pet-portrait-wait" aria-hidden="true" />}
                {on ? <span className="pet-check" aria-hidden="true">✓</span> : null}
              </span>
              <span className="pet-name">{pet.name}</span>
              <span className="pet-blurb">{loading ? 'Loading…' : pet.blurb}</span>
            </button>
          )
        })}
      </div>
      <p className="pet-note" role="status">
        {message || 'Switching keeps MIKO where it is, and keeps your drafts and anything in progress. Or say “switch to the cat”.'}
      </p>
    </section>
  )
}

function Preferences({
  text,
  message,
  onSave,
  shortcut,
  onSaveShortcut,
  structured,
  onSaveStructured,
  aliases,
  onForgetAlias,
  examples,
  onRemoveExample,
  onAddExample,
  onOpenChromeChooser,
  onOpenFeedback,
  onRunTutorial,
  platform = 'darwin',
  selectionAvailable = true,
  versionLine,
  assistantStatus,
  update,
  pets
}: PrefsProps) {
  const [draft, setDraft] = useState(text)
  const [key, setKey] = useState(shortcut)
  const [browser, setBrowser] = useState(structured.preferredBrowser ?? 'default')
  const [tone, setTone] = useState(structured.writingTone ?? 'natural')
  const [language, setLanguage] = useState(structured.preferredLanguage ?? '')
  const [notes, setNotes] = useState(structured.notes ?? '')
  const [exWording, setExWording] = useState('')
  const [exKind, setExKind] = useState('open_whatsapp_chat')
  const [exAlias, setExAlias] = useState('')
  const [releaseUrl, setReleaseUrl] = useState(update?.downloadUrl ?? '')

  useEffect(() => {
    setDraft(text)
  }, [text])
  useEffect(() => {
    setBrowser(structured.preferredBrowser ?? 'default')
    setTone(structured.writingTone ?? 'natural')
    setLanguage(structured.preferredLanguage ?? '')
    setNotes(structured.notes ?? '')
  }, [structured])
  useEffect(() => {
    setReleaseUrl(update?.downloadUrl ?? '')
  }, [update?.downloadUrl])

  return (
    <div className="prefs">
      {pets ? <PetChooser {...pets} /> : null}
      <p className="panel-detail">
        <strong>MIKO preferences</strong> — {prefsStoredOnlyMessage(platform).replace(/^MIKO preferences — /, '')}
      </p>
      {versionLine ? <p className="panel-detail">{versionLine}</p> : null}
      {assistantStatus ? <p className="panel-detail">{assistantStatus}</p> : null}
      {onRunTutorial ? (
        <div className="panel-inline">
          <button type="button" className="text-button secondary" onClick={onRunTutorial}>
            Run tutorial again
          </button>
        </div>
      ) : null}
      {update ? (
        <>
          <p className="prefs-section">Updates (private beta)</p>
          <p className="panel-detail">{update.statusLine}</p>
          <div className="panel-inline">
            <button type="button" className="text-button secondary" disabled={update.busy} onClick={update.onCheck}>
              Check for updates
            </button>
            {update.canDownload ? (
              <button type="button" className="text-button" disabled={update.busy} onClick={update.onDownload}>
                Download latest version
              </button>
            ) : null}
            {update.canRestart ? (
              <button type="button" className="text-button" onClick={update.onRestart}>
                Restart now
              </button>
            ) : null}
            {update.canLater ? (
              <button type="button" className="text-button secondary" onClick={update.onLater}>
                Later
              </button>
            ) : null}
          </div>
          {update.mode === 'manual' ? (
            <label className="prefs-field">
              {releaseLinkLabel(platform)}
              <input
                value={releaseUrl}
                aria-label="Shared release download URL"
                placeholder="https://…"
                onChange={(e) => setReleaseUrl(e.target.value)}
                onBlur={() => update.onSaveDownloadUrl(releaseUrl.trim())}
              />
            </label>
          ) : null}
          <p className="panel-detail">{prefsUpdateHelp(platform, update.mode)}</p>
        </>
      ) : null}
      {onOpenFeedback ? (
        <div className="panel-inline">
          <button type="button" className="text-button" onClick={onOpenFeedback}>
            Feedback
          </button>
        </div>
      ) : null}

      <p className="prefs-section">Structured</p>
      <label className="prefs-field">
        Preferred browser
        <select
          value={browser || 'default'}
          aria-label="Preferred browser"
          onChange={(e) => setBrowser(e.target.value as 'chrome' | 'safari' | 'default')}
        >
          <option value="default">System default</option>
          <option value="chrome">Chrome</option>
          <option value="safari">Safari</option>
        </select>
      </label>
      <label className="prefs-field">
        Writing tone
        <select
          value={tone || 'natural'}
          aria-label="Writing tone"
          onChange={(e) => setTone(e.target.value as 'natural' | 'formal' | 'friendly' | 'polite')}
        >
          <option value="natural">Natural</option>
          <option value="formal">Formal</option>
          <option value="friendly">Friendly</option>
          <option value="polite">Polite</option>
        </select>
      </label>
      <label className="prefs-field">
        Preferred language
        <input
          value={language}
          maxLength={40}
          placeholder="e.g. English"
          aria-label="Preferred language"
          onChange={(e) => setLanguage(e.target.value)}
        />
      </label>
      <label className="prefs-field">
        Approved notes
        <textarea
          className="prefs-notes"
          value={notes}
          maxLength={2000}
          placeholder="Short approved notes (not raw chat or mail bodies)."
          aria-label="Approved preference notes"
          onChange={(e) => setNotes(e.target.value)}
        />
      </label>
      <div className="panel-inline">
        <button
          type="button"
          className="text-button"
          onClick={() =>
            void onSaveStructured({
              preferredBrowser: browser === 'default' ? null : browser,
              writingTone: tone,
              preferredLanguage: language.trim() || null,
              notes: notes.slice(0, 2000),
              defaultChromeProfileDirectory: structured.defaultChromeProfileDirectory,
              defaultChromeProfileName: structured.defaultChromeProfileName,
              chromeProfileAliases: structured.chromeProfileAliases
            })
          }
        >
          Save structured
        </button>
      </div>

      <p className="prefs-section">Chrome profile default</p>
      <p className="panel-detail">
        {structured.defaultChromeProfileDirectory
          ? `Saved default: “${structured.defaultChromeProfileName || structured.defaultChromeProfileDirectory}” (${structured.defaultChromeProfileDirectory}). “Choose Chrome profile” always shows the fan. Say “Open Chrome with …” to override.`
          : 'No Chrome profile default saved. MIKO never auto-saves one — tick “Always use …” on the profile fan when choosing.'}
      </p>
      <div className="panel-inline">
        <button
          type="button"
          className="text-button secondary"
          disabled={!structured.defaultChromeProfileDirectory}
          onClick={() =>
            void onSaveStructured({
              preferredBrowser: browser === 'default' ? null : (browser as 'chrome' | 'safari'),
              writingTone: tone,
              preferredLanguage: language.trim() || null,
              notes: notes.slice(0, 2000),
              defaultChromeProfileDirectory: null,
              defaultChromeProfileName: null,
              chromeProfileAliases: structured.chromeProfileAliases
            })
          }
        >
          Clear Chrome default
        </button>
        {onOpenChromeChooser ? (
          <button type="button" className="text-button secondary" onClick={onOpenChromeChooser}>
            Reopen Chrome chooser
          </button>
        ) : null}
      </div>

      <p className="prefs-section">Free-text (assistant conversations)</p>
      <textarea
        className="prefs-text"
        value={draft}
        maxLength={2000}
        placeholder="e.g. Call me Pranav. Keep answers short. I'm building MIKO, a desktop dog."
        aria-label="MIKO free-text preferences"
        onChange={(event) => setDraft(event.target.value)}
      />
      <div className="panel-inline">
        <button type="button" className="text-button" onClick={() => void onSave(draft)} disabled={draft === text}>
          Save free-text
        </button>
        <span className="panel-detail">{draft.length}/2000</span>
      </div>

      <p className="prefs-section">WhatsApp aliases</p>
      {aliases.length === 0 ? (
        <p className="panel-detail">No aliases saved.</p>
      ) : (
        <ul className="prefs-list">
          {aliases.map((a) => (
            <li key={a.alias}>
              <span>
                {a.alias} → {a.name}
              </span>
              <button type="button" className="text-button secondary" onClick={() => void onForgetAlias(a.alias)}>
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}

      <p className="prefs-section">Approved correction examples</p>
      <p className="panel-detail">Optional routing hints for unfamiliar wording. Not private message content.</p>
      {examples.length === 0 ? (
        <p className="panel-detail">No examples yet.</p>
      ) : (
        <ul className="prefs-list">
          {examples.map((ex) => (
            <li key={ex.id}>
              <span>
                “{ex.wording}” → {ex.actionKind}
                {ex.targetAlias ? ` (${ex.targetAlias})` : ''}
              </span>
              <button type="button" className="text-button secondary" onClick={() => void onRemoveExample(ex.id)}>
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="prefs-add-example">
        <input value={exWording} placeholder="When I say…" aria-label="Example wording" onChange={(e) => setExWording(e.target.value)} />
        <input value={exKind} placeholder="action kind" aria-label="Example action kind" onChange={(e) => setExKind(e.target.value)} />
        <input value={exAlias} placeholder="target alias (optional)" aria-label="Example target alias" onChange={(e) => setExAlias(e.target.value)} />
        <button
          type="button"
          className="text-button"
          disabled={!exWording.trim() || !exKind.trim()}
          onClick={() => {
            void onAddExample({
              wording: exWording.trim(),
              actionKind: exKind.trim(),
              targetAlias: exAlias.trim() || undefined
            })
            setExWording('')
            setExAlias('')
          }}
        >
          Add example
        </button>
      </div>

      {message ? (
        <p className="panel-detail" role="status">
          {message}
        </p>
      ) : null}

      {selectionAvailable && !isWindowsPlatform(platform) ? (
        <>
          <p className="prefs-section">Selection shortcut</p>
          <div className="selection-row">
            <input value={key} aria-label="Selection assistant shortcut" placeholder="Control+Option+S" onChange={(e) => setKey(e.target.value)} />
            <button type="button" className="text-button secondary" disabled={!key.trim() || key === shortcut} onClick={() => void onSaveShortcut(key)}>
              Set selection shortcut
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="prefs-section">Selection shortcut</p>
          <p className="panel-detail">Selected-text capture is available on macOS only.</p>
        </>
      )}
    </div>
  )
}

type SelectionEntry = Extract<PanelEntry, { kind: 'selection' }>
type BridgeEntry = Extract<PanelEntry, { kind: 'bridge' }>

function SelectionCard({
  entry,
  onAction,
  onUseClipboard
}: {
  entry: SelectionEntry
  onAction?: (id: number, action: string, instruction: string) => void
  onUseClipboard?: () => void
}) {
  const [tone, setTone] = useState('')
  const [reply, setReply] = useState('')
  const [ask, setAsk] = useState('')
  if (!entry.ok) {
    return (
      <>
        <p className="assistant-label">Selected text</p>
        <p>{entry.reason}</p>
        <div className="panel-inline">
          <button type="button" className="text-button" onClick={() => onUseClipboard?.()}>
            Use clipboard text
          </button>
        </div>
      </>
    )
  }
  const via = entry.method === 'ax' ? 'read via Accessibility' : entry.method === 'copy' ? 'copied with ⌘C' : 'from the clipboard'
  return (
    <>
      <p className="assistant-label">
        Selected in {entry.app} · {via}
        {entry.canReplace ? '' : ' · replace not available'}
      </p>
      <blockquote className="selection-quote">{entry.text}</blockquote>
      <div className="panel-inline wrap">
        {(['grammar', 'summarize', 'explain'] as const).map((a) => (
          <button type="button" key={a} className="text-button" onClick={() => onAction?.(entry.id, a, '')}>
            {a === 'grammar' ? 'Fix grammar' : a === 'summarize' ? 'Summarize' : 'Explain'}
          </button>
        ))}
      </div>
      <div className="selection-row">
        <input value={tone} placeholder="Tone, e.g. friendly" aria-label="Rewrite tone" onChange={(e) => setTone(e.target.value)} />
        <button type="button" className="text-button" disabled={!tone.trim()} onClick={() => onAction?.(entry.id, 'rewrite', tone)}>
          Rewrite
        </button>
      </div>
      <div className="selection-row">
        <input value={reply} placeholder="Reply saying…" aria-label="Reply instruction" onChange={(e) => setReply(e.target.value)} />
        <button type="button" className="text-button" disabled={!reply.trim()} onClick={() => onAction?.(entry.id, 'reply', reply)}>
          Draft reply
        </button>
      </div>
      <div className="selection-row">
        <input value={ask} placeholder="Ask about it (optional)" aria-label="Question about the text" onChange={(e) => setAsk(e.target.value)} />
        <button type="button" className="text-button secondary" onClick={() => onAction?.(entry.id, 'ask', ask)}>
          Start conversation
        </button>
      </div>
    </>
  )
}

function ResultCard({
  entry,
  onCancel,
  onCopy,
  onReplace,
  onPaste,
  onAnswer,
  paste,
  onPasteCancel
}: {
  entry: BridgeEntry
  onCancel?: (requestId: string) => void
  onCopy?: (id: number) => void
  onReplace?: (id: number) => void
  onPaste?: (id: number) => void
  onAnswer?: (id: number, answer: string) => void
  paste: { text: string; armed: boolean } | null
  onPasteCancel?: () => void
}) {
  const [answer, setAnswer] = useState('')
  const sel = entry.selection as NonNullable<BridgeEntry['selection']>
  const pending = entry.status === 'sending' || entry.status === 'running'
  return (
    <>
      <p className="assistant-label">
        MIKO assistant · {sel.label} · text from {sel.app}
      </p>
      {sel.instruction ? <p className="panel-detail">Your instruction: {sel.instruction}</p> : null}
      {pending ? (
        <p className="panel-detail">Thinking… {entry.startedAt ? Math.floor((Date.now() - entry.startedAt) / 1000) : 0} s</p>
      ) : null}
      {entry.question ? (
        <>
          <p className="panel-detail">MIKO needs one detail first:</p>
          <p className="assistant-reply">{entry.question}</p>
          <div className="selection-row">
            <input value={answer} placeholder="Your answer" aria-label="Answer" onChange={(e) => setAnswer(e.target.value)} />
            <button type="button" className="text-button" disabled={!answer.trim()} onClick={() => onAnswer?.(entry.id, answer)}>
              Answer
            </button>
          </div>
        </>
      ) : entry.status === 'done' ? (
        <p className="assistant-reply result">{entry.reply}</p>
      ) : null}
      {entry.detail ? <p className="panel-detail">{entry.detail}</p> : null}
      {entry.after ? <p className="panel-detail" role="status">{entry.after}</p> : null}
      {paste ? (
        <div className="paste-banner" role="status">
          <span>{paste.text}</span>
          {paste.armed ? (
            <button type="button" className="text-button secondary" onClick={() => onPasteCancel?.()}>
              Cancel
            </button>
          ) : null}
        </div>
      ) : null}
      <div className="panel-inline wrap">
        {pending ? (
          <button type="button" className="text-button secondary" onClick={() => onCancel?.(entry.requestId)}>
            Cancel
          </button>
        ) : null}
        {entry.status === 'done' && !entry.question ? (
          <>
            <button type="button" className="text-button" onClick={() => onCopy?.(entry.id)}>
              Copy
            </button>
            {sel.canReplace ? (
              <button type="button" className="text-button" onClick={() => onReplace?.(entry.id)}>
                Replace selection
              </button>
            ) : null}
            <button type="button" className="text-button secondary" onClick={() => onPaste?.(entry.id)}>
              Paste where I click
            </button>
          </>
        ) : null}
      </div>
    </>
  )
}

function formatFileBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '—'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10_240 ? 1 : 0)} KB`
  return `${(n / (1024 * 1024)).toFixed(n < 10_485_760 ? 1 : 0)} MB`
}

function WhatsAppFileCard({
  entry,
  onAction
}: {
  entry: Extract<PanelEntry, { kind: 'wa-file' }>
  onAction: (
    action:
      | { type: 'open' }
      | { type: 'reveal' }
      | { type: 'copy-file' }
      | { type: 'copy-filename' }
      | { type: 'copy-path' }
      | { type: 'attach-here' }
      | { type: 'attach-elsewhere' }
      | { type: 'cancel' }
  ) => void
}): ReactNode {
  const busy = entry.status === 'listing' || entry.status === 'downloading'
  return (
    <div className="wa-file">
      <p className="wa-file-name">{entry.filename || 'Attachment'}</p>
      <p className="panel-detail">
        {entry.fileKind ? entry.fileKind.toUpperCase() : 'FILE'}
        {' · '}
        {formatFileBytes(entry.bytes)}
        {' · '}
        {entry.chatName || 'WhatsApp'}
      </p>
      <p className="panel-detail">{entry.scopeLabel}</p>
      <p className="panel-detail" role="status">
        {entry.status === 'listing'
          ? 'Looking for attachments…'
          : entry.status === 'downloading'
            ? 'Saving to Downloads…'
            : entry.status === 'ready'
              ? entry.verified
                ? `Downloaded — verified on disk${entry.detail ? ` (${entry.detail})` : ''}.`
                : 'File ready.'
              : entry.status === 'cancelled'
                ? entry.notice || 'Cancelled.'
                : entry.notice || 'Couldn’t retrieve that file.'}
      </p>
      {entry.notice && entry.status === 'ready' ? <p className="panel-detail">{entry.notice}</p> : null}
      <div className="panel-inline wrap">
        {busy || entry.status === 'ready' ? (
          <button type="button" className="text-button secondary" onClick={() => onAction({ type: 'cancel' })}>
            Cancel
          </button>
        ) : null}
        {entry.status === 'ready' && entry.path ? (
          <>
            <button type="button" className="text-button" onClick={() => onAction({ type: 'open' })}>
              Open
            </button>
            <button type="button" className="text-button" onClick={() => onAction({ type: 'reveal' })}>
              {/win/i.test(navigator.platform) ? 'Show in File Explorer' : 'Show in Finder'}
            </button>
            <button type="button" className="text-button" onClick={() => onAction({ type: 'copy-file' })}>
              Copy file
            </button>
            <button type="button" className="text-button secondary" onClick={() => onAction({ type: 'copy-filename' })}>
              Copy filename
            </button>
            <button type="button" className="text-button secondary" onClick={() => onAction({ type: 'copy-path' })}>
              Copy path
            </button>
            <button type="button" className="text-button" onClick={() => onAction({ type: 'attach-here' })}>
              Attach it here
            </button>
            <button type="button" className="text-button secondary" onClick={() => onAction({ type: 'attach-elsewhere' })}>
              Attach elsewhere…
            </button>
          </>
        ) : null}
      </div>
      <p className="panel-detail note">Downloading doesn’t send the document to the assistant. Ask separately to read or summarize it.</p>
    </div>
  )
}

function WhatsAppReplyCard({
  entry,
  onAction
}: {
  entry: Extract<PanelEntry, { kind: 'wa-reply' }>
  onAction: (
    action:
      | { type: 'use-context' }
      | { type: 'skip-context' }
      | { type: 'go-latest' }
      | { type: 'set-context'; context: string }
      | { type: 'set-instruction'; instruction: string }
      | { type: 'set-draft'; draft: string }
      | { type: 'set-follow-up'; followUp: string }
      | { type: 'set-answer'; answer: string }
      | { type: 'draft' }
      | { type: 'refine'; change: string }
      | { type: 'answer' }
      | { type: 'resolve-time'; choice: string }
      | { type: 'insert'; mode: 'replace' | 'append' }
      | { type: 'retry' }
      | { type: 'copy' }
      | { type: 'cancel' }
      | { type: 'return-chat' }
      | { type: 'keep-here' }
      | { type: 'report' }
  ) => void
}): ReactNode {
  return (
    <div className="wa-reply">
      <p className="wa-chooser-title">Replying to {entry.chatName || '…'}</p>
      {entry.status === 'capturing' ? <p className="panel-detail">Preparing draft…</p> : null}
      {entry.status === 'drafting' ? <p className="panel-detail">Preparing draft…</p> : null}
      {entry.status === 'inserting' ? <p className="panel-detail">Inserting…</p> : null}
      {entry.notice && entry.status !== 'choose-insert' && entry.status !== 'inserted' ? (
        <p className="panel-detail note">{entry.notice}</p>
      ) : null}
      {entry.status === 'capturing' || entry.status === 'drafting' ? (
        <p>{entry.status === 'capturing' ? 'Reading the open WhatsApp chat…' : 'Drafting…'}</p>
      ) : null}
      {entry.status === 'review' ? (
        <>
          {entry.contextNotice ? (
            <p className="panel-detail note">
              Before the first draft: the chat text below is sent to MIKO’s assistant (ChatGPT via Codex). Edit or clear it if you don’t want something included.
            </p>
          ) : null}
          <label className="wa-reply-label" htmlFor={`wa-ctx-${entry.id}`}>
            Visible chat context
          </label>
          <textarea
            id={`wa-ctx-${entry.id}`}
            className="wa-reply-area"
            rows={6}
            value={entry.context}
            onChange={(e) => onAction({ type: 'set-context', context: e.target.value })}
          />
          <label className="wa-reply-label" htmlFor={`wa-ins-${entry.id}`}>
            Instruction
          </label>
          <textarea
            id={`wa-ins-${entry.id}`}
            className="wa-reply-area"
            rows={2}
            value={entry.instruction}
            onChange={(e) => onAction({ type: 'set-instruction', instruction: e.target.value })}
          />
          <div className="panel-inline">
            <button type="button" className="text-button" onClick={() => onAction({ type: 'use-context' })}>
              Use visible messages
            </button>
            <button type="button" className="text-button secondary" onClick={() => onAction({ type: 'go-latest' })}>
              Go to latest
            </button>
            <button type="button" className="text-button secondary" onClick={() => onAction({ type: 'skip-context' })}>
              Draft without chat context
            </button>
            <button type="button" className="text-button secondary" onClick={() => onAction({ type: 'cancel' })}>
              Cancel
            </button>
          </div>
        </>
      ) : null}
      {entry.status === 'question' ? (
        <>
          <p>{entry.question}</p>
          <input
            value={entry.answer ?? ''}
            placeholder="Your answer"
            aria-label="Answer"
            onChange={(e) => onAction({ type: 'set-answer', answer: e.target.value })}
          />
          <div className="panel-inline">
            <button type="button" className="text-button" disabled={!entry.answer?.trim()} onClick={() => onAction({ type: 'answer' })}>
              Answer and draft
            </button>
            <button type="button" className="text-button secondary" onClick={() => onAction({ type: 'cancel' })}>
              Cancel
            </button>
          </div>
        </>
      ) : null}
      {entry.status === 'clarify-time' ? (
        <>
          <p>{entry.question}</p>
          {entry.originalTranscript ? (
            <p className="panel-detail note">Original: {entry.originalTranscript}</p>
          ) : null}
          <div className="panel-inline wrap">
            {(entry.timeChoices ?? []).map((choice) => (
              <button
                key={choice}
                type="button"
                className="text-button secondary"
                onClick={() => onAction({ type: 'resolve-time', choice })}
              >
                {choice}
              </button>
            ))}
          </div>
          <input
            value={entry.answer ?? ''}
            placeholder="Or type the intended times…"
            aria-label="Custom time clarification"
            onChange={(e) => onAction({ type: 'set-answer', answer: e.target.value })}
          />
          <div className="panel-inline">
            <button
              type="button"
              className="text-button"
              disabled={!entry.answer?.trim()}
              onClick={() => onAction({ type: 'resolve-time', choice: entry.answer?.trim() || '' })}
            >
              Use this
            </button>
            <button type="button" className="text-button secondary" onClick={() => onAction({ type: 'cancel' })}>
              Cancel
            </button>
          </div>
        </>
      ) : null}
      {entry.status === 'choose-insert' ? (
        <>
          <p className="panel-detail">Draft ready — waiting for Replace / Append / Cancel.</p>
          <p>WhatsApp’s message box already has text. Replace it, append the draft, or cancel?</p>
          <pre className="wa-reply-draft">{entry.draft}</pre>
          <div className="panel-inline">
            <button type="button" className="text-button" onClick={() => onAction({ type: 'insert', mode: 'replace' })}>
              Replace
            </button>
            <button type="button" className="text-button" onClick={() => onAction({ type: 'insert', mode: 'append' })}>
              Append
            </button>
            <button type="button" className="text-button secondary" onClick={() => onAction({ type: 'cancel' })}>
              Cancel
            </button>
          </div>
        </>
      ) : null}
      {entry.status === 'switched' ? (
        <>
          <p>
            You switched chats while I drafted. The draft was for “{entry.chatName}”
            {entry.pendingHeader ? `; WhatsApp is on “${entry.pendingHeader}”` : ''}. Return to the original chat to insert it?
          </p>
          <pre className="wa-reply-draft">{entry.draft}</pre>
          <div className="panel-inline">
            <button type="button" className="text-button" onClick={() => onAction({ type: 'return-chat' })}>
              Open {entry.chatName}
            </button>
            <button type="button" className="text-button secondary" onClick={() => onAction({ type: 'keep-here' })}>
              Keep draft here
            </button>
            <button type="button" className="text-button secondary" onClick={() => onAction({ type: 'copy' })}>
              Copy
            </button>
          </div>
        </>
      ) : null}
      {(entry.status === 'ready' || entry.status === 'inserted' || entry.status === 'failed') && entry.draft ? (
        <>
          {entry.status === 'ready' ? <p className="panel-detail">Draft ready.</p> : null}
          {entry.status === 'inserted' ? (
            <p className="panel-detail">
              {entry.sendStatus === 'sent'
                ? `Inserted earlier; later send observed${entry.chatName ? ` (in ${entry.chatName})` : ''}.`
                : entry.sendStatus === 'unverified'
                  ? `Inserted as a draft; current send status unverified${entry.chatName ? ` (in ${entry.chatName})` : ''}.`
                  : `Inserted — not sent${entry.chatName ? ` (in ${entry.chatName})` : ''}.`}
            </p>
          ) : null}
          {entry.status === 'failed' && entry.error ? <p className="panel-detail note">{entry.error}</p> : null}
          {entry.status === 'failed' ? (
            <div className="panel-inline">
              <button type="button" className="text-button secondary" onClick={() => onAction({ type: 'report' })}>
                Report this
              </button>
            </div>
          ) : null}
          <label className="wa-reply-label" htmlFor={`wa-draft-${entry.id}`}>
            Draft
          </label>
          <textarea
            id={`wa-draft-${entry.id}`}
            className="wa-reply-area"
            rows={5}
            value={entry.draft}
            onChange={(e) => onAction({ type: 'set-draft', draft: e.target.value })}
          />
          <div className="panel-inline">
            <button type="button" className="text-button secondary" onClick={() => onAction({ type: 'refine', change: 'shorter' })}>
              Shorter
            </button>
            <button type="button" className="text-button secondary" onClick={() => onAction({ type: 'refine', change: 'more formal' })}>
              More formal
            </button>
            <button type="button" className="text-button secondary" onClick={() => onAction({ type: 'copy' })}>
              Copy
            </button>
            {entry.status === 'failed' || entry.status === 'ready' ? (
              <button type="button" className="text-button" onClick={() => onAction({ type: 'retry' })}>
                {entry.insertedText ? 'Retry insertion' : 'Insert'}
              </button>
            ) : (
              <button type="button" className="text-button" onClick={() => onAction({ type: 'retry' })}>
                Retry insertion
              </button>
            )}
            <button type="button" className="text-button secondary" onClick={() => onAction({ type: 'cancel' })}>
              Cancel
            </button>
          </div>
          <div className="panel-inline wrap">
            <input
              value={entry.followUp ?? ''}
              placeholder="Edit instruction…"
              aria-label="Edit instruction"
              onChange={(e) => onAction({ type: 'set-follow-up', followUp: e.target.value })}
            />
            <button
              type="button"
              className="text-button"
              disabled={!entry.followUp?.trim()}
              onClick={() => onAction({ type: 'refine', change: entry.followUp?.trim() || '' })}
            >
              Edit instruction
            </button>
          </div>
        </>
      ) : null}
      {entry.status === 'failed' && !entry.draft && entry.error ? (
        <>
          <p className="panel-detail note">{entry.error}</p>
          <div className="panel-inline">
            <button type="button" className="text-button secondary" onClick={() => onAction({ type: 'report' })}>
              Report this
            </button>
            <button type="button" className="text-button secondary" onClick={() => onAction({ type: 'cancel' })}>
              Dismiss
            </button>
          </div>
        </>
      ) : null}
    </div>
  )
}

function WhatsAppRecipientRetry({
  entryId,
  title,
  initialQuery,
  onRetry,
  onCancel
}: {
  entryId: number
  title: string
  initialQuery: string
  onRetry: (query: string) => void
  onCancel: () => void
}): ReactNode {
  const [query, setQuery] = useState(initialQuery)
  useEffect(() => {
    setQuery(initialQuery)
  }, [entryId, initialQuery])
  return (
    <div className="wa-chooser">
      <p className="wa-chooser-title">{title}</p>
      <label className="wa-recipient-label" htmlFor={`wa-recipient-${entryId}`}>
        Name
        <input
          id={`wa-recipient-${entryId}`}
          className="wa-recipient-input"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              const next = query.trim()
              if (next) onRetry(next)
            }
            if (event.key === 'Escape') {
              event.preventDefault()
              onCancel()
            }
          }}
          autoFocus
        />
      </label>
      <p className="panel-detail">Edit the name and Retry, or Cancel to drop the pending message.</p>
      <div className="panel-inline">
        <button
          type="button"
          className="text-button"
          disabled={!query.trim()}
          onClick={() => {
            const next = query.trim()
            if (next) onRetry(next)
          }}
        >
          Retry
        </button>
        <button type="button" className="text-button secondary" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  )
}

function WhatsAppChooser({
  entryId,
  title,
  options,
  onChoose,
  onCancel,
  onRefine
}: {
  entryId: number
  title: string
  options: PanelChoice[]
  onChoose: (optionId: string) => void
  onCancel: () => void
  onRefine: () => void
}): ReactNode {
  const [active, setActive] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    setActive(0)
    listRef.current?.focus()
  }, [entryId, options])
  useEffect(() => {
    if (active < 0 || active >= options.length) setActive(0)
  }, [active, options.length])

  function onKeyDown(event: ReactKeyboardEvent<HTMLDivElement>): void {
    if (options.length === 0) return
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActive((i) => (i + 1) % options.length)
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActive((i) => (i - 1 + options.length) % options.length)
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      const option = options[active]
      if (option) onChoose(option.id)
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      onCancel()
    }
  }

  return (
    <div className="wa-chooser">
      <p className="wa-chooser-title">{title}</p>
      <div
        ref={listRef}
        className="wa-chooser-list"
        role="listbox"
        tabIndex={0}
        aria-label="WhatsApp chats"
        aria-activedescendant={options[active] ? `wa-choice-${entryId}-${active}` : undefined}
        onKeyDown={onKeyDown}
      >
        {options.map((option, index) => {
          const label = option.kind === 'group' ? 'Group' : option.kind === 'contact' ? 'Contact' : ''
          return (
            <button
              type="button"
              role="option"
              id={`wa-choice-${entryId}-${index}`}
              key={option.id}
              aria-selected={index === active}
              className={index === active ? 'wa-choice is-active' : 'wa-choice'}
              onMouseEnter={() => setActive(index)}
              onClick={() => onChoose(option.id)}
            >
              <span className="wa-choice-index">{index + 1}</span>
              <span className="wa-choice-body">
                <span className="wa-choice-name">{option.name}</span>
                {label ? <span className="wa-choice-kind">{label}</span> : null}
                {option.detail ? <span className="wa-choice-detail">{option.detail}</span> : null}
              </span>
            </button>
          )
        })}
      </div>
      <p className="panel-detail">Use ↑↓ and Enter, or say “the second one”. Say a shorter name to refine.</p>
      <div className="panel-inline">
        <button type="button" className="text-button secondary" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className="text-button secondary" onClick={onRefine}>
          Refine search
        </button>
      </div>
    </div>
  )
}
