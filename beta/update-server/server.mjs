#!/usr/bin/env node
/**
 * Local static feed for A→B update tests (generic provider).
 * Serves release/update-feed/beta at http://127.0.0.1:8791/beta/
 */
import { createServer } from 'node:http'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'release', 'update-feed')
const host = '127.0.0.1'
const port = Number(process.env.MIKO_UPDATE_PORT || 8791)

const TYPES = {
  '.yml': 'text/yaml; charset=utf-8',
  '.yaml': 'text/yaml; charset=utf-8',
  '.json': 'application/json',
  '.zip': 'application/zip',
  '.dmg': 'application/octet-stream',
  '.blockmap': 'application/octet-stream',
  '.exe': 'application/octet-stream'
}

const server = createServer((req, res) => {
  try {
    const url = new URL(req.url || '/', `http://${host}:${port}`)
    let rel = decodeURIComponent(url.pathname).replace(/^\/+/, '')
    if (!rel || rel.endsWith('/')) rel = join(rel, 'index.html')
    const full = normalize(join(root, rel))
    if (!full.startsWith(root) || !existsSync(full) || !statSync(full).isFile()) {
      res.writeHead(404, { 'content-type': 'text/plain' })
      res.end('not found')
      return
    }
    const body = readFileSync(full)
    res.writeHead(200, {
      'content-type': TYPES[extname(full)] || 'application/octet-stream',
      'cache-control': 'no-store',
      'content-length': body.length,
      'access-control-allow-origin': '*'
    })
    res.end(body)
  } catch (error) {
    res.writeHead(500, { 'content-type': 'text/plain' })
    res.end(String(error))
  }
})

server.listen(port, host, () => {
  console.log(`MIKO update feed http://${host}:${port}/beta/`)
  console.log(`Serving ${join(root, 'beta')}`)
  console.log('Point a packaged build’s feed override at that URL (Preferences test / update-feed.json).')
})
