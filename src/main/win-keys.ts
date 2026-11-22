import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { groupWindows, parseWinKeysLine, type WinSwitcherEntry, type WinWindow } from '../shared/win-keys'
import { logDiag } from './diagnostics'
import { sourcePath } from './helper-app'
import type { KeyHandlers } from './keys'

/**
 * Windows "MIKO Keys" (resources/keys-win.ps1): Shift + A hold-to-talk, Tab + Q switcher,
 * and the window list / focus / close the switcher needs. One long-lived PowerShell
 * process; relaunched once if it dies. Windows only — the Mac keeps keys-mac.swift.
 */

let proc: ChildProcessWithoutNullStreams | null = null
let nextId = 1
const pending = new Map<number, { resolve: (value: { windows?: WinWindow[]; ok?: boolean }) => void; timer: NodeJS.Timeout }>()

export function powershellPath(): string {
  const path = join(process.env['SystemRoot'] || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  return existsSync(path) ? path : 'powershell.exe'
}

export function startWinKeys(handlers: KeyHandlers): () => void {
  if (process.platform !== 'win32') return () => undefined
  let stopped = false
  let restarts = 0
  let talking = false

  const launch = (): void => {
    const script = sourcePath('keys-win.ps1')
    if (!script) {
      logDiag('keys', 'keys-win.ps1 not found')
      return
    }
    let child: ChildProcessWithoutNullStreams
    try {
      child = spawn(
        powershellPath(),
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, '-Parent', String(process.pid)],
        { shell: false, windowsHide: true }
      )
    } catch (error) {
      logDiag('keys', 'helper spawn threw', { error: String(error) })
      return
    }
    proc = child
    const started = Date.now()
    let buffer = ''
    let stderr = ''
    child.stdout.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf8')
      let at = buffer.indexOf('\n')
      while (at >= 0) {
        const raw = buffer.slice(0, at).trim()
        buffer = buffer.slice(at + 1)
        at = buffer.indexOf('\n')
        if (!raw) continue
        const line = parseWinKeysLine(raw)
        if (!line) continue
        if (line.type === 'event') {
          if (line.event.kind === 'talk-start') {
            talking = true
            handlers.talkStart()
          } else if (line.event.kind === 'talk-stop') {
            talking = false
            handlers.talkStop()
          } else if (line.event.kind === 'switcher') {
            handlers.switcher()
          }
        } else if (line.type === 'ready') {
          logDiag('keys', 'Windows key hook ready (Shift+A talk, Tab+Q switcher)', { ms: Date.now() - started })
        } else if (line.type === 'error') {
          logDiag('keys', `helper error: ${line.code}`, { detail: line.detail })
        } else if (line.type === 'reply') {
          const waiter = pending.get(line.id)
          if (!waiter) continue
          pending.delete(line.id)
          clearTimeout(waiter.timer)
          if (line.error) logDiag('keys', 'switcher request failed', { error: line.error })
          waiter.resolve({ windows: line.windows, ok: line.ok })
        }
      }
    })
    child.stderr.on('data', (chunk: Buffer) => {
      if (stderr.length < 1500) stderr += chunk.toString('utf8')
    })
    child.stdin.on('error', () => undefined)
    child.once('error', (error) => logDiag('keys', 'helper failed to start', { error: String(error) }))
    child.once('close', (code) => {
      if (proc === child) proc = null
      for (const [id, waiter] of pending) {
        clearTimeout(waiter.timer)
        waiter.resolve({})
        pending.delete(id)
      }
      if (talking) {
        talking = false
        handlers.talkStop()
      }
      if (stopped) return
      logDiag('keys', 'helper exited', { code, stderr: stderr.trim().slice(0, 400) })
      if (restarts >= 1) return
      restarts += 1
      setTimeout(() => {
        if (!stopped) launch()
      }, 1500)
    })
  }

  // Compiling the C# hook takes a moment; keep it off the startup path.
  setTimeout(launch, 1500)
  return () => {
    stopped = true
    const child = proc
    proc = null
    try {
      child?.stdin.end()
    } catch {
      // ignore
    }
    setTimeout(() => {
      try {
        if (child && child.exitCode === null) child.kill()
      } catch {
        // ignore
      }
    }, 500)
  }
}

function request(command: string, timeoutMs: number): Promise<{ windows?: WinWindow[]; ok?: boolean }> {
  const child = proc
  if (!child) return Promise.resolve({})
  const id = nextId++
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pending.delete(id)
      resolve({})
    }, timeoutMs)
    pending.set(id, { resolve, timer })
    try {
      child.stdin.write(`${command.replace('#', String(id))}\n`)
    } catch {
      clearTimeout(timer)
      pending.delete(id)
      resolve({})
    }
  })
}

export function winKeysRunning(): boolean {
  return proc !== null
}

/** Open apps, one per process, front-most first. MIKO's own windows are left out. */
export async function winListApps(): Promise<WinSwitcherEntry[]> {
  const reply = await request('list #', 4000)
  return groupWindows(reply.windows ?? [], [process.execPath])
}

export async function winFocusWindow(hwnd: number): Promise<boolean> {
  if (!Number.isSafeInteger(hwnd) || hwnd <= 0) return false
  const reply = await request(`focus # ${hwnd}`, 3000)
  return reply.ok === true
}

/** Polite close (WM_CLOSE): apps still show their own save prompts. */
export async function winCloseWindows(hwnds: number[]): Promise<boolean> {
  const list = hwnds.filter((h) => Number.isSafeInteger(h) && h > 0).slice(0, 40)
  if (!list.length) return false
  const reply = await request(`close # ${list.join(',')}`, 3000)
  return reply.ok === true
}
