/**
 * Spotify media controls that must not steal focus.
 * Prefer Spotify AppleScript (short timeout). Media-key fallback only when
 * Spotify’s player state actually changes — never claim a foreign media session.
 */
import { spawnSync } from 'node:child_process'
import { runAx } from './ax'

export type SpotifyAction = 'play-pause' | 'next' | 'previous' | 'volume-up' | 'volume-down' | 'status'

export type SpotifyMediaResult = {
  ok: boolean
  reason: string
  running: boolean
  state: string
  track: string
  artist: string
  volume: number | null
  method: 'spotify-applescript' | 'system-media-key' | 'none'
}

function empty(reason: string, method: SpotifyMediaResult['method'] = 'none'): SpotifyMediaResult {
  return { ok: false, reason, running: false, state: 'unavailable', track: '', artist: '', volume: null, method }
}

function isSpotifyRunning(): boolean {
  if (process.platform !== 'darwin') return false
  const r = spawnSync(
    'osascript',
    ['-e', 'tell application "System Events" to (name of processes) contains "Spotify"'],
    { encoding: 'utf8', timeout: 2500, shell: false }
  )
  return (r.stdout || '').trim().toLowerCase() === 'true'
}

function runSpotifyScript(source: string, timeoutMs = 3200): { ok: boolean; out: string; err: string } {
  const r = spawnSync('osascript', ['-e', source], {
    encoding: 'utf8',
    timeout: timeoutMs,
    shell: false
  })
  if (r.error && (r.error as NodeJS.ErrnoException).code === 'ETIMEDOUT') {
    return { ok: false, out: '', err: 'timeout' }
  }
  if (r.status !== 0) {
    return { ok: false, out: (r.stdout || '').trim(), err: (r.stderr || r.error?.message || 'failed').trim() }
  }
  return { ok: true, out: (r.stdout || '').trim(), err: '' }
}

async function mediaKey(key: 'play' | 'next' | 'prev' | 'volup' | 'voldown'): Promise<boolean> {
  const payload = await runAx(['media-key', '--key', key], undefined, 4000)
  return payload.ok === true
}

function parseStatusBlob(blob: string): Pick<SpotifyMediaResult, 'state' | 'track' | 'artist' | 'volume'> {
  // Format: state|track|artist|volume
  const parts = blob.split('|')
  const state = (parts[0] || 'unavailable').toLowerCase()
  const track = parts[1] || ''
  const artist = parts[2] || ''
  const volRaw = parts[3]
  const volume = volRaw !== undefined && volRaw !== '' && Number.isFinite(Number(volRaw)) ? Number(volRaw) : null
  return { state, track, artist, volume }
}

/** Avoid AppleScript reserved/ambiguous short names like `st` (syntax error → “unknown” in UI). */
const STATUS_SCRIPT = `
tell application "Spotify"
  set playerState to (player state as string)
  set trackName to ""
  set artistName to ""
  try
    set trackName to name of current track
    set artistName to artist of current track
  end try
  set volLevel to sound volume
  return playerState & "|" & trackName & "|" & artistName & "|" & (volLevel as string)
end tell
`

async function readStatus(running: boolean): Promise<SpotifyMediaResult> {
  if (!running) {
    return { ...empty('Spotify isn’t running.'), running: false, ok: true, state: 'stopped' }
  }
  const hit = runSpotifyScript(STATUS_SCRIPT)
  if (!hit.ok) {
    return {
      ok: false,
      reason:
        hit.err === 'timeout'
          ? 'Spotify Automation timed out — grant Automation for MIKO → Spotify in System Settings.'
          : `Couldn’t read Spotify (${hit.err || 'error'}).`,
      running: true,
      state: 'unavailable',
      track: '',
      artist: '',
      volume: null,
      method: 'none'
    }
  }
  const parsed = parseStatusBlob(hit.out)
  return {
    ok: true,
    reason: '',
    running: true,
    ...parsed,
    method: 'spotify-applescript'
  }
}

export async function spotifyMedia(action: SpotifyAction): Promise<SpotifyMediaResult> {
  if (process.platform !== 'darwin') {
    return empty('Spotify controls aren’t available on this platform.')
  }
  const running = isSpotifyRunning()
  if (!running && action !== 'status') {
    return empty('Spotify isn’t running.', 'none')
  }

  if (action === 'status') {
    return readStatus(running)
  }

  const before = await readStatus(running)

  // Prefer AppleScript — does not require Spotify to be frontmost.
  const scripts: Record<Exclude<SpotifyAction, 'status'>, string> = {
    'play-pause': 'tell application "Spotify" to playpause',
    next: 'tell application "Spotify" to next track',
    previous: 'tell application "Spotify" to previous track',
    'volume-up': 'tell application "Spotify" to set sound volume to (sound volume + 10)',
    'volume-down': 'tell application "Spotify" to set sound volume to (sound volume - 10)'
  }
  const hit = runSpotifyScript(scripts[action])
  if (hit.ok) {
    const status = await readStatus(true)
    return {
      ok: true,
      reason: status.track ? `${status.track}${status.artist ? ` · ${status.artist}` : ''}` : '',
      running: true,
      state: status.state,
      track: status.track,
      artist: status.artist,
      volume: status.volume,
      method: 'spotify-applescript'
    }
  }

  // Fallback: system media keys — only accept if Spotify’s reported state/track changes.
  const keyMap: Record<Exclude<SpotifyAction, 'status'>, 'play' | 'next' | 'prev' | 'volup' | 'voldown'> = {
    'play-pause': 'play',
    next: 'next',
    previous: 'prev',
    'volume-up': 'volup',
    'volume-down': 'voldown'
  }
  const keyed = await mediaKey(keyMap[action])
  if (!keyed) {
    return {
      ok: false,
      reason:
        hit.err === 'timeout'
          ? 'Spotify Automation timed out and media keys failed. Grant Automation for MIKO → Spotify, or use Control original.'
          : `Spotify control failed (${hit.err || 'error'}).`,
      running,
      state: before.state || 'unavailable',
      track: before.track,
      artist: before.artist,
      volume: before.volume,
      method: 'none'
    }
  }
  await new Promise((r) => setTimeout(r, 350))
  const after = await readStatus(running)
  const changed =
    after.ok &&
    (after.state !== before.state ||
      after.track !== before.track ||
      after.volume !== before.volume ||
      after.artist !== before.artist)
  if (!changed) {
    return {
      ok: false,
      reason:
        'Media key was sent but Spotify’s state didn’t change — another app may own the system media session. Use Automation (AppleScript) or Control original.',
      running,
      state: after.state || before.state || 'unavailable',
      track: after.track || before.track,
      artist: after.artist || before.artist,
      volume: after.volume ?? before.volume,
      method: 'none'
    }
  }
  return {
    ok: true,
    reason: 'Used a system media key; Spotify state changed.',
    running,
    state: after.state,
    track: after.track,
    artist: after.artist,
    volume: after.volume,
    method: 'system-media-key'
  }
}
