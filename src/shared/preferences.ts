/**
 * Approved preferences and correction examples (not model weights).
 * Personal data stays local; raw chat/mail bodies are never stored here by default.
 */

export interface MikoStructuredPreferences {
  preferredBrowser: 'chrome' | 'safari' | 'default' | null
  writingTone: 'natural' | 'formal' | 'friendly' | 'polite' | null
  preferredLanguage: string | null
  /** Free-form notes the owner approved (not auto-captured private content). */
  notes: string
  /**
   * Explicitly saved Chrome profile directory id (e.g. "Profile 8").
   * Never auto-saved; cleared when the profile disappears.
   */
  defaultChromeProfileDirectory: string | null
  /** Display name cached with the default for Preferences UI (not used for launch). */
  defaultChromeProfileName: string | null
  /** Owner-approved aliases → directory ids. */
  chromeProfileAliases: { alias: string; directoryId: string }[]
  /** Smaller controls (optional). Off by default: buttons are large and readable. */
  compactControls?: boolean
}

export interface CorrectionExample {
  id: string
  /** User wording that was corrected. */
  wording: string
  /** Approved action kind name. */
  actionKind: string
  /** Optional approved WhatsApp/contact alias. */
  targetAlias?: string
  /** Short note — never a private message body. */
  note?: string
  createdAt: number
}

export const DEFAULT_PREFERENCES: MikoStructuredPreferences = {
  preferredBrowser: null,
  writingTone: 'natural',
  preferredLanguage: null,
  notes: '',
  defaultChromeProfileDirectory: null,
  defaultChromeProfileName: null,
  chromeProfileAliases: []
}

function parseChromeAliases(raw: unknown): { alias: string; directoryId: string }[] {
  if (!Array.isArray(raw)) return []
  const out: { alias: string; directoryId: string }[] = []
  const seen = new Set<string>()
  for (const row of raw) {
    const r = row as { alias?: unknown; directoryId?: unknown }
    if (typeof r.alias !== 'string' || typeof r.directoryId !== 'string') continue
    const alias = r.alias.trim().slice(0, 80)
    const directoryId = r.directoryId.trim().slice(0, 40)
    if (!alias || !/^(Default|Guest Profile|System Profile|Profile \d+)$/i.test(directoryId)) continue
    const key = alias.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ alias, directoryId })
    if (out.length >= 40) break
  }
  return out
}

export function parsePreferences(raw: unknown): MikoStructuredPreferences {
  const v = (raw ?? {}) as Partial<MikoStructuredPreferences>
  const browser = v.preferredBrowser
  const dir =
    typeof v.defaultChromeProfileDirectory === 'string' &&
    /^(Default|Guest Profile|System Profile|Profile \d+)$/i.test(v.defaultChromeProfileDirectory.trim())
      ? v.defaultChromeProfileDirectory.trim()
      : null
  return {
    preferredBrowser: browser === 'chrome' || browser === 'safari' || browser === 'default' ? browser : null,
    writingTone:
      v.writingTone === 'natural' || v.writingTone === 'formal' || v.writingTone === 'friendly' || v.writingTone === 'polite'
        ? v.writingTone
        : 'natural',
    preferredLanguage: typeof v.preferredLanguage === 'string' ? v.preferredLanguage.slice(0, 40) || null : null,
    notes: typeof v.notes === 'string' ? v.notes.slice(0, 2000) : '',
    defaultChromeProfileDirectory: dir,
    defaultChromeProfileName:
      dir && typeof v.defaultChromeProfileName === 'string' ? v.defaultChromeProfileName.trim().slice(0, 80) || null : null,
    chromeProfileAliases: parseChromeAliases(v.chromeProfileAliases),
    ...(v.compactControls === true ? { compactControls: true } : {})
  }
}

export function parseExamples(raw: unknown): CorrectionExample[] {
  if (!Array.isArray(raw)) return []
  const out: CorrectionExample[] = []
  for (const row of raw) {
    const r = row as Partial<CorrectionExample>
    if (typeof r.id !== 'string' || typeof r.wording !== 'string' || typeof r.actionKind !== 'string') continue
    out.push({
      id: r.id.slice(0, 64),
      wording: r.wording.slice(0, 200),
      actionKind: r.actionKind.slice(0, 64),
      targetAlias: typeof r.targetAlias === 'string' ? r.targetAlias.slice(0, 80) : undefined,
      note: typeof r.note === 'string' ? r.note.slice(0, 200) : undefined,
      createdAt: typeof r.createdAt === 'number' ? r.createdAt : Date.now()
    })
    if (out.length >= 50) break
  }
  return out
}

/** Retrieve a few relevant approved examples for the interpreter (bounded). */
export function retrieveExamples(examples: CorrectionExample[], query: string, limit = 3): CorrectionExample[] {
  const q = query.toLowerCase()
  const scored = examples
    .map((ex) => {
      const w = ex.wording.toLowerCase()
      let score = 0
      if (w === q) score += 10
      if (q.includes(w) || w.includes(q)) score += 5
      for (const token of q.split(/\s+/).filter((t) => t.length > 2)) {
        if (w.includes(token)) score += 1
      }
      return { ex, score }
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
  const seen = new Set<string>()
  const out: CorrectionExample[] = []
  for (const { ex } of scored) {
    const key = `${ex.actionKind}|${ex.wording.toLowerCase()}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(ex)
    if (out.length >= limit) break
  }
  return out
}
