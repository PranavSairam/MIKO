/**
 * Chrome profile matching and command helpers (pure).
 * Directory identifiers stay separate from display names.
 * Main process discovers metadata; renderer only sees validated ids + display fields.
 */

export const CHROME_PROFILE_DIR_RE = /^(Default|Guest Profile|System Profile|Profile \d+)$/i

export type ChromeProfileView = {
  /** Chrome on-disk folder name (e.g. "Profile 8"). Never a free-form path. */
  directoryId: string
  /** Owner-facing name from Chrome’s Local State. */
  displayName: string
  /** Shown under the name when display names collide (usually the directory id). */
  secondaryLabel: string | null
  initials: string
  /** data: image URL from main, or null → use initials. */
  avatarDataUrl: string | null
  /** Soft accent from Chrome’s highlight color when present. */
  accent: string | null
  /** True when this directory matches the owner’s saved MIKO default. */
  isSavedDefault: boolean
}

export type ChromeProfileMatch =
  | { kind: 'one'; profile: ChromeProfileView }
  | { kind: 'many'; profiles: ChromeProfileView[] }
  | { kind: 'none' }

export type ChromeProfileAlias = { alias: string; directoryId: string }

export function isValidChromeDirectoryId(raw: string): boolean {
  return CHROME_PROFILE_DIR_RE.test(raw.trim())
}

export function profileInitials(displayName: string): string {
  const cleaned = displayName.replace(/[^\p{L}\p{N}\s.-]/gu, ' ').trim()
  if (!cleaned) return '?'
  const parts = cleaned.split(/[\s._-]+/).filter(Boolean)
  if (parts.length >= 2) {
    const a = parts[0]?.[0] ?? ''
    const b = parts[1]?.[0] ?? ''
    return (a + b).toUpperCase().slice(0, 2)
  }
  return cleaned.slice(0, 2).toUpperCase()
}

/** Mark duplicate display names with a secondary local identifier (directory id). */
export function withDuplicateLabels<T extends { directoryId: string; displayName: string }>(
  profiles: T[]
): (T & { secondaryLabel: string | null })[] {
  const counts = new Map<string, number>()
  for (const p of profiles) {
    const key = p.displayName.trim().toLowerCase()
    counts.set(key, (counts.get(key) || 0) + 1)
  }
  return profiles.map((p) => {
    const key = p.displayName.trim().toLowerCase()
    const dup = (counts.get(key) || 0) > 1
    return { ...p, secondaryLabel: dup ? p.directoryId : null }
  })
}

export function matchChromeProfiles(
  query: string,
  profiles: ChromeProfileView[],
  aliases: ChromeProfileAlias[] = []
): ChromeProfileMatch {
  const q = query
    .trim()
    .toLowerCase()
    .replace(/^(?:my|the)\s+/, '')
    .replace(/\s+profile$/, '')
    .replace(/\s+/g, ' ')
  if (!q || profiles.length === 0) return { kind: 'none' }

  const aliasHit = aliases.find((a) => a.alias.trim().toLowerCase() === q)
  if (aliasHit && isValidChromeDirectoryId(aliasHit.directoryId)) {
    const profile = profiles.find((p) => p.directoryId === aliasHit.directoryId)
    if (profile) return { kind: 'one', profile }
  }

  const exactDir = profiles.filter((p) => p.directoryId.toLowerCase() === q)
  if (exactDir.length === 1) return { kind: 'one', profile: exactDir[0]! }

  const exactName = profiles.filter((p) => p.displayName.trim().toLowerCase() === q)
  if (exactName.length === 1) return { kind: 'one', profile: exactName[0]! }
  if (exactName.length > 1) return { kind: 'many', profiles: exactName }

  const starts = profiles.filter((p) => p.displayName.trim().toLowerCase().startsWith(q))
  if (starts.length === 1) return { kind: 'one', profile: starts[0]! }
  if (starts.length > 1) return { kind: 'many', profiles: starts }

  const includes = profiles.filter((p) => p.displayName.trim().toLowerCase().includes(q))
  if (includes.length === 1) return { kind: 'one', profile: includes[0]! }
  if (includes.length > 1) return { kind: 'many', profiles: includes }

  return { kind: 'none' }
}

