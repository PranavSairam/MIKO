#!/usr/bin/env node
/**
 * Private-beta release workflow.
 *
 * Local edits are NEVER published automatically. This script is the only
 * documented path that bumps a version, builds installers, and copies
 * updater metadata to a feed directory (or uploads when credentials exist).
 *
 * Usage:
 *   npm run release:beta -- --version 0.1.1
 *   MIKO_UPDATE_URL=https://updates.example.com/miko/beta/ npm run release:beta -- --version 0.1.1 --publish
 *   MIKO_SIGN=1 … npm run release:beta -- --version 0.1.2 --publish
 *
 * Credentials (Apple signing, upload keys) stay in the environment — never in the app.
 * See beta/DISTRIBUTION.md and beta/env.example.
 */
import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)

function flag(name) {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : null
}
function has(name) {
  return args.includes(name)
}

const version = flag('--version')
const doPublish = has('--publish')
const skipChecks = has('--skip-checks')
const arch = flag('--arch') || 'arm64'
const feedUrl = (process.env.MIKO_UPDATE_URL || 'http://127.0.0.1:8791/beta/').replace(/\/?$/, '/')
const manualReleaseUrl = (process.env.MIKO_MANUAL_RELEASE_URL || '').trim()
const outFeed = flag('--out-feed') || join(root, 'release', 'update-feed', 'beta')
const sign = process.env.MIKO_SIGN === '1' || process.env.MIKO_SIGN === 'true'
const builderConfig = sign ? 'electron-builder.signed.yml' : 'electron-builder.yml'

if (!version || !/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version)) {
  console.error('Usage: npm run release:beta -- --version 0.1.1 [--publish] [--arch arm64] [--out-feed path]')
  process.exit(1)
}

function run(cmd, cmdArgs, opts = {}) {
  console.log('>', cmd, cmdArgs.join(' '))
  const r = spawnSync(cmd, cmdArgs, { cwd: root, stdio: 'inherit', shell: false, env: { ...process.env, ...opts.env } })
  if (r.status !== 0) process.exit(r.status || 1)
}

function hasNotarizeCreds() {
  const appleId =
    process.env.APPLE_ID && process.env.APPLE_APP_SPECIFIC_PASSWORD && process.env.APPLE_TEAM_ID
  const apiKey = process.env.APPLE_API_KEY && process.env.APPLE_API_KEY_ID && process.env.APPLE_API_ISSUER
  const keychain = process.env.APPLE_KEYCHAIN && process.env.APPLE_KEYCHAIN_PROFILE
  return Boolean(appleId || apiKey || keychain)
}

console.log('MIKO private-beta release')
console.log(' version:', version)
console.log(' manual Download latest URL:', manualReleaseUrl || '(none — set MIKO_MANUAL_RELEASE_URL or paste in Preferences)')
console.log(' auto-update feed URL (signed path / local tests):', feedUrl)
console.log(' publish artifacts:', doPublish ? 'yes' : 'no (build only; copy feed locally)')
console.log(
  ' signing config:',
  builderConfig,
  sign ? '(MIKO_SIGN=1 Developer ID)' : '(ad-hoc identity "-" — Gatekeeper may warn; auto-install still disabled until Developer ID)'
)

if (sign) {
  if (!process.env.CSC_LINK && !process.env.CSC_NAME && process.env.CSC_IDENTITY_AUTO_DISCOVERY === 'false') {
    console.error('MIKO_SIGN=1 requires CSC_LINK (or a Keychain identity via CSC_NAME). See beta/env.example.')
    process.exit(1)
  }
  if (!process.env.CSC_LINK && !process.env.CSC_NAME) {
    console.log(' note: CSC_LINK unset — electron-builder will auto-discover a Developer ID in Keychain')
  }
  if (!hasNotarizeCreds()) {
    console.error(
      'MIKO_SIGN=1 requires notarization credentials (APPLE_ID + APPLE_APP_SPECIFIC_PASSWORD + APPLE_TEAM_ID, or APPLE_API_KEY set).'
    )
    process.exit(1)
  }
}

if (!skipChecks) {
  run('npm', ['run', 'typecheck'])
  run('npm', ['test'])
}

const pkgPath = join(root, 'package.json')
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
const previous = pkg.version
pkg.version = version
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n')
console.log(`Bumped package.json ${previous} → ${version}`)

