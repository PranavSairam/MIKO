import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { groupWindows, parseWinKeysLine, type WinWindow } from './win-keys.ts'

const win = (over: Partial<WinWindow>): WinWindow => ({
  hwnd: 1,
  pid: 10,
  title: 'Doc',
  path: 'C:\\Program Files\\App\\app.exe',
  name: 'App',
  minimized: false,
  active: false,
  ...over
})

describe('Windows MIKO Keys protocol', () => {
  it('reads key events with the same JSON as the Mac helper', () => {
    assert.deepEqual(parseWinKeysLine('{"event":"talk-start"}'), { type: 'event', event: { kind: 'talk-start' } })
    assert.deepEqual(parseWinKeysLine('{"event":"switcher"}'), { type: 'event', event: { kind: 'switcher' } })
    assert.equal(parseWinKeysLine('{"event":"keylog"}'), null)
    assert.deepEqual(parseWinKeysLine('{"ready":true}'), { type: 'ready' })
    assert.deepEqual(parseWinKeysLine('{"error":"compile","detail":"x"}'), { type: 'error', code: 'compile', detail: 'x' })
    assert.equal(parseWinKeysLine('not json'), null)
  })

  it('reads replies and drops malformed windows', () => {
    const reply = parseWinKeysLine(
      JSON.stringify({ id: 3, windows: [{ hwnd: 66010, pid: 4, title: 'Calculator', path: '', name: 'Calculator', minimized: false, active: true }, { hwnd: -1, pid: 2 }] })
    )
    assert.equal(reply?.type, 'reply')
    if (reply?.type === 'reply') {
      assert.equal(reply.id, 3)
      assert.equal(reply.windows?.length, 1)
      assert.equal(reply.windows?.[0].name, 'Calculator')
    }
    assert.deepEqual(parseWinKeysLine('{"id":4,"ok":true}'), { type: 'reply', id: 4, ok: true })
  })

  it('groups windows into one card per app, front-most first, without MIKO or shell surfaces', () => {
    const apps = groupWindows(
      [
        win({ hwnd: 5, pid: 1, name: 'Chrome', path: 'C:\\chrome.exe', active: true }),
        win({ hwnd: 6, pid: 2, name: 'MIKO', path: 'C:\\MIKO\\MIKO.exe' }),
        win({ hwnd: 7, pid: 1, name: 'Chrome', path: 'C:\\chrome.exe', title: 'Second' }),
        win({ hwnd: 8, pid: 3, name: 'Program Manager', title: 'Program Manager', path: 'C:\\Windows\\explorer.exe' }),
        win({ hwnd: 9, pid: 4, name: 'Calculator', path: 'C:\\Program Files\\WindowsApps\\CalculatorApp.exe', minimized: true })
      ],
      ['C:\\MIKO\\MIKO.exe']
    )
    assert.deepEqual(apps.map((a) => a.name), ['Chrome', 'Calculator'])
    assert.deepEqual(apps[0].hwnds, [5, 7])
    assert.equal(apps[0].hwnd, 5)
    assert.equal(apps[0].active, true)
    assert.equal(apps[1].minimized, true)
  })
})

describe('keys-win.ps1 (static checks; Windows PowerShell 5.1 compiles C# 5)', () => {
  const script = readFileSync(new URL('../../resources/keys-win.ps1', import.meta.url), 'utf8')
  const csharp = script.slice(script.indexOf("$source = @'"), script.indexOf("'@"))

  it('uses no C# 6+ syntax that Windows PowerShell 5.1 cannot compile', () => {
    assert.doesNotMatch(csharp, /\$"/, 'string interpolation')
    assert.doesNotMatch(csharp, /\?\./, 'null-conditional')
    assert.doesNotMatch(csharp, /\bnameof\(/, 'nameof')
    assert.doesNotMatch(csharp, /out _\b|out var\b/, 'out discards / out var')
    assert.doesNotMatch(csharp, /\)\s*=>/, 'expression-bodied members / lambdas')
    assert.doesNotMatch(csharp, /PtrToStructure</, 'generic PtrToStructure')
  })

  it('swallows only Q of Tab + Q and lets injected (replayed) keys through', () => {
    assert.match(csharp, /LLKHF_INJECTED\) != 0\) return CallNextHookEx/)
    assert.match(csharp, /if \(vk == VK_TAB\) tabDown/)
    assert.doesNotMatch(csharp, /vk == VK_TAB[^\n]*return \(IntPtr\)1/)
  })

  it('replays a quick Shift + A tap as a typed A and keeps the hook delegate alive', () => {
    assert.match(csharp, /ReplayA\(false, null\)/)
    assert.match(csharp, /static LowLevelKeyboardProc hookProc/)
  })
})

describe('keys-win.ps1 compile settings', () => {
  it('compiles with -IgnoreWarnings (Windows PowerShell fails Add-Type on warnings otherwise)', () => {
    const script = readFileSync(new URL('../../resources/keys-win.ps1', import.meta.url), 'utf8')
    assert.match(script, /Add-Type -TypeDefinition \$source -Language CSharp -IgnoreWarnings/)
  })
})
