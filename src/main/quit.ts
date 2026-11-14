import { spawn, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { quitTarget } from './apps'

export type CloseStatus = 'requested' | 'already-closed' | 'unsupported' | 'failed' | 'needs-confirm'

export interface CloseRequestResult {
  status: CloseStatus
  name: string
}

type Identity =
  | { platform: 'darwin'; name: string; bundleId: string }
  | { platform: 'win32'; name: string; exe: string }

const BUNDLE = /^[A-Za-z0-9.-]{1,200}$/
const watches = new Map<string, number>()

export async function requestClose(id: string, force: boolean, confirm: boolean): Promise<CloseRequestResult> {
  const target = await quitTarget(id)
  if (!target) return { status: 'failed', name: 'That app' }
  const identity = resolveIdentity(target)
  if (!identity) return { status: 'unsupported', name: target.name }
  const running = processIds(identity)
  if (running.length === 0) return { status: 'already-closed', name: identity.name }
  if (force && !confirm) return { status: 'needs-confirm', name: identity.name }
  const sent = force ? forceQuit(identity, running) : gracefulQuit(identity)
  if (!sent) return { status: 'failed', name: identity.name }
  return { status: 'requested', name: identity.name }
}

export function watchClose(id: string, onDone: (status: 'closed' | 'still-open') => void): void {
  const generation = (watches.get(id) ?? 0) + 1
  watches.set(id, generation)
  const started = Date.now()
  const timer = setInterval(() => {
    if (watches.get(id) !== generation) {
      clearInterval(timer)
      return
    }
    void quitTarget(id).then((target) => {
      if (watches.get(id) !== generation) return
      const identity = target ? resolveIdentity(target) : null
      const running = identity ? processIds(identity).length > 0 : false
      if (!running) {
        clearInterval(timer)
        onDone('closed')
        return
      }
      if (Date.now() - started >= 8000) {
        clearInterval(timer)
        onDone('still-open')
      }
    })
  }, 500)
}

function resolveIdentity(target: {
  name: string
  macApp?: string
  macBundle?: string
  winExe?: string
  winLnk?: string
}): Identity | null {
  if (process.platform === 'darwin') {
    const bundle = target.macBundle && BUNDLE.test(target.macBundle) ? target.macBundle : bundleFromApp(target.macApp)
    return bundle ? { platform: 'darwin', name: target.name, bundleId: bundle } : null
  }
  if (process.platform === 'win32') {
    const exe = existingExe(target.winExe) ?? linkTarget(target.winLnk)
    return exe ? { platform: 'win32', name: target.name, exe } : null
  }
  return null
}

function bundleFromApp(appPath: string | undefined): string | null {
  if (!appPath || appPath.includes('\0') || !appPath.endsWith('.app') || !existsSync(appPath)) return null
  const plist = `${appPath}/Contents/Info.plist`
  const output = read('/usr/bin/plutil', ['-extract', 'CFBundleIdentifier', 'raw', '-o', '-', plist], 300)
  const id = output?.trim() ?? ''
  return BUNDLE.test(id) ? id : null
}

function existingExe(exe: string | undefined): string | null {
  if (!exe || exe.includes('\0') || !existsSync(exe)) return null
  return exe
}

function linkTarget(lnk: string | undefined): string | null {
  if (!lnk || process.platform !== 'win32' || !lnk.toLowerCase().endsWith('.lnk') || !existsSync(lnk)) return null
  const output = read(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', '(New-Object -ComObject WScript.Shell).CreateShortcut($env:MIKO_LNK).TargetPath'],
    1000,
    { MIKO_LNK: lnk }
  )
  return existingExe(output?.trim())
}

function processIds(identity: Identity): number[] {
  if (identity.platform === 'darwin') {
    const output = read(
      '/usr/bin/osascript',
      ['-e', `tell application "System Events" to get unix id of every process whose bundle identifier is "${identity.bundleId}"`],
      2000
    )
    return parseIds(output)
  }
  const output = read(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', '(Get-Process | Where-Object { $_.Path -eq $env:MIKO_EXE }).Id -join ","'],
    4000,
    { MIKO_EXE: identity.exe }
  )
  return parseIds(output)
}

function gracefulQuit(identity: Identity): boolean {
  if (identity.platform === 'darwin') {
    spawn(
      '/usr/bin/osascript',
      ['-e', `with timeout of 2 seconds\ntell application id "${identity.bundleId}" to quit\nend timeout`],
      { shell: false, stdio: 'ignore', windowsHide: true }
    ).once('error', () => undefined)
    return true
  }
  const child = spawn(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      'Get-Process | Where-Object { $_.Path -eq $env:MIKO_EXE } | ForEach-Object { [void]$_.CloseMainWindow() }'
    ],
    { shell: false, stdio: 'ignore', windowsHide: true, env: { ...process.env, MIKO_EXE: identity.exe } }
  )
  child.once('error', () => undefined)
  return true
}

function forceQuit(identity: Identity, pids: number[]): boolean {
  const safe = pids.filter((pid) => Number.isInteger(pid) && pid > 0 && pid !== process.pid)
  if (safe.length === 0) return false
  if (identity.platform === 'darwin') {
    const child = spawn('/bin/kill', ['-9', ...safe.map(String)], { shell: false, stdio: 'ignore' })
    child.once('error', () => undefined)
    return true
  }
  const child = spawn(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', 'Stop-Process -Id ($env:MIKO_PIDS -split ",") -Force'],
    { shell: false, stdio: 'ignore', windowsHide: true, env: { ...process.env, MIKO_PIDS: safe.join(',') } }
  )
  child.once('error', () => undefined)
  return true
}

function parseIds(output: string | null): number[] {
  if (!output) return []
  return output
    .split(/[^0-9]+/)
    .map((part) => Number(part))
    .filter((pid) => Number.isInteger(pid) && pid > 0)
}

function read(command: string, args: string[], cap: number, extra?: Record<string, string>): string | null {
  const result = spawnSync(command, args, {
    shell: false,
    encoding: 'utf8',
    timeout: 4000,
    maxBuffer: cap,
    windowsHide: true,
    env: extra ? { ...process.env, ...extra } : process.env
  })
  if (typeof result.stdout !== 'string') return null
  return result.stdout.slice(0, cap)
}