const buildInfoPath = join(root, 'src/shared/build-info.ts')
let buildInfo = readFileSync(buildInfoPath, 'utf8')
buildInfo = buildInfo.replace(/export const APP_VERSION = '[^']+'/, `export const APP_VERSION = '${version}'`)
writeFileSync(buildInfoPath, buildInfo)

const feedConstPath = join(root, 'src/shared/update-feed-url.ts')
writeFileSync(
  feedConstPath,
  `/**
 * Generic update feed URL baked at release time (see scripts/release-beta.mjs).
 * Used only when the running app is Developer ID–signed (auto path).
 * Override at runtime via userData/update-feed.json for local A→B tests.
 */
export const UPDATE_FEED_URL = ${JSON.stringify(feedUrl)}
`
)
writeFileSync(
  join(root, 'src/shared/manual-release-url.ts'),
  `/**
 * Shared folder / direct DMG link for the zero-budget beta.
 * Baked at release time via MIKO_MANUAL_RELEASE_URL (see scripts/release-beta.mjs).
 * Testers can also paste a link in Preferences. Not a secret.
 */
export const MANUAL_RELEASE_URL = ${JSON.stringify(manualReleaseUrl)}
`
)
mkdirSync(join(root, 'build'), { recursive: true })
writeFileSync(
  join(root, 'build/app-update.yml'),
  `provider: generic\nurl: ${feedUrl}\nchannel: beta\nupdaterCacheDirName: miko-updater\n`
)

const buildId = process.env.MIKO_BUILD_ID || `${version.replace(/\./g, '')}T${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`
run('npm', ['run', 'build'], { env: { MIKO_BUILD_ID: buildId } })

const builderArgs = [
  'electron-builder',
  '--mac',
  `--${arch}`,
  '--config',
  builderConfig,
  `-c.publish.url=${feedUrl}`
]
if (sign && process.env.CSC_NAME) {
  builderArgs.push(`-c.mac.identity=${process.env.CSC_NAME}`)
}
run('npx', builderArgs, { env: { MIKO_BUILD_ID: buildId, MIKO_UPDATE_URL: feedUrl } })

mkdirSync(outFeed, { recursive: true })
const releaseDir = join(root, 'release')
const wanted = readdirSync(releaseDir).filter(
  (name) =>
    name.includes(version) ||
    name.startsWith('beta') ||
    name.startsWith('latest') ||
    name.endsWith('.yml') ||
    name.endsWith('.blockmap')
)
for (const name of wanted) {
  const src = join(releaseDir, name)
  if (!existsSync(src)) continue
  copyFileSync(src, join(outFeed, name))
}

// Normalize channel file names for electron-updater generic+channel=beta
for (const name of readdirSync(outFeed)) {
  if (name === 'latest-mac.yml') copyFileSync(join(outFeed, name), join(outFeed, 'beta-mac.yml'))
  if (name === 'latest.yml') copyFileSync(join(outFeed, name), join(outFeed, 'beta.yml'))
}

console.log('\nFeed directory:', outFeed)
console.log('Files:', readdirSync(outFeed).join(', '))

if (doPublish) {
  const dest = process.env.MIKO_UPDATE_PUBLISH_CMD
  if (!dest) {
    console.log(`
--publish was set, but MIKO_UPDATE_PUBLISH_CMD is empty.
Artifacts are ready in ${outFeed}.
Upload that folder (zip, dmg, *.yml, *.blockmap) to your HTTPS host at:
  ${feedUrl}

Example:
  MIKO_UPDATE_PUBLISH_CMD='bash beta/hosting/publish-r2.sh'
  MIKO_UPDATE_PUBLISH_CMD='bash beta/hosting/publish-rsync.sh'

Do NOT embed upload credentials in the desktop app.
`)
  } else {
    run('bash', ['-lc', dest], { env: { MIKO_UPDATE_FEED_DIR: outFeed, MIKO_UPDATE_URL: feedUrl } })
  }
}

console.log(`
Done. Testers on channel beta will see ${version} after the feed is reachable.
Faulty release recovery: publish a higher version; do not reuse a broken version number.
Restore package.json manually if you need to abort (was ${previous}).
Signing: ${sign ? 'signed+notarized config used' : 'unsigned (set MIKO_SIGN=1 when Apple credentials are ready)'}.
`)