/**
 * Pull a Chrome profile phrase off a site/open command.
 * Keeps display matching in the renderer/shared layer; does not invent directories.
 */
export function splitChromeProfilePhrase(raw: string): {
  rest: string
  browser: string | null
  profileQuery: string | null
  forceChooser: boolean
} {
  let text = raw.trim().replace(/\s+/g, ' ')
  let forceChooser = false
  let profileQuery: string | null = null
  let browser: string | null = null

  const choose = /^(?:choose|pick|show|switch)\s+(?:a\s+|my\s+|the\s+)?chrome\s+profiles?$/i.exec(text)
  if (choose) {
    return { rest: '', browser: 'chrome', profileQuery: null, forceChooser: true }
  }

  const openChoose = /^(?:open|launch|start)\s+(?:google\s+)?chrome\s+(?:profile\s+)?(?:chooser|picker)$/i.exec(text)
  if (openChoose) {
    return { rest: '', browser: 'chrome', profileQuery: null, forceChooser: true }
  }

  // “… in my Work Chrome profile” / “… in Chrome with Work” / “… with my Work profile”
  const inProfile =
    /\s+in\s+(?:my\s+|the\s+)?(.+?)\s+chrome\s+profile$/i.exec(text) ||
    /\s+in\s+(?:google\s+)?chrome\s+(?:with|as|using)\s+(?:my\s+|the\s+)?(.+)$/i.exec(text) ||
    /\s+with\s+(?:my\s+|the\s+)?(.+?)\s+chrome\s+profile$/i.exec(text)
  if (inProfile?.[1]) {
    profileQuery = inProfile[1].trim()
    browser = 'chrome'
    text = text.slice(0, inProfile.index).trim()
    return { rest: text, browser, profileQuery, forceChooser }
  }

  // “open Chrome with Work” / “open Chrome as my Work profile”
  const openWith =
    /^(?:open|launch|start)\s+(?:google\s+)?chrome\s+(?:with|as|using)\s+(?:my\s+|the\s+)?(.+?)(?:\s+profile)?$/i.exec(
      text
    )
  if (openWith?.[1] && !/^profile$/i.test(openWith[1])) {
    return { rest: '', browser: 'chrome', profileQuery: openWith[1].trim(), forceChooser: false }
  }

  // Bare “open Chrome” / “launch google chrome”
  if (/^(?:open|launch|start)\s+(?:google\s+)?chrome$/i.test(text)) {
    return { rest: '', browser: 'chrome', profileQuery: null, forceChooser: false }
  }

  // “use Work” / “Work profile” while a chooser is active — handled by caller with match.
  if (/^use\s+(?:my\s+|the\s+)?(.+?)(?:\s+profile)?$/i.test(text)) {
    const m = /^use\s+(?:my\s+|the\s+)?(.+?)(?:\s+profile)?$/i.exec(text)
    if (m?.[1] && !/^(?:safari|firefox|edge|brave|chrome)$/i.test(m[1])) {
      return { rest: text, browser: null, profileQuery: m[1].trim(), forceChooser }
    }
  }

  return { rest: text, browser, profileQuery, forceChooser }
}

export function parseChromeUsePhrase(raw: string): string | null {
  const t = raw
    .trim()
    .replace(/[.!,]+$/g, '')
    .replace(/^(?:please\s+)?(?:(?:can|could)\s+you\s+)?/i, '')
    .replace(/\s+/g, ' ')
  const m =
    /^use\s+(?:my\s+|the\s+)?(.+?)(?:\s+profile)?$/i.exec(t) ||
    /^(?:the\s+)?(.+?)\s+profile$/i.exec(t) ||
    /^open\s+(?:my\s+|the\s+)?(.+?)(?:\s+profile)?$/i.exec(t)
  if (!m?.[1]) return null
  if (/^(?:safari|firefox|edge|brave|chrome|it|that|this)$/i.test(m[1])) return null
  return m[1].trim()
}

export function safeHttpUrl(raw: string): string | null {
  try {
    const u = new URL(raw.trim())
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
    return u.toString()
  } catch {
    return null
  }
}
