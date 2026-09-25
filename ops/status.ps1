<#
  Is the paper up? Answered in plain words, for a human, in a console.

  The Server page at /desk/ops says all of this better, but it lives inside the
  paper, so it cannot answer when the paper is the thing that is down. This can.

  Read-only. It starts nothing and stops nothing.

    ops\status.ps1                                # this install
    ops\status.ps1 -Root C:\path\to\other\install # describe another install
    ops\status.ps1 -DryRun                        # say what it would do, do nothing

  -Root exists so this script can be run from a worktree (which has no .env and
  no running server) AGAINST the live install and still describe the live one:
  the port, the site URL and the two optional-service switches all come from the
  selected install's .env, not from this script's own directory. Nothing in this
  file writes to any install; -Root only chooses what is being read.
  -DryRun performs the same probes and prints the repair each verdict points at,
  without performing any of it. Every probe here is read-only in both modes --
  HTTP GETs, a socket listing, a process listing, a task-info read, and the two
  optional services' own readiness endpoints. The mode exists so the claim can
  be checked rather than asserted.

  Two lines are about things that are ALLOWED to be down. The Reddit reader
  falls back to Reddit's .rss and says so in the source text, and the DeepSeek
  rung is first of several on the Automatic ladder, so "down" for either is a
  supported state and is shown with a plain marker rather than a fault marker.
  Crying wolf about an optional reader is how a real fault gets ignored.

  ASCII only: Windows PowerShell 5.1 reads a BOM-less UTF-8 script as ANSI, so
  anything fancier comes out as mojibake in a console window.
#>

[CmdletBinding()]
param(
  [string]$Root,
  [switch]$DryRun
)

. (Join-Path $PSScriptRoot "lib-env.ps1")
. (Join-Path $PSScriptRoot "lib-port.ps1")
$ErrorActionPreference = "SilentlyContinue"

$here = Split-Path -Parent $PSScriptRoot
$app  = if ($Root) { $Root } else { $here }
$envFile = Join-Path $app ".env"

function Show($label, $ok, $detail, $optional) {
  $mark = if ($optional) { " NOTE " } elseif ($ok) { "  OK  " } else { " DOWN " }
  Write-Host ("  [" + $mark + "] " + $label.PadRight(24) + $detail)
}

# 24, not 20: "Reddit reader (Redlib)" and "DeepSeek (via Ollama)" are 22
# characters, and a column that runs over is worse than a wider one.
$port = Read-OpsEnvValue -EnvFile $envFile -Name "PORT" -Fallback "3000"
$site = Read-OpsEnvValue -EnvFile $envFile -Name "PUBLIC_SITE_URL" -Fallback "https://townreporter.org"

Write-Host ""
Write-Host "  TownReporter, as seen from this machine"
Write-Host "  --------------------------------------"
if ($app -ne $here) { Write-Host "  (describing $app)" }
if ($DryRun) { Write-Host "  (dry run: read-only; nothing here starts or stops anything)" }

# Database
$pg = @(Get-NetTCPConnection -LocalPort 5433 -State Listen)
Show "Database" ($pg.Count -gt 0) $(if ($pg.Count) { "answering on 5433" } else { "nothing on port 5433" })

# The app
$appOk = $false
$appDetail = "no answer on port $port"
try {
  $r = Invoke-WebRequest -Uri "http://127.0.0.1:$port/" -UseBasicParsing -TimeoutSec 15
  $appOk = ($r.StatusCode -eq 200)
  $appDetail = "answered $($r.StatusCode) on port $port"
} catch { }
Show "The paper" $appOk $appDetail

# The tunnel process
$cf = @(Get-Process -Name cloudflared -ErrorAction SilentlyContinue)
Show "Tunnel" ($cf.Count -gt 0) $(if ($cf.Count) { "$($cf.Count) process(es) running" } else { "cloudflared is not running" })

# The public address
$pubOk = $false
$pubDetail = "no answer"
try {
  $r = Invoke-WebRequest -Uri $site -UseBasicParsing -TimeoutSec 25
  $pubOk = ($r.StatusCode -eq 200)
  $pubDetail = "$site answered $($r.StatusCode)"
} catch {
  $pubDetail = "$site did not answer"
}
Show "Public site" $pubOk $pubDetail

