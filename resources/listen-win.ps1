# MIKO Windows speech helper (System.Speech, on this PC only).
# Modes: listen (default) | hold (Shift + A held: keeps listening until "stop") | test | devices
# Output: one JSON object per line on stdout.
#   {"ready":true,"recognizer":"en-US"}       recognition really started (only then does MIKO show "Listening")
#   {"text":"...","level":42}                 final transcript
#   {"error":"cancelled|silence|no-audio|no-recognizer|no-device|denied|unavailable","detail":"..."}
#   {"devices":["Microphone (Realtek Audio)"]} devices mode
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

if ($Mode -eq 'devices') {
  try {
    $names = @(Get-CimInstance Win32_PnPEntity -Filter "PNPClass='AudioEndpoint'" |
      Where-Object { $_.Status -eq 'OK' } |
      ForEach-Object { [string]$_.Name })
    $inputs = @($names | Where-Object { $_ -match 'microphone|\bmic\b|input|line in|array|headset' })
    Emit @{ devices = $inputs }
  } catch {
    Emit @{ devices = @(); error = 'devices'; detail = $_.Exception.Message }
  }
  exit 0
}

$limitSeconds = if ($Mode -eq 'test') { 8 } elseif ($Mode -eq 'hold') { 58 } else { 11 }
$hold = $Mode -eq 'hold'
$parts = New-Object System.Collections.Generic.List[string]
$engine = $null

function Cleanup {
  foreach ($id in 'miko.recognized', 'miko.completed', 'miko.level') {
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
} catch {
  Emit @{ error = 'no-recognizer'; detail = $_.Exception.Message }
  exit 0
}

try {
  $script:engine.SetInputToDefaultAudioDevice()
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
  $recognizeMode = if ($hold) { [System.Speech.Recognition.RecognizeMode]::Multiple } else { [System.Speech.Recognition.RecognizeMode]::Single }
  $script:engine.RecognizeAsync($recognizeMode)
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
