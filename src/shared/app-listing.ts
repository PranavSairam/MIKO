import { parseActionId } from './commands.ts'
import type { AppListing } from './api.ts'

/**
 * Main sends familiar apps plus up to 120 discovered ones. A long Windows Start list
 * used to exceed the old 120-item cap and the whole list was dropped (every app then
 * read as missing). Cap generously and skip a malformed item instead of discarding all.
 */
const MAX_LISTINGS = 400

export function parseListings(value: unknown): AppListing[] {
  if (!Array.isArray(value)) return []
  const apps: AppListing[] = []
  for (const item of value.slice(0, MAX_LISTINGS)) {
    if (!item || typeof item !== 'object') continue
    const { id, name, installed, familiar, aliases } = item as Partial<AppListing>
    const action = parseActionId(id)
    if (!action || typeof name !== 'string' || name.length === 0 || name.length > 80) continue
    if (typeof installed !== 'boolean' || typeof familiar !== 'boolean' || !Array.isArray(aliases)) continue
    if (aliases.length > 24 || aliases.some((alias) => typeof alias !== 'string' || alias.length > 80)) continue
    apps.push({ id: action, name, installed, familiar, aliases: aliases as string[] })
  }
  return apps
}

