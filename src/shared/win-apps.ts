/**
 * Windows application identities. Pure; used by the main process and tests.
 *
 * Windows lists every Start menu app — classic desktop programs and Microsoft Store
 * (packaged) apps such as Calculator and WhatsApp — with an AppUserModelID ("AppID")
 * through `Get-StartApps`. `explorer.exe shell:AppsFolder\<AppID>` launches any of them,
 * which is the supported way to start a packaged app (they have no stable .exe path).
 */

export interface StartApp {
  name: string
  appId: string
}

/** Parses `Get-StartApps | Select-Object Name,AppID | ConvertTo-Json -Compress` output. */
export function parseStartApps(json: string): StartApp[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(json.replace(/^﻿/, '').trim() || '[]')
  } catch {
    return []
  }
  const items = Array.isArray(parsed) ? parsed : parsed && typeof parsed === 'object' ? [parsed] : []
  const out: StartApp[] = []
  const seen = new Set<string>()
  for (const item of items) {
    if (!item || typeof item !== 'object') continue
    const { Name, AppID } = item as { Name?: unknown; AppID?: unknown }
    if (typeof Name !== 'string' || typeof AppID !== 'string') continue
    const name = Name.trim()
    const appId = AppID.trim()
    if (!name || name.length > 80 || !isLaunchableAppId(appId)) continue
    const key = appId.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ name, appId })
  }
  return out
}

/** AppIDs are passed as one argument to explorer.exe (no shell); still reject odd input. */
export function isLaunchableAppId(appId: string): boolean {
  if (!appId || appId.length > 260) return false
  if (/[\0\r\n"<>|]/.test(appId)) return false
  // Web links pinned to Start ("https://…") are not apps.
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(appId)) return false
  return true
}

/** The single explorer.exe argument that launches an app by its AppID. */
export function appsFolderArg(appId: string): string {
  return `shell:AppsFolder\\${appId}`
}

/** Start menu entries that are not apps a person means to "open". */
export function isNoiseStartApp(name: string): boolean {
  return /\b(?:uninstall|uninstaller|readme|read me|help|documentation|release notes|website|license|eula|support|manual)\b/i.test(
    name
  )
}

export interface WinFamiliarSpec {
  /** Exact names (case-insensitive) that identify the app in Start. */
  names: string[]
  /** AppID fragments (case-insensitive) for packaged apps whose display name is localized. */
  appIdHints: string[]
}

/** Calculator, WhatsApp, Office… by Start name or package identity. */
export const WIN_FAMILIAR: Record<string, WinFamiliarSpec> = {
  calculator: { names: ['calculator'], appIdHints: ['microsoft.windowscalculator_'] },
  whatsapp: { names: ['whatsapp'], appIdHints: ['whatsappdesktop_', '5319275a.'] },
  word: { names: ['word', 'microsoft word'], appIdHints: ['microsoft.office.winword'] },
  excel: { names: ['excel', 'microsoft excel'], appIdHints: ['microsoft.office.excel'] },
  powerpoint: { names: ['powerpoint', 'microsoft powerpoint'], appIdHints: ['microsoft.office.powerpnt'] },
  chrome: { names: ['google chrome', 'chrome'], appIdHints: [] },
  editor: { names: ['notepad'], appIdHints: ['microsoft.windowsnotepad_'] },
  files: { names: ['file explorer'], appIdHints: ['microsoft.windows.explorer'] }
}

export function findStartApp(apps: StartApp[], spec: WinFamiliarSpec): StartApp | null {
  const byName = apps.find((app) => spec.names.includes(app.name.toLowerCase()))
  if (byName) return byName
  for (const hint of spec.appIdHints) {
    const byId = apps.find((app) => app.appId.toLowerCase().includes(hint))
    if (byId) return byId
  }
  return null
}

/** Process image names that show a familiar app actually started (tasklist check). */
export const WIN_PROCESS_NAMES: Record<string, string[]> = {
  calculator: ['CalculatorApp.exe', 'Calculator.exe', 'calc.exe'],
  whatsapp: ['WhatsApp.exe', 'WhatsApp.Root.exe'],
  word: ['WINWORD.EXE'],
  excel: ['EXCEL.EXE'],
  powerpoint: ['POWERPNT.EXE'],
  chrome: ['chrome.exe'],
  editor: ['notepad.exe', 'Notepad.exe']
}

/** True when `tasklist /FO CSV /NH` output lists one of the names. */
export function tasklistHas(output: string, names: string[]): boolean {
  const wanted = new Set(names.map((name) => name.toLowerCase()))
  for (const line of output.split(/\r?\n/)) {
    const first = /^"([^"]+)"/.exec(line.trim())?.[1]?.toLowerCase()
    if (first && wanted.has(first)) return true
  }
  return false
}
