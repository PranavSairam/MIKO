import { useEffect, useState, type ChangeEvent } from 'react'
import {
  emptyFeedbackDraft,
  type FeedbackDraft,
  type FeedbackQueueItem
} from '../../../shared/feedback'
import {
  assistantNotSignedInMessage,
  assistantUnavailableMessage,
  deviceNoun,
  isWindowsPlatform
} from '../../../shared/platform-copy'

export interface FeedbackFormProps {
  lastCommand: string
  actionType?: string | null
  errorCode?: string | null
  onClose: () => void
}

export function FeedbackForm({ lastCommand, actionType, errorCode, onClose }: FeedbackFormProps) {
  const [draft, setDraft] = useState<FeedbackDraft>(() =>
    emptyFeedbackDraft({
      lastCommand,
      includeLastCommand: Boolean(lastCommand),
      inviteCode: ''
    })
  )
  const [preview, setPreview] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [queue, setQueue] = useState<FeedbackQueueItem[]>([])
  const [hasEndpoint, setHasEndpoint] = useState(false)
  const [appLine, setAppLine] = useState('')
  const [assistantNote, setAssistantNote] = useState('')
  const [platform, setPlatform] = useState('darwin')

  useEffect(() => {
    void (async () => {
      const info = await window.miko.appInfo()
      const host = info.platform || 'darwin'
      setPlatform(host)
      setAppLine(`${info.name} ${info.version} · ${info.buildId} · ${info.platform}/${info.arch}`)
      const cfg = await window.miko.feedbackConfigGet()
      setHasEndpoint(cfg.hasEndpoint)
      setDraft((d) => ({ ...d, inviteCode: cfg.inviteCode || d.inviteCode }))
      setQueue(await window.miko.feedbackList())
      const bridge = await window.miko.bridgeStatus()
      if (!bridge?.available) setAssistantNote(assistantUnavailableMessage(host))
      else if (!bridge.signedIn) setAssistantNote(assistantNotSignedInMessage(host))
      else setAssistantNote('Assistant ready (your ChatGPT sign-in via Codex). Interactive GPT web login is separate.')
    })()
  }, [])

  useEffect(() => {
    setDraft((d) => ({
      ...d,
      lastCommand,
      includeLastCommand: d.includeLastCommand || Boolean(lastCommand)
    }))
  }, [lastCommand])

  async function refreshPreview(): Promise<void> {
    const r = await window.miko.feedbackPreview(draft, { actionType, errorCode })
    if (r.ok) {
      setPreview(r.preview)
      setMessage('')
    } else {
      setPreview('')
      setMessage(r.reason)
    }
  }

  async function onExport(): Promise<void> {
    setBusy(true)
    setMessage('')
    try {
      const r = await window.miko.feedbackExportDraft(draft, { actionType, errorCode })
      setQueue(await window.miko.feedbackList())
      setMessage(r.ok ? r.reason : r.reason)
      if (r.ok) {
        const previewed = await window.miko.feedbackPreview(draft, { actionType, errorCode })
        if (previewed.ok) setPreview(previewed.preview)
      }
    } finally {
      setBusy(false)
    }
  }

  async function onSubmitRemote(): Promise<void> {
    if (!hasEndpoint) {
      setMessage('No remote inbox. Use Export report and share the file with the owner.')
      return
    }
    setBusy(true)
    setMessage('')
    try {
      if (draft.inviteCode.trim()) {
        await window.miko.feedbackConfigSet({ inviteCode: draft.inviteCode.trim() })
      }
      const r = await window.miko.feedbackSubmit(draft, { actionType, errorCode })
      setQueue(await window.miko.feedbackList())
      // Never show “sent” unless remote delivery really succeeded.
      setMessage(r.delivered ? r.reason : r.reason)
      if (r.ok && r.delivered) {
        setDraft((d) =>
          emptyFeedbackDraft({
            inviteCode: d.inviteCode,
            lastCommand: '',
            includeLastCommand: false
          })
        )
        setPreview('')
      }
    } finally {
      setBusy(false)
    }
  }

  function onPickScreenshot(event: ChangeEvent<HTMLInputElement>): void {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    if (!file.type.startsWith('image/')) {
      setMessage('Choose an image file.')
      return
    }
    if (file.size > 1_500_000) {
      setMessage('Screenshot is too large (keep under ~1.5 MB).')
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      const url = typeof reader.result === 'string' ? reader.result : ''
      setDraft((d) => ({ ...d, screenshotDataUrl: url }))
    }
    reader.readAsDataURL(file)
  }

  return (
    <div className="prefs feedback-form">
      <p className="panel-detail">
        <strong>Feedback</strong> — stays on {deviceNoun(platform)} until you export a report and send it to the owner yourself.
        {isWindowsPlatform(platform) ? ' Local path: %APPDATA%\\MIKO-Beta\\.' : ''}
        Never runs as a command or assistant request.
      </p>
      <p className="panel-detail">{appLine}</p>
      {assistantNote ? <p className="panel-detail">{assistantNote}</p> : null}
      <p className="panel-detail">
        Use <strong>Preview</strong>, then <strong>Export report</strong>. Share the saved file (AirDrop, Messages,
        email). MIKO will not claim “Feedback sent” unless a real remote inbox accepts it.
      </p>

      <label className="prefs-field">
        Type
        <select
          aria-label="Feedback type"
          value={draft.kind}
          onChange={(e) => setDraft((d) => ({ ...d, kind: e.target.value as 'problem' | 'suggestion' }))}
        >
          <option value="problem">Problem</option>
          <option value="suggestion">Suggestion</option>
        </select>
      </label>
      <label className="prefs-field">
        What happened?
        <textarea
          className="prefs-notes"
          value={draft.happened}
          maxLength={4000}
          aria-label="What happened"
          onChange={(e) => setDraft((d) => ({ ...d, happened: e.target.value }))}
        />
      </label>
      <label className="prefs-field">
        What did you expect?
        <textarea
          className="prefs-notes"
          value={draft.expected}
          maxLength={4000}
          aria-label="What did you expect"
          onChange={(e) => setDraft((d) => ({ ...d, expected: e.target.value }))}
        />
      </label>
      <label className="prefs-field">
        Contact name / email (optional)
        <input
          value={draft.contact}
          maxLength={200}
          aria-label="Optional contact"
          onChange={(e) => setDraft((d) => ({ ...d, contact: e.target.value }))}
        />
      </label>
      {hasEndpoint ? (
        <label className="prefs-field">
          Invite code (remote inbox only)
          <input
            value={draft.inviteCode}
            maxLength={64}
            placeholder="From the owner"
            aria-label="Invite code"
            onChange={(e) => setDraft((d) => ({ ...d, inviteCode: e.target.value }))}
          />
        </label>
      ) : null}
      <label className="prefs-check">
        <input
          type="checkbox"
          checked={draft.includeLastCommand}
          onChange={(e) => setDraft((d) => ({ ...d, includeLastCommand: e.target.checked }))}
        />
        Include last command (shown below for review)
      </label>
      {draft.includeLastCommand ? (
        <textarea
          className="prefs-notes"
          value={draft.lastCommand}
          maxLength={500}
          aria-label="Last command to include"
          onChange={(e) => setDraft((d) => ({ ...d, lastCommand: e.target.value }))}
        />
      ) : null}
      <div className="panel-inline">
        <label className="text-button secondary">
          Attach screenshot
          <input type="file" accept="image/*" hidden onChange={onPickScreenshot} />
        </label>
        {draft.screenshotDataUrl ? (
          <button type="button" className="text-button secondary" onClick={() => setDraft((d) => ({ ...d, screenshotDataUrl: '' }))}>
            Remove screenshot
          </button>
        ) : null}
      </div>
      {draft.screenshotDataUrl ? (
        <img className="feedback-shot" src={draft.screenshotDataUrl} alt="Screenshot preview" />
      ) : null}

      <div className="panel-inline">
        <button type="button" className="text-button secondary" onClick={() => void refreshPreview()} disabled={busy}>
          Preview
        </button>
        <button type="button" className="text-button" onClick={() => void onExport()} disabled={busy}>
          Export report
        </button>
        {hasEndpoint ? (
          <button type="button" className="text-button secondary" onClick={() => void onSubmitRemote()} disabled={busy}>
            Send to remote inbox
          </button>
        ) : null}
        <button type="button" className="text-button secondary" onClick={onClose}>
          Close
        </button>
      </div>
      {message ? <p className="panel-detail">{message}</p> : null}
      {preview ? (
        <pre className="feedback-preview" aria-label="Exact report preview">
          {preview}
        </pre>
      ) : null}

      <p className="prefs-section">Saved reports</p>
      {queue.length === 0 ? (
        <p className="panel-detail">No local reports yet.</p>
      ) : (
        <ul className="prefs-list">
          {queue.map((item) => (
            <li key={item.payload.id}>
              <span>
                {item.payload.id} · {item.status}
                {item.lastError ? ` · ${item.lastError}` : ''}
              </span>
              <span className="panel-inline">
                {hasEndpoint && item.status !== 'sent' ? (
                  <button
                    type="button"
                    className="text-button secondary"
                    onClick={() =>
                      void window.miko.feedbackRetry(item.payload.id).then(async (r) => {
                        setMessage(r.ok && r.item?.status === 'sent' ? r.reason : r.reason)
                        setQueue(await window.miko.feedbackList())
                      })
                    }
                  >
                    Retry remote
                  </button>
                ) : null}
                <button
                  type="button"
                  className="text-button secondary"
                  onClick={() =>
                    void window.miko.feedbackExport(item.payload.id).then((r) => setMessage(r.reason))
                  }
                >
                  Export
                </button>
                <button
                  type="button"
                  className="text-button secondary"
                  onClick={() =>
                    void window.miko.feedbackDelete(item.payload.id).then((list) => {
                      setQueue(list)
                      setMessage('Deleted local report.')
                    })
                  }
                >
                  Delete
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
