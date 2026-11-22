import { spawn, spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join, relative } from 'node:path'
import { app, shell } from 'electron'
import { parseActionId, type CatalogApp } from '../shared/commands'

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
const CHATGPT_URL = 'https://chatgpt.com'

let cache: { at: number; apps: CatalogApp[]; targets: Map<string, Target> } | null = null
let confirmed: Set<string> | null = null

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
  if (!target.familiar && !confirm && !loadConfirmed().has(action)) {
    return { ok: false, reason: `Confirm before launching ${target.name}.` }
  }
  if (!target.familiar && confirm) remember(action)
  const opened = await target.run()
  if (!opened) return { ok: false, reason: `${target.name} did not open.` }
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
  return cache
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
        run: () => Promise.resolve(false)
      }
    }
  })
}

function unfamiliarTargets(known: Map<string, Target>): { id: string; target: Target }[] {
  const used = new Set<string>(known.keys())
  const found: { id: string; target: Target }[] = []
  const entries = process.platform === 'win32' ? scanWindows() : scanMac()
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
        run: () => entry.open()
      }
    })
  }
  return found
}

function locateChrome(): Target | null {
  if (process.platform === 'win32') {
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
    const exe = join(system32(), 'calc.exe')
    return existsSync(exe) ? exeTarget('Calculator', exe, []) : null
  }
  const path = macApp('Calculator.app')
  return path ? macAppTarget('Calculator', path) : null
}

function locateEditor(): Target | null {
  if (process.platform === 'win32') {
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
    const exe = firstExisting([
      join(localAppData(), 'WhatsApp', 'WhatsApp.exe'),
      join(localAppData(), 'Programs', 'WhatsApp', 'WhatsApp.exe')
    ])
    return exe ? exeTarget('WhatsApp', exe, []) : null
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
