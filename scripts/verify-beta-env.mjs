#!/usr/bin/env node
/**
 * Verify beta release env without printing secret values.
 * Loads beta/.env.local if present (does not override existing env).
 */
import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const envPath = join(root, 'beta/.env.local')
const secretsDir = join(process.env.HOME || '', 'Library/Application Support/MIKO-release')

function loadEnvFile(path) {
  if (!existsSync(path)) return false
  const text = readFileSync(path, 'utf8')
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq < 0) continue
    const key = trimmed.slice(0, eq).trim()
    let val = trimmed.slice(eq + 1).trim()
    if (
      (val.startsWith("'") && val.endsWith("'")) ||
      (val.startsWith('"') && val.endsWith('"'))
    ) {
      val = val.slice(1, -1)
    }
    // Expand $HOME only (common for CSC_LINK).
    val = val.replace(/\$HOME\b/g, process.env.HOME || '')
    val = val.replace(/\$\{HOME\}/g, process.env.HOME || '')
    if (process.env[key] === undefined) process.env[key] = val
  }
  return true
}

function present(name) {
  const v = process.env[name]
  return Boolean(v && String(v).trim())
}

function realUrl(name) {
  const v = String(process.env[name] || '').trim()
  if (!v) return false
  if (/example\.com/i.test(v)) return false
  if (/YOUR_HOST|yourdomain|localhost|127\.0\.0\.1/i.test(v)) return false
  return /^https:\/\//i.test(v)
}

function realDest(name) {
  const v = String(process.env[name] || '').trim()
  if (!v) return false
  if (/example\.com|YOUR_HOST|yourdomain/i.test(v)) return false
  return v.includes(':')
}

function maskStatus(ok, detail = '') {
  return ok ? `ok${detail ? ` (${detail})` : ''}` : 'MISSING'
}

const loaded = loadEnvFile(envPath)
console.log('beta/.env.local:', loaded ? 'loaded' : 'not found (using process env only)')

const identities = spawnSync('security', ['find-identity', '-v', '-p', 'codesigning'], {
  encoding: 'utf8'
})
const idOut = `${identities.stdout || ''}${identities.stderr || ''}`
const hasDevId = /Developer ID Application:/i.test(idOut)
const hasAppleDev = /Apple Development:/i.test(idOut)
console.log('Keychain Developer ID Application:', hasDevId ? 'present' : 'MISSING')
console.log('Keychain Apple Development (dev-only):', hasAppleDev ? 'present' : 'absent')

const cscLink = (process.env.CSC_LINK || '').replace(/^file:\/\//, '')
let cscFile = 'unset'
if (cscLink) {
  if (existsSync(cscLink)) {
    const st = statSync(cscLink)
    cscFile = st.size > 0 ? `file exists (${st.size} bytes)` : 'file empty'
  } else if (/^[A-Za-z0-9+/=\s]+$/.test(cscLink) && cscLink.length > 200) {
    cscFile = 'looks like base64 blob (not opened)'
  } else {
    cscFile = 'path not found'
  }
}

console.log(
  'CSC_LINK:',
  maskStatus(present('CSC_LINK') && cscFile.startsWith('file exists'), cscFile || 'unset')
)
console.log('CSC_KEY_PASSWORD:', maskStatus(present('CSC_KEY_PASSWORD')))
console.log('APPLE_ID:', maskStatus(present('APPLE_ID')))
console.log('APPLE_APP_SPECIFIC_PASSWORD:', maskStatus(present('APPLE_APP_SPECIFIC_PASSWORD')))
console.log('APPLE_TEAM_ID:', maskStatus(present('APPLE_TEAM_ID'), present('APPLE_TEAM_ID') ? `${String(process.env.APPLE_TEAM_ID).length} chars` : ''))
console.log('MIKO_UPDATE_URL:', maskStatus(realUrl('MIKO_UPDATE_URL'), present('MIKO_UPDATE_URL') && !realUrl('MIKO_UPDATE_URL') ? 'placeholder' : ''))
console.log('MIKO_FEEDBACK_URL:', maskStatus(realUrl('MIKO_FEEDBACK_URL'), present('MIKO_FEEDBACK_URL') && !realUrl('MIKO_FEEDBACK_URL') ? 'placeholder' : ''))
console.log('MIKO_RSYNC_DEST:', maskStatus(realDest('MIKO_RSYNC_DEST'), present('MIKO_RSYNC_DEST') && !realDest('MIKO_RSYNC_DEST') ? 'placeholder' : ''))
console.log('MIKO_UPDATE_PUBLISH_CMD:', maskStatus(present('MIKO_UPDATE_PUBLISH_CMD')))
console.log('Secrets directory:', existsSync(secretsDir) ? 'present' : `missing (${secretsDir})`)

const step1 =
  hasDevId &&
  present('CSC_LINK') &&
  cscFile.startsWith('file exists') &&
  present('CSC_KEY_PASSWORD') &&
  present('APPLE_ID') &&
  present('APPLE_APP_SPECIFIC_PASSWORD') &&
  present('APPLE_TEAM_ID')

const step2 = realUrl('MIKO_UPDATE_URL') && realDest('MIKO_RSYNC_DEST') && present('MIKO_UPDATE_PUBLISH_CMD')
const step3 = realUrl('MIKO_FEEDBACK_URL')

const zeroBudget =
  present('MIKO_MANUAL_RELEASE_URL') ||
  realUrl('MIKO_MANUAL_RELEASE_URL') ||
  Boolean(String(process.env.MIKO_MANUAL_RELEASE_URL || '').trim())

console.log('')
console.log('Zero-budget manual release URL:', present('MIKO_MANUAL_RELEASE_URL') ? 'set' : 'optional (can paste in Preferences)')
console.log('Paid path — Step 1 Apple:', step1 ? 'READY' : 'not required for free beta')
console.log('Paid path — Step 2 update host:', step2 ? 'READY' : 'not required for free beta')
console.log('Paid path — Step 3 feedback URL:', step3 ? 'READY' : 'not required for free beta')
console.log('Default friend beta uses unsigned packaging + Export feedback + Download latest (see beta/TESTER.md).')

process.exit(0)
