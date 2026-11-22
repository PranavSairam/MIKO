#!/usr/bin/env node
/**
 * Packaging / resource / case-portability checks for Windows handoff.
 * Does not claim a Mac-built artifact launches successfully on Windows.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const root = process.cwd()
const require = createRequire(import.meta.url)
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'))
const yml = readFileSync(join(root, 'electron-builder.yml'), 'utf8')

const errors = []

if (pkg.version !== lock.version) {
  errors.push(`package-lock.json version ${lock.version} != package.json ${pkg.version}`)
}
if (!pkg.scripts?.['dist:win']) errors.push('Missing npm script dist:win')
if (!/artifactName:\s*MIKO-\$\{version\}-win-\$\{arch\}\.\$\{ext\}/.test(yml)) {
  errors.push('electron-builder.yml missing Windows artifactName pattern')
}
if (!/icon:\s*build\/icon\.ico/.test(yml)) errors.push('Windows icon not set to build/icon.ico')
if (!existsSync(join(root, 'build', 'icon.ico'))) errors.push('build/icon.ico missing')
if (!existsSync(join(root, 'resources', 'tray-win.png'))) errors.push('resources/tray-win.png missing')
if (!existsSync(join(root, 'resources', 'listen-win.ps1'))) errors.push('resources/listen-win.ps1 missing')
if (!existsSync(join(root, 'docs', 'WINDOWS_SETUP.md'))) errors.push('docs/WINDOWS_SETUP.md missing')
if (!existsSync(join(root, 'docs', 'WINDOWS_USER_GUIDE.md'))) errors.push('docs/WINDOWS_USER_GUIDE.md missing')

// Case-sensitive resource names used from code (must match on case-sensitive volumes).
for (const name of ['tray-mac.png', 'tray-win.png', 'listen-win.ps1', 'listen-mac.swift', 'ax-mac.swift']) {
  const p = join(root, 'resources', name)
  if (!existsSync(p)) errors.push(`resources/${name} missing (case must match)`)
}

const expectedInstaller = `release/MIKO-${pkg.version}-win-x64.exe`
console.log(`Expected installer path after dist:win: ${expectedInstaller}`)
console.log(`package.json version: ${pkg.version}`)
if (existsSync(join(root, 'release'))) {
  const artifacts = readdirSync(join(root, 'release')).filter((f) => /\.exe$/i.test(f))
  if (artifacts.length) console.log('Existing .exe artifacts:', artifacts.join(', '))
  else console.log('No .exe artifacts in release/ yet (expected until dist:win runs on a packaging host).')
}

// Confirm electron-builder resolves.
try {
  require.resolve('electron-builder/package.json')
} catch {
  errors.push('electron-builder not installed')
}

if (errors.length) {
  console.error('Windows packaging checks failed:')
  for (const e of errors) console.error(' -', e)
  process.exit(1)
}
console.log('Windows packaging config checks passed.')
console.log('Note: building the .exe on macOS is only a packaging check — not a successful Windows launch.')
