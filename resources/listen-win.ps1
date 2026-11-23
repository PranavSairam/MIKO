# MIKO Windows speech helper (System.Speech, on this PC only).
# Modes: listen (default) | hold (Shift + A held: keeps listening until "stop") | test | devices
# Output: one JSON object per line on stdout.
#   {"ready":true,"recognizer":"en-US"}       recognition really started (only then does MIKO show "Listening")
#   {"text":"...","level":42}                 final transcript
#   {"error":"cancelled|silence|no-audio|no-recognizer|no-device|denied|unavailable","detail":"..."}
#   {"devices":["Microphone (Realtek Audio)"],"default":"Microphone (Realtek Audio)","recognizers":["en-US"]} devices mode
#   {"stage":"speech-loaded|recognizer|input|recognizing","ms":1234}  startup timings (diagnostics only)
#   {"heard":true}                             speech detected (once per session; no audio or words)
# Stdin lines: "stop" (finish and return what was heard), "cancel" (discard, release the mic).
#
# Notes for maintainers:
# - Events are read with Register-ObjectEvent (no -Action) + Get-Event in this scope.
#   An -Action block runs in its own module scope, so $script: variables set there never
#   reach this script (the old helper always reported silence because of that).
# - Stdin is read with StreamReader.ReadLineAsync over the raw stdin stream; Peek() on a
#   pipe can block, and Console.In.ReadLineAsync is synchronous on .NET Framework.
param([string]$Mode = 'listen')

$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}

function Emit($obj) {
  [Console]::Out.WriteLine(($obj | ConvertTo-Json -Compress))
  [Console]::Out.Flush()
}

$script:started = Get-Date
try { $script:started = [System.Diagnostics.Process]::GetCurrentProcess().StartTime } catch {}
# Startup timing (milliseconds since PowerShell started). Diagnostics only: no audio, no words.
function Stage([string]$name) {
  $ms = [int]((Get-Date) - $script:started).TotalMilliseconds
  Emit @{ stage = $name; ms = $ms }
}

