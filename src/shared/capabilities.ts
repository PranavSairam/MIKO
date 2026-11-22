/**
 * Capability registry: what MIKO can actually do on each platform.
 * Execution handlers live in main/renderer; this module is the allowlist metadata.
 */

import type { ActionKind } from './actions.ts'

export type Platform = 'darwin' | 'win32' | 'all'

export interface Capability {
  kind: ActionKind
  purpose: string
  platform: Platform
  /** Permission or connection the owner must have granted. */
  requires: string[]
  mutating: boolean
  preconditions: string[]
  verify: string
  failures: string[]
}

export const CAPABILITIES: Capability[] = [
  {
    kind: 'open_application',
    purpose: 'Launch or focus an installed application',
    platform: 'all',
    requires: [],
    mutating: true,
    preconditions: ['App is installed or known'],
    verify: 'App process is running or launch reported ok',
    failures: ['missing', 'confirm_required', 'launch_failed']
  },
  {
    kind: 'close_application',
    purpose: 'Quit a running application',
    platform: 'all',
    requires: [],
    mutating: true,
    preconditions: ['App is running'],
    verify: 'App process has exited',
    failures: ['not_running', 'needs_confirm', 'quit_blocked']
  },
  {
    kind: 'open_website',
    purpose: 'Open a website in the default or named browser',
    platform: 'all',
    requires: [],
    mutating: true,
    preconditions: ['Valid http(s) URL'],
    verify: 'Browser open reported ok',
    failures: ['bad_url', 'browser_missing']
  },
  {
    kind: 'list_browser_tabs',
    purpose: 'List open Chrome or Safari tabs',
    platform: 'darwin',
    requires: ['Automation'],
    mutating: false,
    preconditions: ['Browser already running'],
    verify: 'Tab list returned',
    failures: ['browser_closed', 'automation_denied', 'unsupported']
  },
  {
    kind: 'close_browser_tab',
    purpose: 'Close one matching browser tab without quitting the browser',
    platform: 'darwin',
    requires: ['Automation'],
    mutating: true,
    preconditions: ['Matching tab still present'],
    verify: 'Tab no longer in list',
    failures: ['no_match', 'ambiguous', 'automation_denied', 'unsupported']
  },
  {
    kind: 'close_website',
    purpose: 'Close tabs whose host matches a website',
    platform: 'darwin',
    requires: ['Automation'],
    mutating: true,
    preconditions: ['Matching tabs present'],
    verify: 'Matching tabs gone',
    failures: ['no_match', 'ambiguous', 'unsupported']
  },
  {
    kind: 'search_whatsapp_contacts',
    purpose: 'Search WhatsApp for a contact or chat',
    platform: 'darwin',
    requires: ['Accessibility'],
    mutating: false,
    preconditions: ['WhatsApp installed'],
    verify: 'Search results or none',
    failures: ['permission', 'unsupported', 'none']
  },
  {
    kind: 'open_whatsapp_chat',
    purpose: 'Open a WhatsApp chat and verify the header',
    platform: 'darwin',
    requires: ['Accessibility'],
    mutating: true,
    preconditions: ['Contact identified'],
    verify: 'Chat header matches',
    failures: ['choices', 'unverified', 'lost_focus', 'unsupported']
  },
  {
    kind: 'read_whatsapp_messages',
    purpose: 'Read visible messages in the open WhatsApp chat',
    platform: 'darwin',
    requires: ['Accessibility'],
    mutating: false,
    preconditions: ['Verified open chat'],
    verify: 'Messages captured from chat table only',
    failures: ['lost_focus', 'empty', 'older_history', 'unsupported']
  },
  {
    kind: 'summarize_whatsapp',
    purpose: 'Summarize visible WhatsApp messages inside MIKO (composer unchanged)',
    platform: 'darwin',
    requires: ['Accessibility', 'MIKO assistant'],
    mutating: false,
    preconditions: ['Verified open chat with readable messages'],
    verify: 'Summary shown in panel; composer text unchanged',
    failures: ['no_messages', 'stale_chat', 'assistant_off', 'unsupported']
  },
  {
    kind: 'list_whatsapp_attachments',
    purpose: 'List downloadable document bubbles in the open WhatsApp chat (visible only)',
    platform: 'darwin',
    requires: ['Accessibility'],
    mutating: false,
    preconditions: ['Verified open chat'],
    verify: 'Attachment metadata from message bubbles; visible-only labelled',
    failures: ['none', 'lost_focus', 'permission', 'unsupported']
  },
  {
    kind: 'fetch_whatsapp_attachment',
    purpose: 'Save a WhatsApp document via Save to Downloads and verify the local file',
    platform: 'darwin',
    requires: ['Accessibility'],
    mutating: true,
    preconditions: ['Verified open chat; selected attachment'],
    verify: 'Local file exists, nonempty, complete; never overwrite silently',
    failures: ['missing', 'failed', 'cancelled', 'switched', 'permission', 'unsupported']
  },
  {
    kind: 'copy_file',
    purpose: 'Put a real file URL on the macOS pasteboard (not path text)',
    platform: 'darwin',
    requires: [],
    mutating: false,
    preconditions: ['Verified local file path'],
    verify: 'Pasteboard holds public.file-url / file reference',
    failures: ['missing', 'clipboard']
  },
  {
    kind: 'attach_file',
    purpose: 'Paste a file into a verified destination without sending',
    platform: 'darwin',
    requires: ['Accessibility'],
    mutating: true,
    preconditions: ['Verified destination; retrieved file'],
    verify: 'Attachment preview present; composer text preserved; unsent',
    failures: ['switched', 'unsupported', 'cancelled', 'lost_focus']
  },
  {
    kind: 'draft_whatsapp',
    purpose: 'Draft a WhatsApp message via the assistant',
    platform: 'all',
    requires: ['MIKO assistant'],
    mutating: false,
    preconditions: ['Verified chat target'],
    verify: 'Draft text produced',
    failures: ['assistant_off', 'question', 'cancelled']
  },
  {
    kind: 'insert_whatsapp_draft',
    purpose: 'Insert a reviewed draft into the verified WhatsApp composer without sending',
    platform: 'darwin',
    requires: ['Accessibility'],
    mutating: true,
    preconditions: ['Verified chat; draft ready'],
    verify: 'Composer AXValue matches draft; nothing sent',
    failures: ['switched', 'has_text', 'lost_focus', 'unsupported']
  },
  {
    kind: 'refine_draft',
    purpose: 'Revise the current draft',
    platform: 'all',
    requires: ['MIKO assistant'],
    mutating: false,
    preconditions: ['Active draft'],
    verify: 'New draft text produced',
    failures: ['no_draft', 'manual_edit']
  },
  {
    kind: 'search_mail',
    purpose: 'Search connected Gmail accounts',
    platform: 'all',
    requires: ['Gmail connection'],
    mutating: false,
    preconditions: ['Mailbox connected'],
    verify: 'Results from connected source',
    failures: ['not_connected', 'empty']
  },
  {
    kind: 'read_mail_thread',
    purpose: 'Open a mail message and thread',
    platform: 'all',
    requires: ['Gmail connection'],
    mutating: false,
    preconditions: ['Message in current list'],
    verify: 'Message body loaded',
    failures: ['not_found', 'not_connected']
  },
  {
    kind: 'prepare_mail_reply',
    purpose: 'Draft a mail reply inside MIKO (never sends)',
    platform: 'all',
    requires: ['Gmail connection', 'MIKO assistant'],
    mutating: false,
    preconditions: ['Open message'],
    verify: 'Draft shown in Mail tab',
    failures: ['assistant_off', 'missing_detail']
  },
  {
    kind: 'read_selected_text',
    purpose: 'Use explicitly captured selected text',
    platform: 'darwin',
    requires: ['Accessibility'],
    mutating: false,
    preconditions: ['Fresh selection capture'],
    verify: 'Selection text available',
    failures: ['no_selection', 'stale', 'unsupported']
  },
  {
    kind: 'replace_selected_text',
    purpose: 'Replace editable selected text after review',
    platform: 'darwin',
    requires: ['Accessibility'],
    mutating: true,
    preconditions: ['Editable non-secure field; capture still valid'],
    verify: 'Field text matches replacement',
    failures: ['cannot_replace', 'stale', 'unsupported']
  },
  {
    kind: 'summarize_text',
    purpose: 'Summarize provided or selected text inside MIKO',
    platform: 'all',
    requires: ['MIKO assistant'],
    mutating: false,
    preconditions: ['Source text available'],
    verify: 'Summary in panel',
    failures: ['no_source', 'assistant_off']
  },
  {
    kind: 'rewrite_text',
    purpose: 'Rewrite text with a requested tone',
    platform: 'all',
    requires: ['MIKO assistant'],
    mutating: false,
    preconditions: ['Source text; tone or instruction'],
    verify: 'Rewritten text in panel',
    failures: ['no_source', 'assistant_off']
  },
  {
    kind: 'chatgpt_new_chat',
    purpose: 'Create a new ChatGPT chat and verify the composer before typing',
    platform: 'darwin',
    requires: ['Accessibility'],
    mutating: true,
    preconditions: ['ChatGPT app installed and focusable'],
    verify: 'New chat composer empty or verified; ChatGPT still frontmost',
    failures: ['unavailable', 'unverified', 'lost_focus', 'unsupported']
  },
  {
    kind: 'insert_text',
    purpose: 'Insert text into a verified editable field without submitting',
    platform: 'darwin',
    requires: ['Accessibility'],
    mutating: true,
    preconditions: ['Verified non-secure editable destination'],
    verify: 'Field value matches insert (or honest unverified paste); nothing sent',
    failures: ['has_text', 'switched', 'secure', 'unsupported', 'cancelled']
  },
  {
    kind: 'focus_omnibox',
    purpose: 'Put text in Chrome’s address bar without navigating',
    platform: 'darwin',
    requires: ['Accessibility'],
    mutating: true,
    preconditions: ['Chrome (or Chromium) available'],
    verify: 'Omnibox value matches; Enter not pressed',
    failures: ['lost_focus', 'unsupported', 'failed']
  },
  {
    kind: 'choose_type_destination',
    purpose: 'Hold draft and let the owner focus a field, then Paste now',
    platform: 'darwin',
    requires: ['Accessibility'],
    mutating: false,
    preconditions: ['Held draft text'],
    verify: 'Owner confirms focused editable field',
    failures: ['secure', 'no_field', 'expired']
  },
  {
    kind: 'cancel_task',
    purpose: 'Cancel the active pending task locally',
    platform: 'all',
    requires: [],
    mutating: false,
    preconditions: [],
    verify: 'Outstanding callbacks invalidated',
    failures: []
  },
  {
    kind: 'ask_assistant',
    purpose: 'Ordinary conversation with the MIKO assistant',
    platform: 'all',
    requires: ['MIKO assistant'],
    mutating: false,
    preconditions: [],
    verify: 'Reply in panel',
    failures: ['assistant_off', 'busy']
  },
  {
    kind: 'clarify',
    purpose: 'Ask one short clarifying question',
    platform: 'all',
    requires: [],
    mutating: false,
    preconditions: [],
    verify: 'Choice or question shown',
    failures: []
  },
  {
    kind: 'unsupported',
    purpose: 'Honest unsupported response',
    platform: 'all',
    requires: [],
    mutating: false,
    preconditions: [],
    verify: 'Clear message to the owner',
    failures: []
  }
]

export function capabilitiesFor(platform: NodeJS.Platform | 'darwin' | 'win32'): Capability[] {
  return CAPABILITIES.filter((c) => c.platform === 'all' || c.platform === platform)
}

export function availableKinds(platform: NodeJS.Platform | 'darwin' | 'win32'): ActionKind[] {
  return capabilitiesFor(platform).map((c) => c.kind)
}

export function capability(kind: ActionKind): Capability | undefined {
  return CAPABILITIES.find((c) => c.kind === kind)
}
