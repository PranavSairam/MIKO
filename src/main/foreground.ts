import { spawnSync } from 'node:child_process'
import type { Rect } from '../shared/layout'

export interface FrontWindow {
  pid: number
  name: string
  bundleId: string
  bounds: Rect
  fullscreen: boolean
}

export type FrontRead =
  | { ok: true; window: FrontWindow | null }
  | { ok: false; permission: string }

/** Last non-MIKO front window. Opening the panel must not erase this. */
let lastExternal: FrontWindow | null = null

/** Read the front app's name and window bounds. Nothing else is collected. */
export function readForeground(ownPid: number): FrontRead {
  const result = process.platform === 'win32' ? readWindows(ownPid) : readMac(ownPid)
  if (result.ok && result.window) lastExternal = result.window
  return result
}

/** Snapshot of the last external app before MIKO took focus. */
export function lastExternalApp(): FrontWindow | null {
  return lastExternal
}

function readMac(ownPid: number): FrontRead {
  const result = spawnSync('/usr/bin/osascript', ['-e', MAC_SCRIPT], {
    shell: false,
    encoding: 'utf8',
    timeout: 2500,
    maxBuffer: 4000,
    windowsHide: true
  })
  const error = `${result.stderr ?? ''}`
  if (result.error || /not allowed|assistive|1002|-1743|-1719/i.test(error)) {
    return {
      ok: false,
      permission:
        'MIKO needs Accessibility access to read the front app\u2019s window. System Settings \u2192 Privacy & Security \u2192 Accessibility, then allow MIKO. It only reads the app name and window bounds for following.'
    }
  }
  if (result.status !== 0) return { ok: true, window: null }
  return { ok: true, window: parseLine(result.stdout, ownPid) }
}

function readWindows(ownPid: number): FrontRead {
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', WIN_SCRIPT], {
    shell: false,
    encoding: 'utf8',
    timeout: 4000,
    maxBuffer: 4000,
    windowsHide: true
  })
  if (result.error || result.status !== 0) {
    return { ok: false, permission: 'MIKO could not read the foreground window.' }
  }
  return { ok: true, window: parseLine(result.stdout, ownPid) }
}

function parseLine(stdout: string, ownPid: number): FrontWindow | null {
  const line = stdout
    .split(/\r?\n/)
    .map((item) => item.trim())
    .find((item) => item.startsWith('MIKO|'))
  if (!line) return null
  const parts = line.split('|')
  if (parts.length < 8) return null
  const pid = Number(parts[2])
  const bounds = {
    x: Number(parts[3]),
    y: Number(parts[4]),
    width: Number(parts[5]),
    height: Number(parts[6])
  }
  if (!Number.isInteger(pid) || pid <= 0 || pid === ownPid) return null
  if (![bounds.x, bounds.y, bounds.width, bounds.height].every((value) => Number.isFinite(value))) return null
  if (bounds.width < 80 || bounds.height < 80) return null
  const name = parts[1]?.slice(0, 80) || 'App'
  if (name === 'MIKO' || name === 'MIKO Listen') return null
  return {
    pid,
    name,
    bundleId: (parts[7] ?? '').slice(0, 200),
    bounds,
    fullscreen: parts[8] === '1'
  }
}

const MAC_SCRIPT = `tell application "System Events"
  set frontApp to first application process whose frontmost is true
  set appName to name of frontApp
  set appPid to unix id of frontApp
  set appId to ""
  try
    set appId to bundle identifier of frontApp
  end try
  set bestArea to 0
  set best to ""
  repeat with w in windows of frontApp
    try
      set p to position of w
      set s to size of w
      set ww to item 1 of s
      set hh to item 2 of s
      if ww >= 80 and hh >= 80 then
        set area to ww * hh
        if area > bestArea then
          set bestArea to area
          set fs to "0"
          try
            if (value of attribute "AXFullScreen" of w) then set fs to "1"
          end try
          set best to "MIKO|" & appName & "|" & appPid & "|" & (item 1 of p) & "|" & (item 2 of p) & "|" & ww & "|" & hh & "|" & appId & "|" & fs
        end if
      end if
    end try
  end repeat
  return best
end tell`

const WIN_SCRIPT = String.raw`Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public class MikoFront {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, StringBuilder text, int count);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
}
'@ -ErrorAction SilentlyContinue
$hwnd = [MikoFront]::GetForegroundWindow()
if ($hwnd -eq [IntPtr]::Zero) { exit 0 }
$rect = New-Object MikoFront+RECT
[void][MikoFront]::GetWindowRect($hwnd, [ref]$rect)
$procId = [uint32]0
[void][MikoFront]::GetWindowThreadProcessId($hwnd, [ref]$procId)
$name = (Get-Process -Id $procId -ErrorAction SilentlyContinue).ProcessName
$w = $rect.Right - $rect.Left
$h = $rect.Bottom - $rect.Top
Write-Output ("MIKO|{0}|{1}|{2}|{3}|{4}|{5}||0" -f $name, $procId, $rect.Left, $rect.Top, $w, $h)
`
