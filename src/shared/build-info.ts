/**
 * App identity for Settings and feedback diagnostics.
 * buildId is stamped at package time when present; otherwise derived from version.
 */

export const APP_NAME = 'MIKO'
export const APP_VERSION = '0.1.1'
/** Channel label for beta builds. Not a security boundary. */
export const APP_CHANNEL = 'private-beta'

export function buildId(override?: string | null): string {
  const stamped = (override || process.env['MIKO_BUILD_ID'] || '').trim()
  if (stamped) return stamped.slice(0, 64)
  return `${APP_VERSION}+dev`
}

export function formatVersionLine(opts?: { buildId?: string | null; packaged?: boolean }): string {
  const id = buildId(opts?.buildId)
  const pack = opts?.packaged ? 'packaged' : 'dev'
  return `${APP_NAME} ${APP_VERSION} (${id}, ${APP_CHANNEL}, ${pack})`
}
