import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { parseHelperOutput, planWhatsApp } from './whatsapp.ts'

const read = (path: string): string => readFileSync(new URL(path, import.meta.url), 'utf8')
const script = read('../../resources/whatsapp-win.ps1')
const csharp = script.slice(script.indexOf("$source = @'"), script.indexOf("'@"))
const fn = (name: string): string => {
  const start = csharp.indexOf(name)
  assert.ok(start > 0, name)
  const next = csharp.indexOf('\n    static ', start + name.length)
  const nextPublic = csharp.indexOf('\n    public static ', start + name.length)
  const ends = [next, nextPublic].filter((n) => n > 0)
  return csharp.slice(start, ends.length ? Math.min(...ends) : undefined)
}

describe('Windows WhatsApp helper protocol', () => {
  it('reads the last JSON line even with a BOM and CRLF (Windows PowerShell output)', () => {
    assert.deepEqual(parseHelperOutput('﻿{"status":"results","rows":[{"name":"Dad","snippet":""}]}\r\n'), {
      status: 'results',
      rows: [{ name: 'Dad', snippet: '' }]
    })
    assert.deepEqual(parseHelperOutput('noise\r\n{"status":"none"}\r\n'), { status: 'none' })
    assert.deepEqual(parseHelperOutput('[1,2]'), {})
    assert.throws(() => parseHelperOutput('not json'))
  })

  it('uses the shared chooser: several exact names or approximate matches are a choice, never a silent pick', () => {
    const rows = [
      { name: 'Dad', snippet: 'see you' },
      { name: 'Dad', snippet: 'call me' }
    ]
    assert.equal(planWhatsApp('Dad', rows, { inspected: true }).action, 'choices')
    const sub = planWhatsApp('Dad', [{ name: 'Dadi Amma', snippet: '' }], { inspected: true })
    assert.notEqual(sub.action, 'open')
    const one = planWhatsApp('Dad', [{ name: 'Dad', snippet: '' }], { inspected: true })
    assert.equal(one.action, 'open')
    assert.equal(planWhatsApp('Zed', [], { inspected: true }).action, 'none')
  })
})

