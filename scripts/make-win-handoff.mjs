#!/usr/bin/env node
/**
 * Assemble the Windows handoff folder from an already-built installer:
 *   release/windows-handoff/MIKO-<version>/
 *     MIKO-<version>-win-x64.exe, START-HERE.txt, TROUBLESHOOTING.txt, SHA256SUMS.txt
 * release/ is git-ignored, so installers never enter source history.
 * Also checks the unpacked build for personal data and for the Windows helpers.
 * Run after `npm run dist:win`. Building on a Mac does not prove the app runs on Windows.
 */
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'

const root = process.cwd()
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const version = pkg.version
const installerName = `MIKO-${version}-win-x64.exe`
const installer = join(root, 'release', installerName)
const unpacked = join(root, 'release', 'win-unpacked')
const errors = []

if (!existsSync(installer)) {
  console.error(`Missing ${relative(root, installer)}. Run: npm run dist:win`)
  process.exit(1)
}
if (statSync(installer).mtimeMs < statSync(join(root, 'package.json')).mtimeMs - 5 * 60 * 1000) {
  console.warn('Warning: the installer is older than package.json. Rebuild with npm run dist:win if code changed.')
}

// Files that would mean personal data or credentials got packaged.
const FORBIDDEN = [/miko-settings\.json$/i, /miko-diagnostics\.log/i, /(^|[\\/])Cookies$/i, /Local Storage/i, /(^|[\\/])\.env/i, /\.(p12|pem|key|p8)$/i, /beta[\\/]secrets/i, /Partitions[\\/]/i]
function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    const st = statSync(path)
    if (st.isDirectory()) walk(path, out)
    else out.push(path)
  }
  return out
}
if (existsSync(unpacked)) {
  const files = walk(unpacked)
  for (const file of files) {
    const rel = relative(unpacked, file)
    if (FORBIDDEN.some((re) => re.test(rel))) errors.push(`Personal/credential file packaged: ${rel}`)
  }
  for (const need of ['listen-win.ps1', 'keys-win.ps1', 'whatsapp-win.ps1', 'tray-win.png']) {
    if (!existsSync(join(unpacked, 'resources', 'resources', need))) errors.push(`Windows helper missing from build: resources/${need}`)
  }
  if (!files.some((f) => /pet_animals[\\/].+\.glb$/i.test(f))) errors.push('Pet models missing from build (pet_animals/*.glb)')
  if (!files.some((f) => /MIKO\.exe$/i.test(f))) errors.push('MIKO.exe missing from win-unpacked')
} else {
  errors.push('release/win-unpacked not found (needed for the personal-data check). Run: npm run dist:win')
}

if (errors.length) {
  console.error('Handoff checks failed:')
  for (const e of errors) console.error(' -', e)
  process.exit(1)
}

const out = join(root, 'release', 'windows-handoff', `MIKO-${version}`)
rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })
copyFileSync(installer, join(out, installerName))
const fill = (text) => text.replaceAll('{{VERSION}}', version).replaceAll('{{INSTALLER}}', installerName).replace(/\r?\n/g, '\r\n')
for (const name of ['START-HERE.txt', 'TROUBLESHOOTING.txt']) {
  writeFileSync(join(out, name), fill(readFileSync(join(root, 'docs', 'handoff', name), 'utf8')))
}
const hash = createHash('sha256').update(readFileSync(installer)).digest('hex')
writeFileSync(join(out, 'SHA256SUMS.txt'), `${hash}  ${installerName}\r\n`)

const size = statSync(join(out, installerName)).size
console.log(`Handoff folder: ${out}`)
console.log(`Installer: ${join(out, installerName)}`)
console.log(`Size: ${size} bytes (${(size / 1024 / 1024).toFixed(1)} MB)`)
console.log(`SHA-256: ${hash}`)
console.log('Checks: no personal/credential files in win-unpacked; Windows helpers and pet models present.')
console.log('Not verified here: installing and running on Windows (see PROJECT_LOG Victus checklist).')
