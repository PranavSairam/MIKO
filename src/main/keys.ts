import { parseKeyEvent } from '../shared/keys'
import { compileHelper, launchHelper, type HelperHandle, type HelperSpec } from './helper-app'
import { startWinKeys } from './win-keys'
import { logDiag } from './diagnostics'

const KEYS_HELPER: HelperSpec = {
  source: 'keys-mac.swift',
  name: 'miko-keys',
  displayName: 'MIKO Keys',
  bundleId: 'com.miko.keys',
  frameworks: ['AppKit', 'CoreGraphics', 'IOKit', 'ApplicationServices'],
  plistExtra: ''
}

export interface KeyHandlers {
  talkStart: () => void
  talkStop: () => void
  /** front: pid of the app in front when the chord was pressed (macOS helper), if known. */
  switcher: (front?: number) => void
  permission: () => void
}

/**
 * Runs the "MIKO Keys" helper for as long as MIKO runs (macOS: keys-mac.swift; Windows: keys-win.ps1).
 * If it dies unexpectedly it is relaunched once. Returns a stop function.
 */
export function startKeys(handlers: KeyHandlers): () => void {
  // Windows: Shift + A hold-to-talk and Tab + Q (keys-win.ps1). The Mac path below is unchanged.
  if (process.platform === 'win32') return startWinKeys(handlers)
  if (process.platform !== 'darwin') return () => undefined
  let stopped = false
  let restarts = 0
  let handle: HelperHandle | null = null
  let talking = false

  const launch = (): void => {
    const helper = compileHelper(KEYS_HELPER)
    if (!helper) {
      logDiag('keys', 'helper not built (swiftc missing or failed)')
      return
    }
    handle = launchHelper(
      helper.root,
      ['--parent', String(process.pid)],
      (line) => {
        if (/^\{"pid":/.test(line.trim())) logDiag('keys', 'helper started')
        const event = parseKeyEvent(line)
        if (!event) return
        // Event names only (never keystrokes): shows whether the chord reaches MIKO.
        if (event.kind === 'switcher' || event.kind === 'permission') logDiag('keys', `helper event: ${event.kind}`)
        if (event.kind === 'talk-start') {
          talking = true
          handlers.talkStart()
        } else if (event.kind === 'talk-stop') {
          talking = false
          handlers.talkStop()
        } else if (event.kind === 'switcher') {
          handlers.switcher(event.front)
        } else {
          handlers.permission()
        }
      },
      () => {
        handle = null
        if (talking) {
          talking = false
          handlers.talkStop()
        }
        if (stopped || restarts >= 1) return
        restarts += 1
        setTimeout(() => {
          if (!stopped) launch()
        }, 1000)
      }
    )
  }

  // Compiling the helper the first time takes a few seconds; keep it off the startup path.
  setTimeout(launch, 1500)
  return () => {
    stopped = true
    handle?.signal('TERM')
  }
}