describe('whatsapp-win.ps1 (static checks; Windows PowerShell 5.1 compiles C# 5)', () => {
  it('is plain ASCII, so Windows PowerShell reads it the same in any code page', () => {
    assert.doesNotMatch(script, /[^\x00-\x7f]/)
  })

  it('uses no C# 6+ syntax', () => {
    // `$"` right after an operator/bracket is C# 6 interpolation; inside a regex it is just an end anchor.
    assert.doesNotMatch(csharp, /(?:^|[\s(=,+])\$"/m, 'string interpolation')
    assert.doesNotMatch(csharp, /\w\?\.\w/, 'null-conditional')
    assert.doesNotMatch(csharp, /\bnameof\(/, 'nameof')
    assert.doesNotMatch(csharp, /out _\b|out var\b/, 'out discards / out var')
    assert.doesNotMatch(csharp, /\)\s*=>/, 'expression-bodied members / lambdas')
  })

  it('compiles with -IgnoreWarnings and recompiles when the cached DLL is broken', () => {
    assert.match(script, /-OutputAssembly \$dll -OutputType Library -IgnoreWarnings/)
    assert.match(script, /try \{ Add-Type -Path \$dll; \$loaded = \$true \} catch \{ Remove-Item -LiteralPath \$dll/)
  })

  it('types only into the focused search box, checking focus before every character', () => {
    const type = fn('static bool TypeIntoSearch')
    assert.match(type, /foreach \(char ch in text\)\s*\{\s*if \(!Front\(hwnd\) \|\| FocusedIsComposer\(\) \|\| !HasFocus\(search\)\) return false;/)
    // The only thing ever given focus is the search box.
    assert.deepEqual(csharp.match(/\.SetFocus\(\)/g), ['.SetFocus()'])
    assert.match(csharp, /search\.SetFocus\(\)/)
  })

  it('never writes, reads or submits the message box', () => {
    assert.doesNotMatch(csharp, /SetValue\(/, 'no ValuePattern.SetValue anywhere')
    assert.doesNotMatch(csharp, /VK_RETURN|0x0D/, 'never presses Enter')
    assert.doesNotMatch(script, /SendKeys/)
    // The composer is identified by its label only, to stay away from it.
    assert.match(fn('static AutomationElement FindSearch'), /IsComposerLabel\(label\)\) continue/)
    const clear = fn('static bool ClearSearch')
    assert.match(clear, /!HasFocus\(search\) \|\| FocusedIsComposer\(\)\) return false/)
  })

  it('searches once: opening a result reuses the search and never retypes', () => {
    const open = fn('public static MikoWaResult Open')
    assert.equal(open.match(/TypeIntoSearch\(/g)?.length, 1)
    assert.match(open, /bool canReuse = reuse && Contains\(value, query\);/)
    assert.match(open, /if \(reuse\) return Fail\("failed", "WhatsApp\\u2019s search results went stale/)
    // A non-empty search is cleared (or the run stops) before typing, so the query is never appended.
    assert.match(open, /value\.Length > 0 && !ClearSearch\(search, hwnd\)/)
  })

  it('opens exactly one matching row and reports success only after the header matches', () => {
    const open = fn('public static MikoWaResult Open')
    assert.match(open, /if \(hits\.Count > 1\)/)
    assert.match(open, /result\.status = "unverified"/)
    assert.ok(open.indexOf('ConfirmedHeader(') < open.indexOf('result.status = "opened"'))
    // Message-search hits (the "Messages" section) are not offered as chats.
    assert.match(fn('static List<Found> ReadRows'), /section\.StartsWith\("message"\)\) continue/)
  })

  it('never falls back to WhatsApp Web or guessed screen coordinates', () => {
    assert.doesNotMatch(script, /web\.whatsapp\.com/i)
    assert.doesNotMatch(read('../main/whatsapp.ts'), /web\.whatsapp\.com/i)
    // Any click goes through VerifiedClick, which checks the element under the point first.
    const click = fn('static bool VerifiedClick')
    assert.match(click, /if \(!ElementAtPointIs\(e, p\)\) return false;/)
    assert.equal(csharp.match(/SetCursorPos\(\(int\)/g)?.length, 1)
  })

  it('reports a specific limitation when accessibility does not expose search or results', () => {
    assert.match(csharp, /doesn\\u2019t show its search box to Windows accessibility/)
    assert.match(csharp, /doesn\\u2019t show the results to Windows accessibility/)
  })
})

describe('main/renderer wiring (static)', () => {
  const main = read('../main/whatsapp.ts')
  it('Windows runs whatsapp-win.ps1; the Mac keeps the ax helper unchanged', () => {
    assert.match(main, /sourcePath\('whatsapp-win\.ps1'\)/)
    assert.match(main, /return spawn\(path, \['whatsapp'\], \{ shell: false, stdio: \['pipe', 'pipe', 'ignore'\] \}\)/)
  })

  it('cancel/supersede blocks late results: every result is checked against the generation', () => {
    assert.match(main, /export function cancelWhatsApp\(\): void \{\s*generation \+= 1/)
    assert.match(main, /if \(gen !== generation\) \{\s*resolve\(fromHelper\(\{ status: 'cancelled'/)
    // Reply capture / draft insertion stay macOS-only, so no Windows path can touch a draft.
    assert.match(main, /WhatsApp draft insertion isn’t available on Windows yet/)
  })

  it('a Chrome launch that finishes after Cancel or a newer request is not reported or reused', () => {
    const app = read('../renderer/src/motion/MotionApp.tsx')
    const start = app.indexOf('async function launchChromeDirectory(')
    const body = app.slice(start, app.indexOf('async function beginChromeProfiles(', start))
    assert.match(body, /if \(token !== chromeChooserToken\.current\) \{\s*\/\/ Cancelled/)
    assert.ok(body.indexOf('Opened search in Chrome') > body.indexOf('if (!result.ok)'))
    assert.match(app, /function dismissChromeChooser\(\): void \{\s*chromeChooserToken\.current \+= 1/)
  })

  it('Windows starts chrome.exe detached instead of waiting for it to exit', () => {
    const chrome = read('../main/chrome-profiles.ts')
    assert.match(chrome, /await startDetached\(exe, args\)/)
    assert.doesNotMatch(chrome, /execFileAsync\(exe,/)
  })
})
