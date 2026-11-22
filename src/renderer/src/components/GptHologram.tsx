/**
 * Live ChatGPT view — whole-window preview above the pet, clamped on-screen.
 * Frames are transient thumbnails. Noninteractive mirror (clicks don’t send).
 */
import { useEffect, useMemo, useState, type ReactElement } from 'react'
import type { GptCaptureSource, GptLiveKind } from '../../../shared/gpt-mode'

interface GptHologramProps {
  enabled: boolean
  reducedMotion: boolean
  petHit: { x: number; y: number; width: number; height: number }
  stageSize: { width: number; height: number }
  collapsed: boolean
  frozen: boolean
  onCollapse: (next: boolean) => void
  onFreeze: (next: boolean) => void
  onClose: () => void
  onOpenChatGpt: () => void
  onChooseWindow: () => void
  pickerOpen: boolean
  pickerSources: GptCaptureSource[]
  pickerReason: string
  onPickSource: (source: GptCaptureSource) => void
  onClosePicker: () => void
}

export function GptHologram({
  enabled,
  reducedMotion,
  petHit,
  stageSize,
  collapsed,
  frozen,
  onCollapse,
  onFreeze,
  onClose,
  onOpenChatGpt,
  onChooseWindow,
  pickerOpen,
  pickerSources,
  pickerReason,
  onPickSource,
  onClosePicker
}: GptHologramProps): ReactElement | null {
  const [dataUrl, setDataUrl] = useState('')
  const [detail, setDetail] = useState('')
  const [kind, setKind] = useState<GptLiveKind>('off')
  const [sourceName, setSourceName] = useState('')

  useEffect(() => {
    if (!enabled || typeof window.miko?.gptModeLiveSnapshot !== 'function') return
    let cancelled = false
    let timer = 0
    const tick = async (): Promise<void> => {
      if (cancelled || frozen) return
      try {
        const snap = await window.miko.gptModeLiveSnapshot()
        if (cancelled) return
        setDetail(snap.reason)
        setKind(snap.kind)
        setSourceName(snap.sourceName || snap.owner || '')
        if (snap.ok && snap.dataUrl) setDataUrl(snap.dataUrl)
        else setDataUrl('')
      } catch {
        if (!cancelled) {
          setDetail('Live preview unavailable.')
          setKind('capture-failed')
          setDataUrl('')
        }
      }
      if (!cancelled && !frozen) {
        timer = window.setTimeout(() => {
          void tick()
        }, reducedMotion ? 2000 : 900)
      }
    }
    void tick()
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [enabled, frozen, reducedMotion])

  const box = useMemo(() => {
    const width = collapsed ? 168 : 280
    const height = collapsed ? 40 : pickerOpen ? 260 : 200
    let left = petHit.x + petHit.width / 2 - width / 2
    let top = petHit.y - height - 12
    left = Math.min(Math.max(8, left), Math.max(8, stageSize.width - width - 8))
    top = Math.min(Math.max(8, top), Math.max(8, stageSize.height - height - 8))
    return { left, top, width, height }
  }, [collapsed, petHit, pickerOpen, stageSize.height, stageSize.width])

  if (!enabled) return null

  const unavailable = kind === 'need-permission' || kind === 'need-window' || kind === 'capture-failed'

  return (
    <div
      className={['gpt-hologram', collapsed ? 'is-collapsed' : '', reducedMotion ? 'is-static' : '']
        .filter(Boolean)
        .join(' ')}
      data-hit="gpt-hologram"
      style={{ left: box.left, top: box.top, width: box.width, height: box.height }}
      aria-label="Live ChatGPT view"
    >
      <header className="gpt-hologram-bar">
        <span className="gpt-hologram-title">Live ChatGPT view</span>
        <div className="gpt-hologram-actions">
          <button type="button" className="icon-button" title={frozen ? 'Unfreeze' : 'Freeze'} onClick={() => onFreeze(!frozen)}>
            {frozen ? '▶' : '❚❚'}
          </button>
          <button type="button" className="icon-button" title={collapsed ? 'Expand' : 'Collapse'} onClick={() => onCollapse(!collapsed)}>
            {collapsed ? '▣' : '—'}
          </button>
          <button type="button" className="icon-button" title="Open ChatGPT" onClick={() => onOpenChatGpt()}>
            ↗
          </button>
          <button type="button" className="icon-button" title="Close live view" onClick={() => onClose()}>
            ×
          </button>
        </div>
      </header>
      {!collapsed ? (
        <div className="gpt-hologram-body">
          {pickerOpen ? (
            <div className="gpt-hologram-picker">
              <p className="gpt-hologram-empty">{pickerReason || 'Choose the ChatGPT window.'}</p>
              <div className="gpt-hologram-picker-list">
                {pickerSources.map((src) => (
                  <button
                    type="button"
                    key={src.id}
                    className={src.recommended ? 'gpt-pick is-recommended' : 'gpt-pick'}
                    onClick={() => onPickSource(src)}
                  >
                    {src.previewUrl ? <img src={src.previewUrl} alt="" draggable={false} /> : <span className="gpt-pick-blank" />}
                    <span className="gpt-pick-meta">
                      <strong>{src.owner}</strong>
                      <span>{src.name}</span>
                      {src.recommended ? <em>Recommended</em> : null}
                    </span>
                  </button>
                ))}
              </div>
              <button type="button" className="text-button secondary" onClick={() => onClosePicker()}>
                Cancel
              </button>
            </div>
          ) : dataUrl ? (
            <img src={dataUrl} alt="" draggable={false} className="gpt-hologram-frame" />
          ) : (
            <div className="gpt-hologram-empty-wrap">
              <p className="gpt-hologram-empty">{detail || 'No frame yet.'}</p>
              {unavailable ? (
                <div className="panel-inline">
                  <button type="button" className="text-button" onClick={() => onChooseWindow()}>
                    Choose window
                  </button>
                  <button
                    type="button"
                    className="text-button secondary"
                    onClick={() => {
                      void window.miko.gptModeLiveSnapshot()
                    }}
                  >
                    Retry
                  </button>
                  <button type="button" className="text-button secondary" onClick={() => onOpenChatGpt()}>
                    Open ChatGPT
                  </button>
                </div>
              ) : null}
            </div>
          )}
          {!pickerOpen ? (
            <p className="gpt-hologram-caption">
              {sourceName ? `${sourceName} · ` : ''}
              Whole window · mirror only
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
