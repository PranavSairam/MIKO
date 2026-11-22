import { spawn, spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join, relative } from 'node:path'
import { app, shell } from 'electron'
import { parseActionId, type CatalogApp } from '../shared/commands'
import {
  appsFolderArg,
  findStartApp,
  isNoiseStartApp,
  parseStartApps,
  tasklistHas,
  WIN_FAMILIAR,
  WIN_PROCESS_NAMES,
  type StartApp
} from '../shared/win-apps'
import { logDiag } from './diagnostics'

export interface LaunchResult {
  ok: boolean
  reason: string
}

interface Target {
  name: string
  familiar: boolean
  run: () => Promise<boolean>
  macApp?: string
  macBundle?: string
  winExe?: string
  winLnk?: string
  /** Windows AppUserModelID (Start menu identity) used to launch this app. */
  winAppId?: string
  /** Familiar id (calculator, whatsapp…) for the Windows "is it running?" check. */
  winFamiliar?: string
  /** Placeholder for a familiar app that was not found. */
  missing?: boolean
}

export interface QuitTarget {
  name: string
  macApp?: string
  macBundle?: string
  winExe?: string
  winLnk?: string
}

const CACHE_MS = 5000
const SCAN_LIMIT = 120
/** Windows Start app list (PowerShell Get-StartApps) is slower to read; refresh every few minutes. */
const START_APPS_MS = 5 * 60_000
const CHATGPT_URL = 'https://chatgpt.com'

let cache: { at: number; apps: CatalogApp[]; targets: Map<string, Target> } | null = null
let confirmed: Set<string> | null = null

export interface AppDiscoveryStatus {
  ok: boolean
  /** Where the app list came from on this computer. */
  source: 'start-apps' | 'shortcuts' | 'mac-folders' | 'none'
  count: number
  detail: string
}

let startApps: { at: number; apps: StartApp[]; error: string } | null = null
let startAppsLoading: Promise<void> | null = null
let discovery: AppDiscoveryStatus = { ok: true, source: 'none', count: 0, detail: '' }

export function appDiscoveryStatus(): AppDiscoveryStatus {
  return discovery
}

export async function listApplications(): Promise<CatalogApp[]> {
  const found = await load()
  return found.apps
}

export async function launchApplication(id: string, confirm: boolean): Promise<LaunchResult> {
  const action = parseActionId(id)
  if (!action) return { ok: false, reason: 'That action is not available.' }
  const found = await load()
  const target = found.targets.get(action)
  if (!target) return { ok: false, reason: 'That action is not available.' }
  if (target.missing) {
    return {
      ok: false,
      reason: discovery.ok
        ? `${target.name} isn’t installed on this computer.`
        : `I couldn’t check which apps are installed (${discovery.detail}).`
    }
  }
  if (!target.familiar && !confirm && !loadConfirmed().has(action)) {
    return { ok: false, reason: `Confirm before launching ${target.name}.` }
  }
  if (!target.familiar && confirm) remember(action)
  const opened = await target.run()
  if (!opened) {
    logDiag('apps', 'launch failed', { id: action, name: target.name, appId: Boolean(target.winAppId), exe: Boolean(target.winExe) })
    return { ok: false, reason: `I found ${target.name}, but it didn’t start. Try again, or open it from the Start menu.` }
  }
  if (process.platform === 'win32') {
    const running = await verifyWindowsRunning(target)
    logDiag('apps', 'launch requested', { id: action, name: target.name, via: target.winAppId ? 'appsfolder' : target.winExe ? 'exe' : target.winLnk ? 'lnk' : 'path', running })
    if (running === false) {
      return { ok: false, reason: `I asked Windows to open ${target.name}, but I can’t see it running yet.` }
    }
    return { ok: true, reason: running ? `${target.name} is open.` : '' }
  }
  // Folder/URL opens have no process to verify. App launches: check frontmost when possible.
  if (!target.macApp && !target.macBundle && !target.winExe && !target.winLnk) {
    return { ok: true, reason: '' }
  }
  const verified = await verifyFrontApp(target.name, target.macApp, target.macBundle)
  if (verified === false) {
    return {
      ok: false,
      reason: `I asked ${target.name} to come forward, but it isn’t the front app yet.`
    }
  }
  return {
    ok: true,
    reason: verified === true ? `${target.name} is frontmost.` : ''
  }
}

