/** Saved ChatGPT shortcuts: URL validation, list edits and name resolution. Pure, no Electron. */

export interface SavedChat {
  name: string
  url: string
}

export type ChatKind = 'conversation' | 'project' | 'gpt'

export type ChatUrlResult = { ok: true; url: string; kind: ChatKind } | { ok: false; reason: string }

export type ChatEdit = { ok: true; list: SavedChat[] } | { ok: false; reason: string }

export const MAX_SAVED_CHATS = 50
export const MAX_CHAT_NAME = 60
export const CHATGPT_HOME = 'https://chatgpt.com/'

const ID = '[A-Za-z0-9-]{4,100}'
const CONVERSATION = new RegExp(`^/c/${ID}/?$`)
const PROJECT = new RegExp(`^/g/g-p-${ID}(?:/project)?/?$`)
const IN_PROJECT_OR_GPT = new RegExp(`^/g/g-${ID}/c/${ID}/?$`)
const GPT = new RegExp(`^/g/g-(?!p-)${ID}/?$`)

/**
 * Accepts HTTPS links on chatgpt.com to a conversation (/c/<id>), a Project
 * (/g/g-p-<id>[/project]), a custom GPT (/g/g-<id>), or a conversation inside
 * one of those (/g/g-…/c/<id>). Query and fragment are dropped.
 */
export function parseChatUrl(raw: string): ChatUrlResult {
  let url: URL
  try {
    url = new URL(raw.trim())
  } catch {
    return { ok: false, reason: 'That isn’t a valid link.' }
  }
  if (url.protocol !== 'https:') return { ok: false, reason: 'Only https:// ChatGPT links can be saved.' }
  if (url.username || url.password) return { ok: false, reason: 'Links with a username or password can’t be saved.' }
  if (url.hostname !== 'chatgpt.com' || url.port) return { ok: false, reason: 'Only chatgpt.com links can be saved.' }
  const path = url.pathname
  let kind: ChatKind | null = null
  if (CONVERSATION.test(path) || IN_PROJECT_OR_GPT.test(path)) kind = 'conversation'
  else if (PROJECT.test(path)) kind = 'project'
  else if (GPT.test(path)) kind = 'gpt'
  if (!kind) return { ok: false, reason: 'Use a ChatGPT conversation, Project, or custom GPT link.' }
  return { ok: true, kind, url: `https://chatgpt.com${path.replace(/\/$/, '')}` }
}

export function cleanChatName(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim().slice(0, MAX_CHAT_NAME)
}

function same(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase()
}

export function addChat(list: SavedChat[], rawName: string, rawUrl: string): ChatEdit {
  const name = cleanChatName(rawName)
  if (!name) return { ok: false, reason: 'Give the chat a name.' }
  const parsed = parseChatUrl(rawUrl)
  if (!parsed.ok) return parsed
  if (list.some((chat) => same(chat.name, name))) {
    return { ok: false, reason: `A saved chat named “${name}” already exists. Pick another name.` }
  }
  if (list.length >= MAX_SAVED_CHATS) return { ok: false, reason: `You can save up to ${MAX_SAVED_CHATS} chats.` }
  return { ok: true, list: [...list, { name, url: parsed.url }] }
}

export function renameChat(list: SavedChat[], from: string, rawTo: string): ChatEdit {
  const to = cleanChatName(rawTo)
  if (!to) return { ok: false, reason: 'Give the chat a name.' }
  const index = list.findIndex((chat) => same(chat.name, from))
  if (index < 0) return { ok: false, reason: `There’s no saved chat called “${from}”.` }
  if (list.some((chat, i) => i !== index && same(chat.name, to))) {
    return { ok: false, reason: `A saved chat named “${to}” already exists. Pick another name.` }
  }
  return { ok: true, list: list.map((chat, i) => (i === index ? { ...chat, name: to } : chat)) }
}

export function removeChat(list: SavedChat[], name: string): ChatEdit {
  const next = list.filter((chat) => !same(chat.name, name))
  if (next.length === list.length) return { ok: false, reason: `There’s no saved chat called “${name}”.` }
  return { ok: true, list: next }
}

export type ChatMatch = { kind: 'one'; chat: SavedChat } | { kind: 'many'; chats: SavedChat[] } | { kind: 'none' }

/** Exact name first, then names containing every word of the query. */
export function resolveChat(list: SavedChat[], query: string): ChatMatch {
  const needle = query.toLowerCase().replace(/\s+/g, ' ').trim()
  if (!needle) return { kind: 'none' }
  const exact = list.filter((chat) => chat.name.toLowerCase() === needle)
  if (exact.length === 1) return { kind: 'one', chat: exact[0] }
  const words = needle.split(' ')
  const loose = list.filter((chat) => {
    const name = chat.name.toLowerCase().split(/\s+/)
    return words.every((word) => name.some((part) => part.startsWith(word)))
  })
  if (loose.length === 1) return { kind: 'one', chat: loose[0] }
  if (loose.length > 1) return { kind: 'many', chats: loose }
  return { kind: 'none' }
}

/** Defensive parse of a stored list (settings file may be hand-edited). */
export function parseSavedChats(value: unknown): SavedChat[] {
  if (!Array.isArray(value)) return []
  const out: SavedChat[] = []
  for (const row of value) {
    if (!row || typeof row !== 'object') continue
    const { name, url } = row as { name?: unknown; url?: unknown }
    if (typeof name !== 'string' || typeof url !== 'string') continue
    const added = addChat(out, name, url)
    if (added.ok) out.splice(0, out.length, ...added.list)
  }
  return out
}