if ($Mode -eq 'devices') {
  $inputs = @()
  $defaultName = ''
  $recognizers = @()
  try {
    $names = @(Get-CimInstance Win32_PnPEntity -Filter "PNPClass='AudioEndpoint'" |
      Where-Object { $_.Status -eq 'OK' } |
      ForEach-Object { [string]$_.Name })
    $inputs = @($names | Where-Object { $_ -match 'microphone|\bmic\b|input|line in|array|headset' })
  } catch {}
  # The Windows default recording device (what System.Speech listens to), via Core Audio.
  try {
    $source = @'
using System;
using System.Runtime.InteropServices;
public static class MikoDefaultMic {
  [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
  class MMDeviceEnumeratorCom {}
  [ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IMMDeviceEnumerator {
    [PreserveSig] int EnumAudioEndpoints(int dataFlow, int stateMask, out IntPtr devices);
    [PreserveSig] int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice endpoint);
  }
  [ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IMMDevice {
    [PreserveSig] int Activate(ref Guid iid, int clsCtx, IntPtr activationParams, out IntPtr iface);
    [PreserveSig] int OpenPropertyStore(int access, out IPropertyStore store);
  }
  [ComImport, Guid("886d8eeb-8cf2-4446-8d02-cdba1dbdcf99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IPropertyStore {
    [PreserveSig] int GetCount(out int count);
    [PreserveSig] int GetAt(int index, out PropertyKey key);
    [PreserveSig] int GetValue(ref PropertyKey key, out PropVariant value);
  }
  [StructLayout(LayoutKind.Sequential)]
  struct PropertyKey { public Guid fmtid; public int pid; }
  [StructLayout(LayoutKind.Explicit)]
  struct PropVariant { [FieldOffset(0)] public short vt; [FieldOffset(8)] public IntPtr pointerValue; }
  public static string Name() {
    IMMDeviceEnumerator enumerator = (IMMDeviceEnumerator)new MMDeviceEnumeratorCom();
    IMMDevice device;
    // eCapture = 1, eConsole = 0
    if (enumerator.GetDefaultAudioEndpoint(1, 0, out device) != 0 || device == null) return "";
    IPropertyStore store;
    if (device.OpenPropertyStore(0, out store) != 0 || store == null) return "";
    PropertyKey key = new PropertyKey();
    key.fmtid = new Guid("a45c254e-df1c-4efd-8020-67d146a850e0");
    key.pid = 14;
    PropVariant value;
    if (store.GetValue(ref key, out value) != 0) return "";
    if (value.vt != 31 || value.pointerValue == IntPtr.Zero) return "";
    string name = Marshal.PtrToStringUni(value.pointerValue);
    return name == null ? "" : name;
  }
}
'@
    Add-Type -TypeDefinition $source -Language CSharp -IgnoreWarnings -ErrorAction Stop
    $defaultName = [string][MikoDefaultMic]::Name()
  } catch {}
  try {
    Add-Type -AssemblyName System.Speech
    $recognizers = @([System.Speech.Recognition.SpeechRecognitionEngine]::InstalledRecognizers() | ForEach-Object { [string]$_.Culture.Name })
  } catch {}
  Emit @{ devices = $inputs; default = $defaultName; recognizers = $recognizers }
  exit 0
}

$limitSeconds = if ($Mode -eq 'test') { 8 } elseif ($Mode -eq 'hold') { 58 } else { 11 }
$hold = $Mode -eq 'hold'
$parts = New-Object System.Collections.Generic.List[string]
$engine = $null

function Cleanup {
  foreach ($id in 'miko.recognized', 'miko.completed', 'miko.level', 'miko.detected') {
    Unregister-Event -SourceIdentifier $id -ErrorAction SilentlyContinue
  }
  Get-Event -ErrorAction SilentlyContinue | Remove-Event -ErrorAction SilentlyContinue
  if ($script:engine) {
    try { $script:engine.RecognizeAsyncCancel() } catch {}
    try { $script:engine.SetInputToNull() } catch {}
    try { $script:engine.Dispose() } catch {}
    $script:engine = $null
  }
}

try {
  Add-Type -AssemblyName System.Speech
  Stage 'speech-loaded'
} catch {
  Emit @{ error = 'unavailable'; detail = 'Windows speech recognition (System.Speech) is not available on this PC.' }
  exit 0
}

try {
  $installed = @([System.Speech.Recognition.SpeechRecognitionEngine]::InstalledRecognizers())
  if ($installed.Count -eq 0) {
    Emit @{ error = 'no-recognizer'; detail = 'No Windows speech recognizer is installed.' }
    exit 0
  }
  $ui = [System.Globalization.CultureInfo]::CurrentUICulture.Name
  $pick = $installed | Where-Object { $_.Culture.Name -eq $ui } | Select-Object -First 1
  if (-not $pick) { $pick = $installed | Where-Object { $_.Culture.Name -eq 'en-US' } | Select-Object -First 1 }
  if (-not $pick) { $pick = $installed | Where-Object { $_.Culture.Name -like 'en-*' } | Select-Object -First 1 }
  if (-not $pick) { $pick = $installed[0] }
  $script:engine = New-Object System.Speech.Recognition.SpeechRecognitionEngine($pick)
  Stage 'recognizer'
} catch {
  Emit @{ error = 'no-recognizer'; detail = $_.Exception.Message }
  exit 0
}

try {
  $script:engine.SetInputToDefaultAudioDevice()
  Stage 'input'
} catch {
  $message = $_.Exception.Message
  Cleanup
  if ($message -match 'denied|privacy|permission') {
    Emit @{ error = 'denied'; detail = $message }
  } else {
    Emit @{ error = 'no-device'; detail = $message }
  }
  exit 0
}

try {
  $script:engine.LoadGrammar((New-Object System.Speech.Recognition.DictationGrammar))
  if ($hold) {
    # Held keys decide when to stop; never end early on silence.
    $script:engine.InitialSilenceTimeout = [TimeSpan]::Zero
    $script:engine.BabbleTimeout = [TimeSpan]::Zero
  } else {
    $script:engine.InitialSilenceTimeout = [TimeSpan]::FromSeconds(5)
    $script:engine.BabbleTimeout = [TimeSpan]::FromSeconds(3)
  }
  $script:engine.EndSilenceTimeout = [TimeSpan]::FromSeconds(0.8)
  $null = Register-ObjectEvent -InputObject $script:engine -EventName SpeechRecognized -SourceIdentifier 'miko.recognized'
  $null = Register-ObjectEvent -InputObject $script:engine -EventName RecognizeCompleted -SourceIdentifier 'miko.completed'
  $null = Register-ObjectEvent -InputObject $script:engine -EventName AudioLevelUpdated -SourceIdentifier 'miko.level'
  $null = Register-ObjectEvent -InputObject $script:engine -EventName SpeechDetected -SourceIdentifier 'miko.detected'
  $recognizeMode = if ($hold) { [System.Speech.Recognition.RecognizeMode]::Multiple } else { [System.Speech.Recognition.RecognizeMode]::Single }
  $script:engine.RecognizeAsync($recognizeMode)
  Stage 'recognizing'
} catch {
  $message = $_.Exception.Message
  Cleanup
  if ($message -match 'denied|privacy|permission') {
    Emit @{ error = 'denied'; detail = $message }
  } else {
    Emit @{ error = 'unavailable'; detail = $message }
  }
  exit 0
}

Emit @{ ready = $true; recognizer = [string]$pick.Culture.Name }

$reader = New-Object System.IO.StreamReader ([Console]::OpenStandardInput())
$pending = $reader.ReadLineAsync()
$text = ''
$done = $false
$failure = ''
$maxLevel = 0
$heard = $false
$start = Get-Date

while (-not $done -and ((Get-Date) - $start).TotalSeconds -lt $limitSeconds) {
  if ($pending -and $pending.IsCompleted) {
    $line = $null
    try { $line = $pending.Result } catch { $line = $null }
    if ($null -eq $line) {
      # Stdin closed: MIKO went away. Stop listening.
      $pending = $null
      Cleanup
      Emit @{ error = 'cancelled' }
      exit 0
    }
    $line = $line.Trim()
    if ($line -eq 'cancel') {
      Cleanup
      Emit @{ error = 'cancelled' }
      exit 0
    }
    if ($line -eq 'stop') {
      try { $script:engine.RecognizeAsyncStop() } catch {}
    }
    $pending = $reader.ReadLineAsync()
  }
  foreach ($ev in @(Get-Event -ErrorAction SilentlyContinue)) {
    switch ($ev.SourceIdentifier) {
      'miko.recognized' {
        $result = $ev.SourceEventArgs.Result
        if ($result -and $result.Text) {
          if ($hold) { $parts.Add([string]$result.Text) } else { $text = [string]$result.Text }
        }
      }
      'miko.completed' {
        $done = $true
        $args0 = $ev.SourceEventArgs
        if ($args0.Error) { $failure = [string]$args0.Error.Message }
        if (-not $text -and $args0.Result -and $args0.Result.Text) { $text = [string]$args0.Result.Text }
      }
      'miko.detected' {
        # Speech started (no words or audio are sent): MIKO can show "Hearing you".
        if (-not $heard) { $heard = $true; Emit @{ heard = $true } }
      }
      'miko.level' {
        $level = [int]$ev.SourceEventArgs.AudioLevel
        if ($level -gt $maxLevel) { $maxLevel = $level }
      }
    }
    Remove-Event -EventIdentifier $ev.EventIdentifier -ErrorAction SilentlyContinue
  }
  Start-Sleep -Milliseconds 60
}

Cleanup

if ($hold -and $parts.Count -gt 0) { $text = ($parts -join ' ') }
$clean = ([string]$text).Trim()
if ($clean) {
  if ($clean.Length -gt 400) { $clean = $clean.Substring(0, 400) }
  Emit @{ text = $clean; level = $maxLevel }
} elseif ($failure) {
  if ($failure -match 'denied|privacy|permission') {
    Emit @{ error = 'denied'; detail = $failure }
  } else {
    Emit @{ error = 'unavailable'; detail = $failure }
  }
} elseif ($maxLevel -eq 0) {
  Emit @{ error = 'no-audio'; detail = 'The microphone sent no sound.' }
} else {
  Emit @{ error = 'silence'; level = $maxLevel }
}
exit 0