/**
 * Windows: true = the app's process is running, false = not seen after a few seconds,
 * null = no known process name to check (launch request itself succeeded).
 */
async function verifyWindowsRunning(target: Target): Promise<boolean | null> {
  const names = target.winFamiliar ? WIN_PROCESS_NAMES[target.winFamiliar] : undefined
  if (!names?.length) return null
  const tasklist = join(system32(), 'tasklist.exe')
  for (const wait of [1500, 2500, 3000]) {
    await new Promise((r) => setTimeout(r, wait))
    const out = await readAsync(tasklist, ['/FO', 'CSV', '/NH'], 4000, 2_000_000)
    if (out === null) return null
    if (tasklistHas(out, names)) return true
  }
  return false
}

/** true = confirmed frontmost, false = wrong app, null = couldn’t check (still treat launch as ok). */
async function verifyFrontApp(name: string, macApp?: string, macBundle?: string): Promise<boolean | null> {
  if (process.platform !== 'darwin') return null
  await new Promise((r) => setTimeout(r, 280))
  const r = spawnSync(
    '/usr/bin/osascript',
    [
      '-e',
      'tell application "System Events" to get {name, bundle identifier} of first application process whose frontmost is true'
    ],
    { shell: false, encoding: 'utf8', timeout: 2500, windowsHide: true }
  )
  if (r.error || r.status !== 0 || typeof r.stdout !== 'string') return null
  const raw = r.stdout.trim()
  // osascript list: "Google Chrome, com.google.Chrome"
  const parts = raw.split(',').map((s) => s.trim())
  const frontName = (parts[0] || '').toLowerCase()
  const frontBundle = (parts[1] || '').toLowerCase()
  if (macBundle && frontBundle && frontBundle === macBundle.toLowerCase()) return true
  const needle = name.toLowerCase().replace(/\s+/g, '')
  const frontCompact = frontName.replace(/\s+/g, '')
  if (!needle || !frontCompact) return null
  if (frontCompact === needle || frontCompact.includes(needle) || needle.includes(frontCompact)) return true
  if (macApp) {
    const base = macApp
      .split('/')
      .pop()
      ?.replace(/\.app$/i, '')
      .toLowerCase()
      .replace(/\s+/g, '')
    if (base && (frontCompact === base || frontCompact.includes(base) || base.includes(frontCompact))) return true
  }
  return false
}

export async function quitTarget(id: string): Promise<QuitTarget | null> {
  const action = parseActionId(id)
  if (!action) return null
  const found = await load()
  const target = found.targets.get(action)
  if (!target) return null
  return {
    name: target.name,
    macApp: target.macApp,
    macBundle: target.macBundle,
    winExe: target.winExe,
    winLnk: target.winLnk
  }
}

export function openChatGpt(): Promise<boolean> {
  return shell.openExternal(CHATGPT_URL).then(
    () => true,
    () => false
  )
}

async function load(): Promise<{ apps: CatalogApp[]; targets: Map<string, Target> }> {
  const now = Date.now()
  if (cache && now - cache.at < CACHE_MS) return cache
  if (process.platform === 'win32') await loadStartApps()
  const targets = new Map<string, Target>()
  const apps: CatalogApp[] = []
  for (const familiar of familiarTargets()) {
    targets.set(familiar.id, familiar.target)
    apps.push({
      id: familiar.id,
      name: familiar.name,
      installed: familiar.installed,
      familiar: true,
      aliases: familiar.aliases
    })
  }
  for (const extra of unfamiliarTargets(targets)) {
    if (targets.has(extra.id)) continue
    targets.set(extra.id, extra.target)
    apps.push({
      id: extra.id,
      name: extra.target.name,
      installed: true,
      familiar: false,
      aliases: [extra.target.name.toLowerCase()]
    })
  }
  cache = { at: now, apps, targets }
  updateDiscovery(apps)
  return cache
}

