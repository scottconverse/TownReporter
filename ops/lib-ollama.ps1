<#
  Ollama, the local server the paper's first Automatic rung runs on.

  "Automatic" walks its local rungs in order: DeepSeek v4.1 Flash on Ollama
  (http://127.0.0.1:11434/v1), then Qwen 3.6 35B on LM Studio when that model
  is loaded (src/lib/news/provider-registry.ts, `automaticLadder`). Ollama
  being down is NOT the paper being down: the ladder moves to the next rung,
  which is why ops/status.ps1 says "the paper will use the next model" rather
  than calling it a fault. Nothing here may fail a caller.

  Two things this file never does:

  * It never stops Ollama, and never looks for a reason to. A model may be
    mid-draft on it; a wedged Ollama is the operator's to restart.
  * It never touches LM Studio or its models. The second rung's server owns
    its own memory management (that rung is skipped unless the model is
    already loaded, precisely so a draft is never pinned to a model that has
    to be paged in from disk). Probing or unloading anything on 1234 from here
    would reach into another program's state for no reason.

  Ollama is started the way the operator's own Startup shortcut starts it,
  because that is the launch this machine is known to work with: Ollama.lnk
  runs "ollama app.exe", and the tray app owns the server process. The
  shortcut is READ, not hardcoded, so moving the install needs no code change;
  OLLAMA_SHORTCUT overrides it for a test or a non-default install.

  Dot-source it:
    . (Join-Path $PSScriptRoot "lib-ollama.ps1")
  Then use:
    Get-OllamaEndpoint | Test-OllamaReady | Get-OllamaState
    Get-OllamaLaunch | Start-OllamaIfDown

  ASCII only: Windows PowerShell 5.1 reads a BOM-less UTF-8 file as ANSI.
#>

. (Join-Path $PSScriptRoot "lib-env.ps1")

<#
  The endpoint the DeepSeek rung will actually be called on.

  In order: this process's environment, the install's .env, then the rung's own
  default. The rung carries its own baseUrl precisely so it cannot end up
  talking to LM Studio's server (see provider-registry.ts), so the default here
  is the same literal that rung uses.
#>
function Get-OllamaEndpoint {
  param([string]$EnvFile, [string]$Endpoint)
  if ($Endpoint) { return $Endpoint }
  if ($env:OLLAMA_BASE_URL) { return $env:OLLAMA_BASE_URL }
  $configured = Read-OpsEnvValue -EnvFile $EnvFile -Name "TOWNREPORTER_DEEPSEEK_BASE_URL"
  if ($configured) { return $configured }
  return "http://127.0.0.1:11434/v1"
}

# True when the endpoint is on this machine. A rung repointed at Ollama Cloud
# or any other host is not something this machine starts or reports on: "Ollama
# not running" would be a false statement about someone else's server.
function Test-OllamaLocal {
  param([string]$Endpoint = "http://127.0.0.1:11434/v1")
  try { $uri = [uri]$Endpoint } catch { return $false }
  if (-not $uri.IsAbsoluteUri) { return $false }
  return $uri.IsLoopback
}

<#
  Ready = the endpoint answers its OpenAI-compatible model list.

  The same call the desk's own local discovery makes
  (src/lib/news/local-models.ts `probeServer`), not a bare TCP connect: a
  listener with no model server behind it is not ready, and "ready" is the
  word the operator reads.
#>
function Test-OllamaReady {
  param([string]$Endpoint = "http://127.0.0.1:11434/v1")
  try {
    $null = Invoke-RestMethod -Uri ($Endpoint.TrimEnd('/') + "/models") -TimeoutSec 5
    return $true
  } catch {
    return $false
  }
}

# Any Ollama process, observed only to decide whether to LAUNCH one. Nothing
# in this file stops a process, so this answer never leads to a kill.
function Test-OllamaProcessRunning {
  @(Get-Process -Name "ollama*" -ErrorAction SilentlyContinue).Count -gt 0
}

<#
  One word for a human:
    up       - the endpoint answers; the first rung is usable
    starting - a process is there but not answering yet; leave it alone
    down     - nothing running and nothing answering
    remote   - the rung points off this machine; not ours to start or judge
    absent   - no Startup shortcut to launch it from
#>
function Get-OllamaState {
  param([string]$EnvFile, [string]$Endpoint)
  $target = Get-OllamaEndpoint -EnvFile $EnvFile -Endpoint $Endpoint
  if (-not (Test-OllamaLocal -Endpoint $target)) { return 'remote' }
  if (Test-OllamaReady -Endpoint $target) { return 'up' }
  if (Test-OllamaProcessRunning) { return 'starting' }
  if (-not (Get-OllamaLaunch)) { return 'absent' }
  return 'down'
}

# The operator's own Startup shortcut. $null when there is not one -- which is
# a legitimate install (Ollama may be run by hand or by another launcher).
function Get-OllamaShortcut {
  param([string]$Shortcut)
  if ($Shortcut) { return $Shortcut }
  if ($env:OLLAMA_SHORTCUT) { return $env:OLLAMA_SHORTCUT }
  $startup = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\Startup\Ollama.lnk"
  if (Test-Path -LiteralPath $startup) { return $startup }
  return $null
}

<#
  Read the shortcut rather than restating what it does.

  The task said "start it the way the Startup shortcut does (read Ollama.lnk
  target)": the point is that whatever the operator's shortcut launches is what
  gets launched, so this copy cannot drift from it.
#>
function Get-OllamaLaunch {
  param([string]$Shortcut)
  $path = Get-OllamaShortcut -Shortcut $Shortcut
  if (-not $path) { return $null }
  try {
    $shell = New-Object -ComObject WScript.Shell
    $link = $shell.CreateShortcut($path)
    if (-not $link.TargetPath) { return $null }
    return [pscustomobject]@{
      Path       = $path
      Target     = $link.TargetPath
      Arguments  = $link.Arguments
      WorkingDir = $link.WorkingDirectory
    }
  } catch {
    return $null
  }
}

<#
  Start Ollama the shortcut's way, if it is down. Returns:
    up       - already answering; nothing done
    starting - a process exists but is not answering; deliberately left alone
               (it is either coming up or wedged, and neither is a reason to
               start a second one)
    started  - launched from the shortcut
    absent   - no shortcut to read
    remote   - the rung points off this machine
    off      - TOWNREPORTER_OLLAMA=0
#>
function Start-OllamaIfDown {
  param([string]$EnvFile, [string]$Endpoint, [string]$Shortcut, [string]$OffSwitch)
  if ($OffSwitch -eq '0') { return 'off' }
  $target = Get-OllamaEndpoint -EnvFile $EnvFile -Endpoint $Endpoint
  if (-not (Test-OllamaLocal -Endpoint $target)) { return 'remote' }
  if (Test-OllamaReady -Endpoint $target) { return 'up' }
  if (Test-OllamaProcessRunning) { return 'starting' }
  $launch = Get-OllamaLaunch -Shortcut $Shortcut
  if (-not $launch) { return 'absent' }
  $arguments = @()
  if ($launch.Arguments) { $arguments = @($launch.Arguments) }
  $options = @{ FilePath = $launch.Target; ArgumentList = $arguments; WindowStyle = "Hidden" }
  if ($launch.WorkingDir) { $options.WorkingDirectory = $launch.WorkingDir }
  Start-Process @options
  return 'started'
}
