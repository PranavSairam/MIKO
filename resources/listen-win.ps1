$ErrorActionPreference = 'Stop'
try {
  Add-Type -AssemblyName System.Speech
  $engine = New-Object System.Speech.Recognition.SpeechRecognitionEngine
  $engine.SetInputToDefaultAudioDevice()
  $engine.LoadGrammar((New-Object System.Speech.Recognition.DictationGrammar))
  $engine.InitialSilenceTimeout = [TimeSpan]::FromSeconds(4)
  $engine.BabbleTimeout = [TimeSpan]::FromSeconds(2)
  $engine.EndSilenceTimeout = [TimeSpan]::FromSeconds(0.8)
  $script:text = ''
  $script:done = $false
  $recognized = Register-ObjectEvent -InputObject $engine -EventName SpeechRecognized -Action {
    $script:text = $Event.SourceEventArgs.Result.Text
  }
  $completed = Register-ObjectEvent -InputObject $engine -EventName RecognizeCompleted -Action {
    $script:done = $true
  }
  $engine.RecognizeAsync([System.Speech.Recognition.RecognizeMode]::Single)
  $reader = New-Object System.IO.StreamReader ([Console]::OpenStandardInput())
  $start = Get-Date
  while (-not $script:done -and ((Get-Date) - $start).TotalSeconds -lt 8) {
    if ($reader.BaseStream.CanRead -and $reader.Peek() -ge 0) {
      $line = $reader.ReadLine()
      if ($line -eq 'stop') { $engine.RecognizeAsyncStop() }
      if ($line -eq 'cancel') {
        $engine.RecognizeAsyncCancel()
        Write-Output '{"error":"cancelled"}'
        exit 0
      }
    }
    Start-Sleep -Milliseconds 80
  }
  Unregister-Event -SourceIdentifier $recognized.Name -ErrorAction SilentlyContinue
  Unregister-Event -SourceIdentifier $completed.Name -ErrorAction SilentlyContinue
  $engine.RecognizeAsyncCancel()
  $engine.Dispose()
  $clean = ([string]$script:text).Trim()
  if ([string]::IsNullOrWhiteSpace($clean)) {
    Write-Output '{"error":"silence"}'
  } else {
    if ($clean.Length -gt 400) { $clean = $clean.Substring(0, 400) }
    Write-Output ((@{ text = $clean } | ConvertTo-Json -Compress))
  }
} catch {
  $message = $_.Exception.Message
  if ($message -match 'denied|access|privacy|microphone') {
    Write-Output '{"error":"denied"}'
  } else {
    Write-Output '{"error":"unavailable"}'
  }
}