function updateDiscovery(apps: CatalogApp[]): void {
  if (process.platform === 'win32') {
    const fromStart = Boolean(startApps && startApps.apps.length > 0)
    const installed = apps.filter((item) => item.installed).length
    discovery = {
      ok: fromStart || installed > 3,
      source: fromStart ? 'start-apps' : installed > 0 ? 'shortcuts' : 'none',
      count: installed,
      detail: fromStart ? '' : startApps?.error || 'the Windows app list could not be read'
    }
    return
  }
  discovery = { ok: true, source: 'mac-folders', count: apps.filter((item) => item.installed).length, detail: '' }
}

/** Reads Start menu apps (desktop + Store) once every few minutes. Never throws. */
async function loadStartApps(): Promise<void> {
  if (startApps && Date.now() - startApps.at < START_APPS_MS) return
  if (startAppsLoading) return startAppsLoading
  startAppsLoading = (async () => {
    const powershell = join(system32(), 'WindowsPowerShell', 'v1.0', 'powershell.exe')
    const command =
      '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; ' +
      'Get-StartApps | Select-Object Name,AppID | ConvertTo-Json -Compress'
    const started = Date.now()
    const out = await readAsync(
      existsSync(powershell) ? powershell : 'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command],
      15_000,
      4_000_000
    )
    const apps = out === null ? [] : parseStartApps(out)
    const error = out === null ? 'PowerShell Get-StartApps did not run' : apps.length === 0 ? 'Get-StartApps returned no apps' : ''
    // Keep a previous good list over a failed refresh.
    if (apps.length === 0 && startApps && startApps.apps.length > 0) {
      startApps = { ...startApps, at: Date.now() }
    } else {
      startApps = { at: Date.now(), apps, error }
    }
    logDiag('apps', 'start apps read', { count: apps.length, ms: Date.now() - started, error })
  })().finally(() => {
    startAppsLoading = null
  })
  return startAppsLoading
}

