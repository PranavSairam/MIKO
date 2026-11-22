import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { routeCommand, type CatalogApp } from './commands.ts'
import {
  appsFolderArg,
  findStartApp,
  isLaunchableAppId,
  isNoiseStartApp,
  parseStartApps,
  tasklistHas,
  WIN_FAMILIAR
} from './win-apps.ts'

const SAMPLE = JSON.stringify([
  { Name: 'Calculator', AppID: 'Microsoft.WindowsCalculator_8wekyb3d8bbwe!App' },
  { Name: 'WhatsApp', AppID: '5319275A.WhatsAppDesktop_cv1g1gvanyjgm!App' },
  { Name: 'Google Chrome', AppID: 'Chrome' },
  { Name: 'Uninstall Foo', AppID: '{7C5A40EF-A0FB-4BFC-874A-C0F2E0B9FA8E}\\Foo\\uninstall.exe' },
  { Name: 'OpenAI Website', AppID: 'https://openai.com/' },
  { Name: 'Calculator', AppID: 'Microsoft.WindowsCalculator_8wekyb3d8bbwe!App' }
])

describe('Windows Start apps', () => {
  it('parses Get-StartApps JSON, dropping web links and duplicates', () => {
    const apps = parseStartApps(`﻿${SAMPLE}`)
    assert.deepEqual(
      apps.map((app) => app.name),
      ['Calculator', 'WhatsApp', 'Google Chrome', 'Uninstall Foo']
    )
  })

  it('accepts a single object (PowerShell emits one item without an array)', () => {
    const apps = parseStartApps(JSON.stringify({ Name: 'Calculator', AppID: 'Microsoft.WindowsCalculator_8wekyb3d8bbwe!App' }))
    assert.equal(apps.length, 1)
  })

  it('returns nothing for garbage instead of throwing', () => {
    assert.deepEqual(parseStartApps('not json'), [])
    assert.deepEqual(parseStartApps(''), [])
  })

  it('finds Calculator and WhatsApp by name, or by package identity when localized', () => {
    const apps = parseStartApps(SAMPLE)
    assert.equal(findStartApp(apps, WIN_FAMILIAR.calculator)?.appId, 'Microsoft.WindowsCalculator_8wekyb3d8bbwe!App')
    assert.equal(findStartApp(apps, WIN_FAMILIAR.whatsapp)?.appId, '5319275A.WhatsAppDesktop_cv1g1gvanyjgm!App')
    const localized = parseStartApps(JSON.stringify([{ Name: 'Rechner', AppID: 'Microsoft.WindowsCalculator_8wekyb3d8bbwe!App' }]))
    assert.equal(findStartApp(localized, WIN_FAMILIAR.calculator)?.name, 'Rechner')
    assert.equal(findStartApp(localized, WIN_FAMILIAR.whatsapp), null)
  })

  it('launches through shell:AppsFolder with one argument', () => {
    assert.equal(appsFolderArg('Microsoft.WindowsCalculator_8wekyb3d8bbwe!App'), 'shell:AppsFolder\\Microsoft.WindowsCalculator_8wekyb3d8bbwe!App')
    assert.equal(isLaunchableAppId('a"b'), false)
    assert.equal(isLaunchableAppId('https://x.test/'), false)
    assert.equal(isLaunchableAppId('Chrome'), true)
  })

  it('filters uninstallers and docs from the open list', () => {
    assert.equal(isNoiseStartApp('Uninstall Foo'), true)
    assert.equal(isNoiseStartApp('Python 3.12 Documentation'), true)
    assert.equal(isNoiseStartApp('Spotify'), false)
  })

  it('reads tasklist CSV output', () => {
    const out = '"System Idle Process","0","Services","0","8 K"\r\n"CalculatorApp.exe","1234","Console","1","40,000 K"\r\n'
    assert.equal(tasklistHas(out, ['CalculatorApp.exe']), true)
    assert.equal(tasklistHas(out, ['WhatsApp.exe']), false)
  })
})

describe('app list → router on Windows', () => {
  const familiar = (id: string, name: string, installed: boolean, aliases: string[]): CatalogApp => ({
    id,
    name,
    installed,
    familiar: true,
    aliases
  })

  it('opens Calculator when the list has it (typed and voice share the route)', () => {
    const catalog = [familiar('calculator', 'Calculator', true, ['calculator', 'calc'])]
    assert.deepEqual(routeCommand('open calculator', 'typed', catalog), { type: 'launch', appId: 'calculator', name: 'Calculator' })
    assert.equal(routeCommand('open calculator', 'voice', catalog).type, 'launch')
  })

  it('says WhatsApp is not installed (not "can’t find") when the list was read and lacks it', () => {
    const catalog = [familiar('whatsapp', 'WhatsApp', false, ['whatsapp', 'whats app'])]
    const result = routeCommand('open whatsapp', 'typed', catalog)
    assert.equal(result.type, 'missing')
    if (result.type === 'missing') assert.match(result.text, /isn’t installed on this computer/)
  })
})

describe('app list from main → renderer', () => {
  it('keeps a long Windows list instead of dropping all of it (was capped at 120)', async () => {
    const { parseListings } = await import('./app-listing.ts')
    const many = Array.from({ length: 131 }, (_, i) => ({
      id: i === 0 ? 'calculator' : `app-thing-${i}`,
      name: i === 0 ? 'Calculator' : `Thing ${i}`,
      installed: true,
      familiar: i === 0,
      aliases: []
    }))
    const parsed = parseListings(many)
    assert.equal(parsed.length, 131)
    assert.equal(parsed[0].id, 'calculator')
  })

  it('skips one malformed item and keeps the rest', async () => {
    const { parseListings } = await import('./app-listing.ts')
    const parsed = parseListings([
      { id: 'calculator', name: 'Calculator', installed: true, familiar: true, aliases: ['calc'] },
      { id: 'bad id!', name: 'x', installed: true, familiar: false, aliases: [] },
      { id: 'app-a', name: 'A'.repeat(81), installed: true, familiar: false, aliases: [] }
    ])
    assert.deepEqual(parsed.map((item) => item.id), ['calculator'])
  })
})
