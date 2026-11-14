import { useState } from 'react'
import type { SavedChat } from '../../../shared/api'

export interface SavedChatsProps {
  chats: SavedChat[]
  message: string
  onAdd: (name: string, url: string) => Promise<boolean>
  onOpen: (name: string) => void
  onRename: (from: string, to: string) => Promise<boolean>
  onRemove: (name: string) => void
}

/** "Saved chats": named ChatGPT conversation, Project or custom GPT links. Names render as plain text. */
export function SavedChats({ chats, message, onAdd, onOpen, onRename, onRemove }: SavedChatsProps) {
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [removing, setRemoving] = useState<string | null>(null)

  async function add(): Promise<void> {
    if (!name.trim() || !url.trim()) return
    if (await onAdd(name, url)) {
      setName('')
      setUrl('')
    }
  }

  async function saveRename(from: string): Promise<void> {
    if (await onRename(from, editName)) setEditing(null)
  }

  return (
    <div className="chats" aria-label="Saved chats">
      <div className="chats-list" role="list">
        {chats.length === 0 ? <p className="panel-empty">No saved chats yet. Add a ChatGPT link below.</p> : null}
        {chats.map((chat) => (
          <div className="chat-row" role="listitem" key={chat.name}>
            {editing === chat.name ? (
              <>
                <input
                  className="chat-input"
                  value={editName}
                  maxLength={60}
                  autoFocus
                  aria-label={`New name for ${chat.name}`}
                  onChange={(event) => setEditName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') void saveRename(chat.name)
                    if (event.key === 'Escape') {
                      event.stopPropagation()
                      setEditing(null)
                    }
                  }}
                />
                <button type="button" className="text-button" onClick={() => void saveRename(chat.name)}>
                  Save
                </button>
                <button type="button" className="text-button secondary" onClick={() => setEditing(null)}>
                  Cancel
                </button>
              </>
            ) : removing === chat.name ? (
              <>
                <span className="chat-name">Remove {chat.name}?</span>
                <button
                  type="button"
                  className="text-button"
                  onClick={() => {
                    setRemoving(null)
                    onRemove(chat.name)
                  }}
                >
                  Remove
                </button>
                <button type="button" className="text-button secondary" onClick={() => setRemoving(null)}>
                  Keep
                </button>
              </>
            ) : (
              <>
                <span className="chat-name" title={chat.url}>
                  {chat.name}
                </span>
                <button type="button" className="text-button" onClick={() => onOpen(chat.name)}>
                  Open
                </button>
                <button
                  type="button"
                  className="icon-button"
                  aria-label={`Rename ${chat.name}`}
                  onClick={() => {
                    setEditing(chat.name)
                    setEditName(chat.name)
                    setRemoving(null)
                  }}
                >
                  ✎
                </button>
                <button
                  type="button"
                  className="icon-button"
                  aria-label={`Remove ${chat.name}`}
                  onClick={() => {
                    setRemoving(chat.name)
                    setEditing(null)
                  }}
                >
                  ×
                </button>
              </>
            )}
          </div>
        ))}
      </div>
      {message ? (
        <p className="panel-detail chats-message" role="status">
          {message}
        </p>
      ) : null}
      <div className="chat-add">
        <input
          className="chat-input name"
          value={name}
          maxLength={60}
          placeholder="Name"
          aria-label="Chat name"
          onChange={(event) => setName(event.target.value)}
        />
        <input
          className="chat-input"
          value={url}
          maxLength={2000}
          placeholder="https://chatgpt.com/…"
          aria-label="ChatGPT link"
          spellCheck={false}
          onChange={(event) => setUrl(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void add()
          }}
        />
        <button type="button" className="text-button" onClick={() => void add()} disabled={!name.trim() || !url.trim()}>
          Add
        </button>
      </div>
    </div>
  )
}