/** Async process read with a timeout (Windows discovery must not block the main process). */
function readAsync(command: string, args: string[], timeoutMs: number, cap: number): Promise<string | null> {
  return new Promise((resolve) => {
    let out = ''
    let settled = false
    const finish = (value: string | null): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(value)
    }
    let child: ReturnType<typeof spawn>
    try {
      child = spawn(command, args, { shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    } catch {
      resolve(null)
      return
    }
    const timer = setTimeout(() => {
      try {
        child.kill()
      } catch {
        // ignore
      }
      finish(null)
    }, timeoutMs)
    child.stdout?.on('data', (chunk: Buffer) => {
      if (out.length < cap) out += chunk.toString('utf8')
    })
    let err = ''
    child.stderr?.on('data', (chunk: Buffer) => {
      if (err.length < 800) err += chunk.toString('utf8')
    })
    child.once('error', () => finish(null))
    child.once('close', (code) => {
      if (code !== 0 && err) logDiag('process', `${command.split(/[\\/]/).pop()} exited ${code}`, { stderr: err.slice(0, 300) })
      finish(code === 0 ? out : null)
    })
  })
}

function winStart(id: string): StartApp | null {
  const spec = WIN_FAMILIAR[id]
  if (!spec || !startApps) return null
  return findStartApp(startApps.apps, spec)
}

function appIdTarget(name: string, start: StartApp, familiarId?: string): Target {
  const explorer = join(process.env['SystemRoot'] || 'C:\\Windows', 'explorer.exe')
  return {
    name,
    familiar: true,
    winAppId: start.appId,
    winFamiliar: familiarId,
    run: () => runCommand(existsSync(explorer) ? explorer : 'explorer.exe', [appsFolderArg(start.appId)], false)
  }
}

function familiarTargets(): { id: string; name: string; installed: boolean; aliases: string[]; target: Target }[] {
  const specs: { id: string; name: string; aliases: string[]; locate: () => Target | null }[] = [
    { id: 'chrome', name: 'Chrome', aliases: ['chrome', 'google chrome'], locate: locateChrome },
    { id: 'browser', name: 'Browser', aliases: ['browser', 'my browser', 'preferred browser', 'the browser'], locate: locateBrowser },
    { id: 'calculator', name: 'Calculator', aliases: ['calculator', 'calc'], locate: locateCalculator },
    { id: 'editor', name: editorName(), aliases: ['text editor', 'editor', 'textedit', 'notepad'], locate: locateEditor },
    { id: 'downloads', name: 'Downloads', aliases: ['downloads', 'my downloads', 'download folder', 'downloads folder'], locate: locateDownloads },
    { id: 'files', name: filesName(), aliases: ['finder', 'file explorer', 'explorer', 'files'], locate: locateFiles },
    { id: 'word', name: 'Word', aliases: ['word', 'microsoft word', 'documents', 'my documents app', 'office'], locate: locateWord },
    { id: 'excel', name: 'Excel', aliases: ['excel', 'microsoft excel', 'spreadsheet', 'spreadsheets', 'my spreadsheets app', 'office'], locate: locateExcel },
    {
      id: 'powerpoint',
      name: 'PowerPoint',
      aliases: ['powerpoint', 'power point', 'microsoft powerpoint', 'slides', 'presentations', 'office'],
      locate: locatePowerPoint
    },
    { id: 'whatsapp', name: 'WhatsApp', aliases: ['whatsapp', 'whats app'], locate: locateWhatsApp },
    { id: 'notes', name: 'Notes', aliases: ['notes', 'apple notes', 'note'], locate: locateNotes }
  ]
  return specs.map((spec) => {
    const target = spec.locate()
    return {
      id: spec.id,
      name: spec.name,
      installed: target !== null,
      aliases: spec.aliases,
      target: target ?? {
        name: spec.name,
        familiar: true,
        missing: true,
        run: () => Promise.resolve(false)
      }
    }
  })
}

function unfamiliarTargets(known: Map<string, Target>): { id: string; target: Target }[] {
  const used = new Set<string>(known.keys())
  const found: { id: string; target: Target }[] = []
  const entries = process.platform === 'win32' ? windowsEntries(known) : scanMac()
  for (const entry of entries) {
    if (found.length >= SCAN_LIMIT) break
    let id = entry.id
    let n = 2
    while (used.has(id)) {
      id = `${entry.id}-${n}`
      n += 1
    }
    if (!parseActionId(id)) continue
    used.add(id)
    found.push({
      id,
      target: {
        name: entry.name,
        familiar: false,
        macApp: 'appPath' in entry ? entry.appPath : undefined,
        winLnk: 'lnkPath' in entry ? entry.lnkPath : undefined,
        winAppId: 'appId' in entry ? entry.appId : undefined,
        run: () => entry.open()
      }
    })
  }
  return found
}

function locateChrome(): Target | null {
  if (process.platform === 'win32') {
    const start = winStart('chrome')
    if (start) return appIdTarget('Chrome', start, 'chrome')
    const exe = firstExisting([
      join(programFiles(), 'Google', 'Chrome', 'Application', 'chrome.exe'),
      join(programFilesX86(), 'Google', 'Chrome', 'Application', 'chrome.exe'),
      join(localAppData(), 'Google', 'Chrome', 'Application', 'chrome.exe')
    ])
    return exe ? exeTarget('Chrome', exe, []) : null
  }
  const path = macApp('Google Chrome.app')
  return path ? macAppTarget('Chrome', path) : null
}

function locateBrowser(): Target | null {
  if (process.platform === 'win32') return windowsBrowser()
  const plist = join(homedir(), 'Library', 'Preferences', 'com.apple.LaunchServices', 'com.apple.launchservices.secure.plist')
  const xml = existsSync(plist) ? readLimited('/usr/bin/plutil', ['-convert', 'xml1', '-o', '-', plist], 1_000_000) : null
  const bundle = xml ? httpsBundle(xml) : null
  if (bundle && /^[A-Za-z0-9.-]{1,200}$/.test(bundle)) {
    return {
      name: BROWSER_NAMES[bundle] ?? 'Browser',
      familiar: true,
      macBundle: bundle,
      run: () => runCommand('/usr/bin/open', ['-b', bundle], true)
    }
  }
  const safari = macApp('Safari.app')
  return safari ? macAppTarget('Safari', safari) : null
}

function locateCalculator(): Target | null {
  if (process.platform === 'win32') {
    // Windows 10/11 Calculator is a Store app; calc.exe is a stub that starts it.
    const start = winStart('calculator')
    if (start) return appIdTarget('Calculator', start, 'calculator')
    const exe = join(system32(), 'calc.exe')
    return existsSync(exe) ? { ...exeTarget('Calculator', exe, []), winFamiliar: 'calculator' } : null
  }
  const path = macApp('Calculator.app')
  return path ? macAppTarget('Calculator', path) : null
}

function locateEditor(): Target | null {
  if (process.platform === 'win32') {
    const start = winStart('editor')
    if (start) return appIdTarget('Notepad', start, 'editor')
    const exe = join(system32(), 'notepad.exe')
    return existsSync(exe) ? exeTarget('Notepad', exe, []) : null
  }
  const path = macApp('TextEdit.app')
  return path ? macAppTarget('TextEdit', path) : null
}

function locateDownloads(): Target | null {
  const path = app.getPath('downloads')
  if (!path || !existsSync(path)) return null
  return {
    name: 'Downloads',
    familiar: true,
    run: async () => (await shell.openPath(path)) === ''
  }
}

function locateFiles(): Target | null {
  if (process.platform === 'win32') {
    const exe = join(system32(), 'explorer.exe')
    return existsSync(exe) ? exeTarget('File Explorer', exe, []) : null
  }
  const path = macApp('Finder.app')
  return path ? macAppTarget('Finder', path) : null
}

function locateWord(): Target | null {
  return locateOffice('Word', 'Microsoft Word.app', 'WINWORD.EXE')
}

function locateExcel(): Target | null {
  return locateOffice('Excel', 'Microsoft Excel.app', 'EXCEL.EXE')
}

function locatePowerPoint(): Target | null {
  return locateOffice('PowerPoint', 'Microsoft PowerPoint.app', 'POWERPNT.EXE')
}

function locateWhatsApp(): Target | null {
  if (process.platform === 'win32') {
    // Current WhatsApp for Windows is a Microsoft Store app (5319275A.WhatsAppDesktop).
    const start = winStart('whatsapp')
    if (start) return appIdTarget('WhatsApp', start, 'whatsapp')
    const exe = firstExisting([
      join(localAppData(), 'WhatsApp', 'WhatsApp.exe'),
      join(localAppData(), 'Programs', 'WhatsApp', 'WhatsApp.exe')
    ])
    return exe ? { ...exeTarget('WhatsApp', exe, []), winFamiliar: 'whatsapp' } : null
  }
  const path = macApp('WhatsApp.app')
  return path ? macAppTarget('WhatsApp', path) : null
}

function locateNotes(): Target | null {
  if (process.platform === 'win32') return null
  const system = '/System/Applications/Notes.app'
  if (existsSync(system)) return macAppTarget('Notes', system)
  const path = macApp('Notes.app')
  return path ? macAppTarget('Notes', path) : null
}

function locateOffice(name: string, macName: string, exeName: string): Target | null {
  if (process.platform === 'win32') {
    const familiarId = name.toLowerCase()
    const start = winStart(familiarId)
    if (start) return appIdTarget(name, start, familiarId)
    const exe = firstExisting([
      join(programFiles(), 'Microsoft Office', 'root', 'Office16', exeName),
      join(programFilesX86(), 'Microsoft Office', 'root', 'Office16', exeName),
      join(programFiles(), 'Microsoft Office', 'root', 'Office15', exeName)
    ])
    return exe ? exeTarget(name, exe, []) : null
  }
  const path = macApp(macName)
  return path ? macAppTarget(name, path) : null
}

function macApp(name: string): string | null {
  if (name.includes('/') || name.includes('\0')) return null
  for (const root of ['/Applications', '/System/Applications', join(homedir(), 'Applications'), '/System/Library/CoreServices']) {
    const path = join(root, name)
    if (existsSync(path)) return path
  }
  return null
}

function macAppTarget(name: string, path: string): Target {
  return { name, familiar: true, macApp: path, run: () => runCommand('/usr/bin/open', ['-a', path], true) }
}

function exeTarget(name: string, command: string, args: string[]): Target {
  return {
    name,
    familiar: true,
    winExe: command,
    run: () => runCommand(command, args, false)
  }
}

function windowsBrowser(): Target | null {
  const reg = join(system32(), 'reg.exe')
  const output = existsSync(reg)
    ? readLimited(
        reg,
        ['query', 'HKCU\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\https\\UserChoice', '/v', 'ProgId'],
        8000
      )
    : null
  const prog = output?.match(/ProgId\s+REG_SZ\s+(\S+)/)?.[1] ?? ''
  const candidates =
    prog === 'ChromeHTML'
      ? [join(programFiles(), 'Google', 'Chrome', 'Application', 'chrome.exe'), join(localAppData(), 'Google', 'Chrome', 'Application', 'chrome.exe')]
      : prog === 'MSEdgeHTM'
        ? [join(programFiles(), 'Microsoft', 'Edge', 'Application', 'msedge.exe')]
        : prog === 'FirefoxURL'
          ? [join(programFiles(), 'Mozilla Firefox', 'firefox.exe')]
          : []
  const exe = firstExisting(candidates)
  return exe ? exeTarget('Browser', exe, []) : null
}

function scanMac(): { id: string; name: string; appPath: string; open: () => Promise<boolean> }[] {
  const roots = ['/Applications', '/System/Applications', join(homedir(), 'Applications')]
  const skip = new Set([
    'Google Chrome.app',
    'Microsoft Word.app',
    'Microsoft Excel.app',
    'Microsoft PowerPoint.app',
    'WhatsApp.app',
    'Calculator.app',
    'TextEdit.app',
    'Finder.app'
  ])
  const found: { id: string; name: string; appPath: string; open: () => Promise<boolean> }[] = []
  for (const root of roots) {
    let entries: { name: string; isDirectory: () => boolean }[] = []
    try {
      entries = readdirSync(root, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (found.length >= SCAN_LIMIT) return found
      if (!entry.isDirectory() || !entry.name.endsWith('.app') || skip.has(entry.name)) continue
      if (entry.name.length > 80 || /[\0\r\n/\\]/.test(entry.name)) continue
      const path = join(root, entry.name)
      if (!inside(path, roots)) continue
      const name = entry.name.slice(0, -4)
      const id = `app-${slug(name)}`
      found.push({ id, name, appPath: path, open: () => runCommand('/usr/bin/open', ['-a', path], true) })
    }
  }
  return found
}

/** Start apps (desktop + Store) when readable; Start menu shortcuts otherwise. */
function windowsEntries(known: Map<string, Target>): { id: string; name: string; appId?: string; lnkPath?: string; open: () => Promise<boolean> }[] {
  const list = startApps?.apps ?? []
  if (list.length === 0) return scanWindows()
  const used = new Set<string>()
  for (const target of known.values()) if (target.winAppId) used.add(target.winAppId.toLowerCase())
  const explorer = join(process.env['SystemRoot'] || 'C:\\Windows', 'explorer.exe')
  const found: { id: string; name: string; appId: string; open: () => Promise<boolean> }[] = []
  for (const item of list) {
    if (found.length >= SCAN_LIMIT) break
    if (used.has(item.appId.toLowerCase()) || isNoiseStartApp(item.name)) continue
    found.push({
      id: `app-${slug(item.name)}`,
      name: item.name,
      appId: item.appId,
      open: () => runCommand(existsSync(explorer) ? explorer : 'explorer.exe', [appsFolderArg(item.appId)], false)
    })
  }
  return found
}

function scanWindows(): { id: string; name: string; lnkPath: string; open: () => Promise<boolean> }[] {
  const roots = [
    join(process.env['ProgramData'] || 'C:\\ProgramData', 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
    join(process.env['APPDATA'] || '', 'Microsoft', 'Windows', 'Start Menu', 'Programs')
  ].filter((root) => root.length > 0)
  const found: { id: string; name: string; lnkPath: string; open: () => Promise<boolean> }[] = []
  for (const root of roots) {
    collectLinks(root, roots, 0, found)
    if (found.length >= SCAN_LIMIT) break
  }
  return found.slice(0, SCAN_LIMIT)
}

function collectLinks(
  dir: string,
  roots: string[],
  depth: number,
  found: { id: string; name: string; lnkPath: string; open: () => Promise<boolean> }[]
): void {
  if (found.length >= SCAN_LIMIT || depth > 1) return
  let entries: { name: string; isDirectory: () => boolean; isFile: () => boolean }[] = []
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    if (found.length >= SCAN_LIMIT) return
    if (/[\0\r\n]/.test(entry.name) || entry.name.length > 80) continue
    const path = join(dir, entry.name)
    if (!inside(path, roots)) continue
    if (entry.isDirectory()) {
      collectLinks(path, roots, depth + 1, found)
      continue
    }
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.lnk')) continue
    const name = entry.name.slice(0, -4)
    found.push({
      id: `app-${slug(name)}`,
      name,
      lnkPath: path,
      open: async () => (await shell.openPath(path)) === ''
    })
  }
}

function inside(path: string, roots: string[]): boolean {
  return roots.some((root) => {
    const rel = relative(root, path)
    return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
  })
}

function slug(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
  return base || 'app'
}

function httpsBundle(xml: string): string | null {
  for (const part of xml.split('<dict>').slice(1)) {
    const body = part.split('</dict>')[0] ?? ''
    if (!/<key>LSHandlerURLScheme<\/key>\s*<string>https<\/string>/.test(body)) continue
    const role = body.match(/<key>LSHandlerRoleAll<\/key>\s*<string>([^<]+)<\/string>/)
    if (role?.[1]) return role[1].trim()
  }
  return null
}

function readLimited(command: string, args: string[], cap: number): string | null {
  const result = spawnSync(command, args, {
    shell: false,
    encoding: 'utf8',
    timeout: 1500,
    maxBuffer: cap,
    windowsHide: true
  })
  if (result.error || result.status !== 0 || typeof result.stdout !== 'string') return null
  return result.stdout.slice(0, cap)
}

function runCommand(command: string, args: string[], wait: boolean): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false
    const finish = (ok: boolean): void => {
      if (settled) return
      settled = true
      resolve(ok)
    }
    const child = spawn(command, args, {
      shell: false,
      detached: !wait,
      stdio: 'ignore',
      windowsHide: true
    })
    child.once('error', () => finish(false))
    if (!wait) {
      child.once('spawn', () => {
        child.unref()
        finish(true)
      })
      return
    }
    child.once('close', (code) => finish(code === 0))
  })
}

