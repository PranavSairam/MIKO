import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { routeCommand, type CatalogApp, type RouterContext } from './commands.ts'
import { parseInteractiveGptLocalAction } from './interactive-gpt.ts'
import { parseWebSearch, searchQueryFromUrl, webSearchUrl } from './web-search.ts'

const catalog: CatalogApp[] = [
  { id: 'chrome', name: 'Chrome', installed: true, familiar: true, aliases: ['chrome', 'google chrome'] },
  { id: 'calculator', name: 'Calculator', installed: true, familiar: true, aliases: ['calculator'] },
  { id: 'whatsapp', name: 'WhatsApp', installed: true, familiar: true, aliases: ['whatsapp'] }
]

const route = (text: string, ctx: RouterContext = {}) => routeCommand(text, 'typed', catalog, [], ctx)
const spoken = (text: string, ctx: RouterContext = {}) => routeCommand(text, 'voice', catalog, [], ctx)

const afterSearch: RouterContext = {
  lastSearch: { query: 'budget headphones', browser: 'chrome' },
  recentDestination: 'web'
}
const afterWhatsApp: RouterContext = { messaging: 'whatsapp', recentDestination: 'whatsapp' }

describe('Chrome web search routing', () => {
  it('parses browser, site and query separately', () => {
    const cases: [string, string][] = [
      ['Search Chrome for budget headphones.', 'budget headphones'],
      ['Google transfer learning.', 'transfer learning'],
      ['Search for weather in Chennai in Chrome.', 'weather in Chennai'],
      ['look up rust lifetimes on Google', 'rust lifetimes']
    ]
    for (const [text, query] of cases) {
      for (const result of [route(text), spoken(text)]) {
        assert.equal(result.type, 'open-url', text)
        if (result.type !== 'open-url') continue
        assert.equal(result.search, query, text)
        assert.equal(result.browser, 'chrome', text)
        assert.equal(searchQueryFromUrl(result.url), query, text)
      }
    }
    // Typed and voice give the same single action.
    assert.deepEqual(route('Search Chrome for budget headphones.'), spoken('Search Chrome for budget headphones.'))
  })

  it('keeps site opens as sites, not searches', () => {
    const youtube = route('Open YouTube in Chrome.')
    assert.equal(youtube.type, 'open-url')
    if (youtube.type === 'open-url') {
      assert.equal(youtube.url, 'https://www.youtube.com/')
      assert.equal(youtube.search, undefined)
    }
    const chatgpt = route('Open ChatGPT in Chrome.')
    assert.equal(chatgpt.type, 'open-url')
    if (chatgpt.type === 'open-url') assert.equal(chatgpt.url, 'https://chatgpt.com/')
    // Opening ChatGPT in Chrome is a browser action: never an Interactive GPT / GPT Mode action.
    assert.equal(parseInteractiveGptLocalAction('Open ChatGPT in Chrome.'), null)
    assert.equal(parseInteractiveGptLocalAction('Search Chrome for budget headphones.'), null)
    assert.equal(parseWebSearch('Google Maps'), null)
    assert.equal(parseWebSearch('google chrome'), null)
  })

  it('encodes the query so it cannot change the URL', () => {
    const url = webSearchUrl('c++ & c# ?tips #1 100% “naïve” a=b')
    const u = new URL(url)
    assert.equal(u.origin + u.pathname, 'https://www.google.com/search')
    assert.deepEqual([...u.searchParams.keys()], ['q'])
    assert.equal(u.searchParams.get('q'), 'c++ & c# ?tips #1 100% “naïve” a=b')
    assert.equal(u.hash, '')
    assert.equal(searchQueryFromUrl('https://www.google.com/maps?q=x'), null)
    assert.equal(searchQueryFromUrl('https://www.youtube.com/'), null)
    assert.ok(webSearchUrl('x'.repeat(1000)).length < 400)
  })

  it('carries an explicit Chrome profile choice (overrides a saved default)', () => {
    const result = route('Search for weather in Chennai in Chrome with Work')
    assert.equal(result.type, 'open-url')
    if (result.type === 'open-url') {
      assert.equal(result.search, 'weather in Chennai')
      assert.equal(result.chromeProfileQuery, 'Work')
    }
    const plain = route('Search Chrome for budget headphones')
    if (plain.type === 'open-url') assert.equal(plain.chromeProfileQuery, null)
  })

  it('“search instead for …” follows the destination in use', () => {
    const web = spoken('Search instead for wireless headphones.', afterSearch)
    assert.equal(web.type, 'open-url')
    if (web.type === 'open-url') {
      assert.equal(web.search, 'wireless headphones')
      assert.equal(web.browser, 'chrome')
    }
    assert.deepEqual(spoken('Search instead for Gayu Sis.', afterWhatsApp), { type: 'whatsapp', query: 'Gayu Sis' })
    // No context: a short clarification, nothing opened.
    const unclear = route('Search instead for wireless headphones.')
    assert.equal(unclear.type, 'unknown')
  })

  it('bare “search for …” uses the current task context, and stays unchanged without one', () => {
    const web = route('search for earbuds', afterSearch)
    assert.equal(web.type, 'open-url')
    assert.deepEqual(route('search for Mukundan', afterWhatsApp), { type: 'whatsapp', query: 'Mukundan' })
    // Mac behaviour without context is unchanged (mail or app question).
    assert.equal(route('search for budget headphones').type, 'mail-or-app')
  })
})

describe('WhatsApp contact routing vs web search', () => {
  it('explicit WhatsApp destinations are contact searches, never web searches', () => {
    assert.deepEqual(route('Search for Dad in WhatsApp.'), { type: 'whatsapp', query: 'Dad' })
    assert.deepEqual(route('Search for Dad in WhatsApp.', afterSearch), { type: 'whatsapp', query: 'Dad' })
    assert.deepEqual(route('Open WhatsApp and find Mukundan.'), { type: 'whatsapp', query: 'Mukundan' })
    assert.equal(parseWebSearch('search for Dad on WhatsApp'), null)
    assert.deepEqual(route('Open WhatsApp.'), { type: 'launch', appId: 'whatsapp', name: 'WhatsApp' })
  })

  it('after WhatsApp is targeted, “Open Dad” is contact navigation but app names still open apps', () => {
    assert.deepEqual(spoken('Open Dad.', afterWhatsApp), { type: 'whatsapp', query: 'Dad' })
    assert.deepEqual(spoken('Go to Gayu Sis.', afterWhatsApp), { type: 'whatsapp', query: 'Gayu Sis' })
    assert.deepEqual(spoken('Open Calculator', afterWhatsApp), { type: 'launch', appId: 'calculator', name: 'Calculator' })
    assert.equal(spoken('Open Chrome', afterWhatsApp).type, 'chrome-profiles')
    // Without WhatsApp context, “Open Dad” is not silently sent to WhatsApp.
    assert.notEqual(spoken('Open Dad.').type, 'whatsapp')
  })

  it('Cancel is a workflow cancel in every context', () => {
    for (const ctx of [{}, afterSearch, afterWhatsApp, { awaitingWaRecipient: true }]) {
      assert.deepEqual(spoken('Cancel.', ctx), { type: 'cancel-workflow' })
    }
  })
})
