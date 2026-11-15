/**
 * Open a website in the default browser, or a named browser on macOS.
 */
import { shell } from 'electron'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export type OpenUrlResult = {
  ok: boolean
  url: string
  name: string
  browser: string
  reason: string
}

const BROWSER_APP: Record<string, string> = {
  chrome: 'Google Chrome',
  safari: 'Safari',
  firefox: 'Firefox',
  edge: 'Microsoft Edge',
  brave: 'Brave Browser',
  browser: ''
}

function safeHttpUrl(raw: string): string | null {
  try {
    const u = new URL(raw.trim())
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
    return u.toString()
  } catch {
    return null
  }
}

export async function openUrl(url: string, name: string, browser?: string | null): Promise<OpenUrlResult> {
  const safe = safeHttpUrl(url)
  if (!safe) {
    return { ok: false, url: '', name: name || '', browser: '', reason: 'That isn’t a web address I can open.' }
  }
  const label = (name || new URL(safe).hostname).trim() || 'that site'
  const key = (browser || '').trim().toLowerCase()
  const appName = key ? BROWSER_APP[key] ?? titleCase(key) : ''

  if (process.platform === 'darwin' && appName) {
    try {
      await execFileAsync('/usr/bin/open', ['-a', appName, safe], { timeout: 12_000 })
      return { ok: true, url: safe, name: label, browser: appName, reason: '' }
    } catch {
      // Fall through to the default browser if the named app isn’t installed.
      try {
        await shell.openExternal(safe)
        return {
          ok: true,
          url: safe,
          name: label,
          browser: '',
          reason: `I couldn’t open ${appName}, so I used your default browser.`
        }
      } catch {
        return { ok: false, url: safe, name: label, browser: appName, reason: `I couldn’t open ${label} in ${appName}.` }
      }
    }
  }

  try {
    await shell.openExternal(safe)
    return { ok: true, url: safe, name: label, browser: '', reason: '' }
  } catch {
    return { ok: false, url: safe, name: label, browser: '', reason: `I couldn’t open ${label}.` }
  }
}

function titleCase(raw: string): string {
  return raw.replace(/\b\w/g, (c) => c.toUpperCase())
}