function firstExisting(paths: string[]): string | null {
  for (const path of paths) {
    if (!path) continue
    try {
      if (statSync(path).isFile() || statSync(path).isDirectory()) return path
    } catch {
      continue
    }
  }
  return null
}

function editorName(): string {
  return process.platform === 'win32' ? 'Notepad' : 'TextEdit'
}

function filesName(): string {
  return process.platform === 'win32' ? 'File Explorer' : 'Finder'
}

function programFiles(): string {
  return process.env['ProgramFiles'] || 'C:\\Program Files'
}

function programFilesX86(): string {
  return process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)'
}

function localAppData(): string {
  return process.env['LOCALAPPDATA'] || ''
}

function system32(): string {
  return join(process.env['SystemRoot'] || 'C:\\Windows', 'System32')
}

const BROWSER_NAMES: Record<string, string> = {
  'com.google.chrome': 'Chrome',
  'com.apple.safari': 'Safari',
  'com.microsoft.edgemac': 'Microsoft Edge',
  'org.mozilla.firefox': 'Firefox',
  'com.brave.browser': 'Brave',
  'company.thebrowser.browser': 'Arc'
}

function loadConfirmed(): Set<string> {
  if (confirmed) return confirmed
  confirmed = new Set()
  try {
    const parsed: unknown = JSON.parse(readFileSync(confirmedPath(), 'utf8'))
    if (!Array.isArray(parsed)) return confirmed
    for (const item of parsed) {
      if (parseActionId(item)?.startsWith('app-')) confirmed.add(item)
    }
  } catch {
    confirmed = new Set()
  }
  return confirmed
}

function remember(id: string): void {
  const action = parseActionId(id)
  if (!action?.startsWith('app-')) return
  const next = loadConfirmed()
  next.add(action)
  try {
    writeFileSync(confirmedPath(), JSON.stringify([...next]), 'utf8')
  } catch {
    // A failed save asks again next time. The launch still proceeds.
  }
}

function confirmedPath(): string {
  return join(app.getPath('userData'), 'confirmed-apps.json')
}
