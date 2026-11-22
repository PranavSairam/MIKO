import { spawn, spawnSync } from 'node:child_process'
import {
  closeSync,
  constants,
  createReadStream,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { app } from 'electron'

/**
 * Small Swift helper apps (speech, keys) are compiled into userData, ad-hoc
 * signed, and launched through LaunchServices (`open`), not spawned as
 * children. TCC checks the Info.plist and grants of the *responsible*
 * process; a plain child would inherit whatever app launched MIKO.
 * Launched by `open`, each helper is its own responsible process.
 * Output comes back as JSON lines through a FIFO. The helper's first line
 * is `{"pid":N}`, which the launcher keeps for signals and does not forward.
 *
 * Privacy grants (Accessibility, Input Monitoring, Microphone) belong to the
 * exact ad-hoc build, so a helper is rebuilt only when its source *content*
 * changes (a SHA-256 stamp kept beside the bundle), never because a checkout
 * or copy touched the file's date. Each rebuild needs the grant again.
 */

/** Tests set MIKO_NO_HELPERS=1 (unpackaged only) so automated runs don't start helpers or trigger permission prompts. */
export function helpersDisabled(): boolean {
  return process.env['MIKO_NO_HELPERS'] === '1' && !app.isPackaged
}

export interface HelperSpec {
  /** File in resources/. */
  source: string
  /** Bundle and executable name, e.g. miko-listen. */
  name: string
  displayName: string
  bundleId: string
  frameworks: string[]
  /** Extra Info.plist keys, already formatted as <key>…</key><string>…</string>. */
  plistExtra: string
}

export interface HelperHandle {
  signal: (name: 'USR1' | 'TERM') => void
}

export function compileHelper(spec: HelperSpec): { root: string; binary: string } | null {
  if (process.platform !== 'darwin' || helpersDisabled()) return null
  const source = sourcePath(spec.source)
  if (!source) return null
  const stampPath = join(app.getPath('userData'), `${spec.name}.build`)
  const stamp = createHash('sha256').update(readFileSync(source)).update(spec.frameworks.join(',')).digest('hex')
  const root = join(app.getPath('userData'), `${spec.name}.app`)
  const macOS = join(root, 'Contents', 'MacOS')
  const binary = join(macOS, spec.name)
  mkdirSync(macOS, { recursive: true })
  const plistPath = join(root, 'Contents', 'Info.plist')
  const plist = helperPlist(spec)
  const plistChanged = !existsSync(plistPath) || readFileSync(plistPath, 'utf8') !== plist
  if (plistChanged) writeFileSync(plistPath, plist)
  const stampMatches = existsSync(stampPath) && readFileSync(stampPath, 'utf8').trim() === stamp
  // Builds from before the stamp existed: keep the binary (and its grants) when it's newer than the source.
  const legacyCurrent = !existsSync(stampPath) && existsSync(binary) && statSync(binary).mtimeMs >= statSync(source).mtimeMs
  if (existsSync(binary) && (stampMatches || legacyCurrent)) {
    if (legacyCurrent) writeFileSync(stampPath, stamp)
    if (plistChanged) sign(root)
    return { root, binary }
  }
  const frameworks = spec.frameworks.flatMap((framework) => ['-framework', framework])
  const compiled = spawnSync('swiftc', ['-O', ...frameworks, '-o', binary, source], {
    shell: false,
    encoding: 'utf8',
    timeout: 120000
  })
  if (compiled.status !== 0 || !existsSync(binary)) return null
  sign(root)
  writeFileSync(stampPath, stamp)
  return { root, binary }
}

export function launchHelper(
  root: string,
  args: string[],
  onLine: (line: string) => void,
  onEnd: () => void
): HelperHandle | null {
  let dir: string
  try {
    dir = mkdtempSync(join(tmpdir(), 'miko-helper-'))
  } catch {
    return null
  }
  const outPipe = join(dir, 'out')
  const made = spawnSync('/usr/bin/mkfifo', ['-m', '600', outPipe], { shell: false, timeout: 2000 })
  if (made.status !== 0) {
    rmSync(dir, { recursive: true, force: true })
    return null
  }
  let pid = 0
  let pendingSignal: 'USR1' | 'TERM' | null = null
  const send = (name: 'USR1' | 'TERM'): void => {
    try {
      process.kill(pid, name === 'USR1' ? 'SIGUSR1' : 'SIGTERM')
    } catch {
      // Already gone.
    }
  }
  // Opening a FIFO for reading blocks (on the libuv pool) until the helper opens its stdout.
  const output = createReadStream(outPipe)
  let buffer = ''
  output.on('data', (chunk: Buffer | string) => {
    buffer += chunk.toString()
    let splitAt = buffer.indexOf('\n')
    while (splitAt >= 0) {
      const line = buffer.slice(0, splitAt).trim()
      buffer = buffer.slice(splitAt + 1)
      splitAt = buffer.indexOf('\n')
      if (!line) continue
      const announced = /^\{"pid":(\d{1,7})\}$/.exec(line)
      if (announced && pid === 0) {
        pid = Number(announced[1])
        if (pendingSignal) send(pendingSignal)
        pendingSignal = null
        continue
      }
      onLine(line)
    }
  })
  let finished = false
  const finish = (): void => {
    if (finished) return
    finished = true
    rmSync(dir, { recursive: true, force: true })
    onEnd()
  }
  output.once('close', finish)
  output.once('error', finish)
  const opener = spawn(
    '/usr/bin/open',
    ['-n', '-W', '-g', '--stdin', '/dev/null', '--stdout', outPipe, '--stderr', '/dev/null', root, '--args', ...args],
    { shell: false, stdio: 'ignore' }
  )
  const unblock = (): void => {
    // If the helper never opened the FIFO, the pending read open would hang. A brief writer releases it.
    try {
      closeSync(openSync(outPipe, constants.O_WRONLY | constants.O_NONBLOCK))
    } catch {
      // Already open and closed by the helper, or gone.
    }
    setTimeout(finish, 1500)
  }
  opener.once('close', unblock)
  opener.once('error', unblock)
  return {
    signal: (name) => {
      if (pid > 0) send(name)
      else pendingSignal = name
    }
  }
}

export function sourcePath(name: string): string | null {
  const candidates = [
    join(__dirname, '../../resources', name),
    join(process.cwd(), 'resources', name),
    // Packaged beta: electron-builder copies resources/ into process.resourcesPath.
    ...(process.resourcesPath
      ? [join(process.resourcesPath, 'resources', name), join(process.resourcesPath, name)]
      : [])
  ]
  return candidates.find((candidate) => existsSync(candidate)) ?? null
}

function sign(root: string): void {
  spawnSync('codesign', ['-s', '-', '--force', root], { shell: false, timeout: 10000 })
}

function helperPlist(spec: HelperSpec): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>${spec.bundleId}</string>
<key>CFBundleName</key><string>${spec.displayName}</string>
<key>CFBundleExecutable</key><string>${spec.name}</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleShortVersionString</key><string>1.0</string>
<key>LSUIElement</key><true/>
${spec.plistExtra}
</dict></plist>
`
}