# The watchdog
$wd = Get-ScheduledTaskInfo -TaskName "TownReporter Watchdog" -ErrorAction SilentlyContinue
if ($wd -and $wd.LastRunTime) {
  $mins = [int]((Get-Date) - $wd.LastRunTime).TotalMinutes
  Show "Watchdog" ($mins -le 15) "last ran $mins minute(s) ago"
} else {
  Show "Watchdog" $false "never run, or the task is missing"
}

# The Reddit reader, if this machine has one.
#
# "up" / "down" in plain words, and never a fault marker: the desk reads a
# subreddit through Reddit's .rss when Redlib is down and says so in the source
# text (src\lib\news\reddit.server.ts). lib-redlib.ps1 owns the answer, so this
# line and the watchdog and the Control menu cannot disagree about it.
. (Join-Path $PSScriptRoot "lib-redlib.ps1")
$redlibDetail = ""
$redlibOptional = $true
switch (Get-RedlibOffSwitch -EnvFile $envFile) {
  '0' { $redlibDetail = "switched off (TOWNREPORTER_REDLIB=0)" }
  default {
    switch (Get-RedlibState) {
      'up'     { $redlibDetail = "up" }
      'down'   { $redlibDetail = "down - the paper reads Reddit through RSS alone" }
      'absent' { $redlibDetail = "not installed - the paper reads Reddit through RSS alone" }
    }
  }
}
Show "Reddit reader (Redlib)" $false $redlibDetail $redlibOptional

# The model the paper drafts with, first rung of the Automatic ladder.
#
# Wording matters here: Ollama being down is not a fault. "Automatic" moves to
# the next rung (src\lib\news\provider-registry.ts `automaticLadder`), so the
# line says what the paper will do, not that something is broken.
. (Join-Path $PSScriptRoot "lib-ollama.ps1")
$ollamaSwitch = Read-OpsEnvValue -EnvFile $envFile -Name "TOWNREPORTER_OLLAMA" -Fallback '1'
$ollamaDetail = ""
$ollamaOk = $false
switch ($ollamaSwitch) {
  '0' { $ollamaDetail = "switched off - the paper will use the next model" }
  default {
    switch (Get-OllamaState -EnvFile $envFile) {
      'up'       { $ollamaOk = $true; $ollamaDetail = "ready" }
      'starting' { $ollamaDetail = "starting up - the paper will use the next model for now" }
      'down'     { $ollamaDetail = "Ollama not running - the paper will use the next model" }
      'absent'   { $ollamaDetail = "Ollama not installed - the paper will use the next model" }
      'remote'   { $ollamaDetail = "the DeepSeek model is not on this machine" }
    }
  }
}
Show "DeepSeek (via Ollama)" $ollamaOk $ollamaDetail $true

Write-Host ""
if ($appOk -and $pubOk) {
  Write-Host "  Everything is up. Nothing to do."
} elseif ($appOk -and -not $pubOk) {
  Write-Host "  The paper is running but the outside world cannot reach it."
  Write-Host "  Try option 3, restart the tunnel."
} elseif (-not $appOk -and $pg.Count -gt 0) {
  Write-Host "  The database is up but the paper is not. Try option 4."
} elseif ($pg.Count -eq 0) {
  Write-Host "  The database is not running, so nothing else can be. Try option 4."
}
Write-Host ""
Write-Host "  The watchdog also fixes most of this by itself within five minutes."

if ($DryRun) {
  # Say what the repair WOULD be, and say plainly that none of it happened.
  # The optional services are listed separately: starting them is the
  # watchdog's own work, never a reason to touch the paper.
  Write-Host ""
  Write-Host "  Dry run. Nothing was started, stopped or changed. It would:"
  if ($pg.Count -eq 0)     { Write-Host "    - start Postgres on 5433 (option 4)" }
  if (-not $appOk)         { Write-Host "    - start the paper on port $port (option 4)" }
  if (-not $pubOk)         { Write-Host "    - restart the tunnel (option 3)" }
  if ($appOk -and $pubOk)  { Write-Host "    - nothing; the paper is up end to end" }
  if ($redlibDetail -like "down*") { Write-Host "    - start the Reddit reader (option 6); the paper is unaffected either way" }
  Write-Host "  Every probe above was a read: an HTTP GET, a socket listing, a process"
  Write-Host "  listing, or a scheduled-task read. Re-run without -DryRun to act."
}
Write-Host ""
