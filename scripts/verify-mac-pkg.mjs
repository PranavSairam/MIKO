#!/usr/bin/env node
/**
 * Verify a packaged MIKO.app (or app inside a DMG) for free-beta distribution.
 * Distinguishes: signature validity vs Gatekeeper acceptance vs quarantine.
 *
 * Usage:
 *   node scripts/verify-mac-pkg.mjs release/mac-arm64/MIKO.app
 *   node scripts/verify-mac-pkg.mjs release/MIKO-0.1.1-arm64.dmg
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'

const target = process.argv[2]
if (!target) {
  console.error('Usage: node scripts/verify-mac-pkg.mjs <MIKO.app|MIKO.dmg>')
  process.exit(2)
}

function run(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: 'utf8' })
  return {
    status: r.status ?? 1,
    out: `${r.stdout || ''}${r.stderr || ''}`.trim()
  }
}

let appPath = target
let mount = null
let tmp = null

try {
  if (target.endsWith('.dmg')) {
    tmp = mkdtempSync(join(tmpdir(), 'miko-verify-'))
    mount = join(tmp, 'mnt')
    spawnSync('mkdir', ['-p', mount])
    const att = run('hdiutil', ['attach', '-nobrowse', '-readonly', '-mountpoint', mount, target])
    if (att.status !== 0) {
      console.error('Could not mount DMG:\n', att.out)
      process.exit(1)
    }
    appPath = join(mount, 'MIKO.app')
  }

  if (!existsSync(appPath)) {
    console.error('App not found:', appPath)
    process.exit(1)
  }

  console.log('App:', appPath)
  const info = run('codesign', ['-dvvv', appPath])
  const id = /Identifier=(.+)/.exec(info.out)?.[1] || '?'
  const sig = /Signature=(.+)/.exec(info.out)?.[1] || '?'
  const sealed = /Sealed Resources version=(\d+)/.exec(info.out)
  console.log(' codesign identity line:', sig)
  console.log(' Identifier:', id)
  console.log(' Sealed Resources:', sealed ? `yes (v${sealed[1]})` : 'NONE')

  const verify = run('codesign', ['--verify', '--deep', '--strict', '--verbose=2', appPath])
  const signatureValid = verify.status === 0 && /satisfies its Designated Requirement/i.test(verify.out)
  console.log(' Signature validity (codesign --verify --deep --strict):', signatureValid ? 'VALID' : 'INVALID')
  if (!signatureValid) console.log('  detail:', verify.out.split('\n').slice(-3).join(' | '))

  const spctl = run('spctl', ['--assess', '--type', 'execute', '-vv', appPath])
  const gatekeeperAccepted = spctl.status === 0
  console.log(' Gatekeeper acceptance (spctl):', gatekeeperAccepted ? 'ACCEPTED' : 'REJECTED (expected for ad-hoc / unnotarized)')
  if (!gatekeeperAccepted) console.log('  detail:', spctl.out.split('\n').slice(0, 3).join(' | '))

  const q = run('xattr', ['-p', 'com.apple.quarantine', appPath])
  console.log(' Quarantine xattr on app:', q.status === 0 ? 'PRESENT' : 'absent')

  const arch = run('lipo', ['-archs', join(appPath, 'Contents/MacOS/MIKO')])
  console.log(' Executable arch:', arch.out || '?')

  if (!signatureValid) {
    console.error('\nFAIL: invalid signature — do not distribute (causes “App is damaged” on other Macs).')
    process.exit(1)
  }
  if (!sealed) {
    console.error('\nFAIL: no sealed resources — treat as invalid for distribution.')
    process.exit(1)
  }
  console.log('\nOK for free-beta handoff: signature valid + sealed. Gatekeeper may still warn until notarized.')
  process.exit(0)
} finally {
  if (mount) run('hdiutil', ['detach', mount])
  if (tmp) rmSync(tmp, { recursive: true, force: true })
}
