import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import { sourcePath } from './helper-app'

/**
 * miko-ax: one-shot Accessibility helper (resources/ax-mac.swift), compiled on
 * first use and run as a child process. It only touches the focused text
 * field of the frontmost app when MIKO asks, never password fields, and
 * restores the clipboard only if it still holds MIKO's own temporary payload.
 */

export interface AxResult {
  ok: boolean
  reason: string
  pid: number
  bundle: string
  app: string
  role: string
  editable: boolean
  secure: boolean
  sig: string
  text?: string | null
  hash: string
  valueLength: number
  method: string
  verified: boolean
  clipboardRestored: boolean
}

let binary: string | null = null

function compile(): string | null {
  if (process.platform !== 'darwin') return null
  const source = sourcePath('ax-mac.swift')
  if (!source) return null
  const dir = join(app.getPath('userData'), 'bin')
  const out = join(dir, 'miko-ax')
  if (binary && existsSync(binary)) return binary
  mkdirSync(dir, { recursive: true })
  if (!existsSync(out) || statSync(out).mtimeMs < statSync(source).mtimeMs) {
    const built = spawnSync('swiftc', ['-O', '-framework', 'AppKit', '-framework', 'ApplicationServices', '-o', out, source], {
      shell: false,
      encoding: 'utf8',
      timeout: 120000
    })
    if (built.status !== 0 || !existsSync(out)) return null
  }
  binary = out
  return out
}

const FAILED: AxResult = {
  ok: false,
  reason: 'MIKO’s Accessibility helper isn’t available.',
  pid: 0,
  bundle: '',
  app: '',
  role: '',
  editable: false,
  secure: false,
  sig: '',
  hash: '',
  valueLength: -1,
  method: '',
  verified: false,
  clipboardRestored: false
}

export function runAx(args: string[], input?: string, timeoutMs = 8000): Promise<AxResult> {
  const path = compile()
  if (!path) return Promise.resolve(FAILED)
  return new Promise((resolve) => {
    const proc = spawn(path, args, { shell: false, stdio: ['pipe', 'pipe', 'ignore'] })
    let out = ''
    const timer = setTimeout(() => {
      proc.kill('SIGTERM')
      resolve({ ...FAILED, reason: 'The Accessibility helper timed out.' })
    }, timeoutMs)
    proc.stdout?.on('data', (chunk: Buffer) => {
      out += chunk.toString('utf8')
    })
    proc.once('error', () => {
      clearTimeout(timer)
      resolve(FAILED)
    })
    proc.once('close', () => {
      clearTimeout(timer)
      try {
        resolve({ ...FAILED, ...(JSON.parse(out.trim().split('\n').pop() ?? '{}') as Partial<AxResult>) })
      } catch {
        resolve(FAILED)
      }
    })
    proc.stdin?.end(input ?? '')
  })
}
