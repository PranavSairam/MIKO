#!/usr/bin/env node
/**
 * Creates local config.json with random invite codes and an owner token.
 * Never commit config.json or data/.
 */
import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(fileURLToPath(import.meta.url))
const configPath = join(root, 'config.json')
const dataDir = join(root, 'data')

if (existsSync(configPath)) {
  console.log('config.json already exists — leaving it alone.')
  process.exit(0)
}

mkdirSync(dataDir, { recursive: true })
const config = {
  port: 8787,
  host: '127.0.0.1',
  /** Tester invite codes (revocable). Rotate by editing this file. */
  invites: [`beta-${randomBytes(6).toString('hex')}`, `beta-${randomBytes(6).toString('hex')}`],
  /** Owner dashboard / export token. Keep offline. */
  ownerToken: randomBytes(24).toString('hex'),
  rateLimitPerHour: 20,
  maxBodyBytes: 2_500_000
}

writeFileSync(configPath, JSON.stringify(config, null, 2), { mode: 0o600 })
writeFileSync(join(dataDir, 'reports.json'), '[]', { mode: 0o600 })
console.log('Wrote', configPath)
console.log('Invite codes:', config.invites.join(', '))
console.log('Owner token (keep private):', config.ownerToken)
console.log('Start with: npm start  (in beta/feedback-server)')
