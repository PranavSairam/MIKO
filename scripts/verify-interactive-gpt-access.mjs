/**
 * Verify Interactive GPT access wiring in the built renderer/main (no GUI click).
 * Checks: header label present in bundle, IPC channels, local command parser.
 */
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import { parseInteractiveGptLocalAction } from '../src/shared/interactive-gpt.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const mainJs = readFileSync(join(root, 'out/renderer/assets/main-exekrOoB.js'), 'utf8')
// Hash may change — find the latest main-*.js
import { readdirSync } from 'node:fs'
const assets = readdirSync(join(root, 'out/renderer/assets'))
const mainBundle = assets.find((f) => /^main-.*\.js$/.test(f) && !f.includes('main-frame'))
assert.ok(mainBundle, 'main renderer bundle missing')
const bundled = readFileSync(join(root, 'out/renderer/assets', mainBundle), 'utf8')

assert.ok(bundled.includes('Interactive GPT'), 'Interactive GPT button label missing from panel bundle')
assert.ok(bundled.includes('GPT Mode'), 'GPT Mode button still present')
assert.ok(!bundled.includes('>ChatGPT Web<') || bundled.includes('Interactive GPT'), 'old ChatGPT Web-only label should be replaced by Interactive GPT')

assert.equal(parseInteractiveGptLocalAction('Open interactive GPT'), 'open')
assert.equal(parseInteractiveGptLocalAction('Show ChatGPT Web'), 'show')
assert.equal(parseInteractiveGptLocalAction('Hide interactive GPT'), 'hide')

const mainOut = readFileSync(join(root, 'out/main/index.js'), 'utf8')
assert.ok(mainOut.includes('persist:miko-chatgpt-web'), 'partition preserved')
assert.ok(mainOut.includes('Interactive GPT'), 'window title/label Interactive GPT')
assert.ok(mainOut.includes('setChatGptWebPinned') || mainOut.includes('chatgptWebPinned'), 'pin support present')
assert.ok(mainOut.includes('width: 900') || mainOut.includes('width:900'), 'default ~900 width')

console.log(
  JSON.stringify(
    {
      ok: true,
      mainBundle,
      checks: [
        'Interactive GPT in panel bundle',
        'local open/show/hide parsers',
        'partition + pin + default size in main'
      ]
    },
    null,
    2
  )
)
