/**
 * Generic update feed URL baked at release time (see scripts/release-beta.mjs).
 * Not a secret — the feed itself is the invited-beta distribution point.
 * Override at runtime via userData/update-feed.json for local A→B tests.
 */
export const UPDATE_FEED_URL = 'http://127.0.0.1:8791/beta/'
