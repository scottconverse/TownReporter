<#
  Is the paper up? Answered in plain words, for a human, in a console.

  The Server page at /desk/ops says all of this better, but it lives inside the
  paper, so it cannot answer when the paper is the thing that is down. This can.

  Read-only. It starts nothing and stops nothing.

    ops\status.ps1                                # this install
    ops\status.ps1 -Root C:\path\to\other\install # describe another install
    ops\status.ps1 -DryRun                        # say what it would do, do nothing
    ops\status.ps1 -Json                          # the same verdicts, as one object

  -Json is for the Control page (ops/control/control-server.mjs), which is the
  one caller that has to READ this script rather than look at it. It emits
  exactly one JSON object on stdout and nothing else -- no headings, no blank
  lines -- because the caller parses stdout and a stray Write-Host line ahead
  of the object would be a parse failure that looks like the paper is down.
  The probes are the same ones the console mode runs and every one of them is
  read-only, so -Json implies no repairs exactly as -DryRun does. There is no
  mode of this script that starts, stops or changes anything.

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

  Every row therefore carries a real STATE -- one of "ok", "note" or "down" --
  and the marker is derived from that state rather than from whether the row is
  optional. That distinction was a bug the coordinator caught on the Control
  page (2026-09-25): an optional row printed "[ NOTE ]" even when it was up, so
  a working Reddit reader read as a note, and the Control page -- which keys on
  the row's own fields -- showed a "Fix this" button on a healthy card. "ok" is
  a row that answered the question it was asked; "note" is one that could not be
  read, or a supported degraded state; "down" is a row the paper cannot serve
  without. Only "down" rows count toward the attention figure.

  ASCII only: Windows PowerShell 5.1 reads a BOM-less UTF-8 script as ANSI, so
  anything fancier comes out as mojibake in a console window.
#>

[CmdletBinding()]
param(
  [string]$Root,
  [switch]$DryRun,
  [switch]$Json
)

. (Join-Path $PSScriptRoot "lib-env.ps1")
. (Join-Path $PSScriptRoot "lib-port.ps1")
$ErrorActionPreference = "SilentlyContinue"

$here = Split-Path -Parent $PSScriptRoot
$app  = if ($Root) { $Root } else { $here }
$envFile = Join-Path $app ".env"

# Every line is one row of the same answer, whether it is printed or handed to
# the Control page as JSON. $Id is the row's stable name (the page keys on it),
# $Fix is the Control action id that repairs THIS row, or "" when no button can
# -- an optional service that is allowed to be down, or the watchdog, which
# repairs itself. A fix id that did not match a real action would render a
# button that 404s, so the server checks the ids it is given.
#
# The two new arguments are LAST on purpose: the console wording and the
# argument order every existing caller and every existing check reads have not
# moved, so this stays a change to what a row CARRIES rather than to what a row
# SAYS. (scripts/ops-scripts.test.mjs matches on `Show "The paper"` and on
# `Show "DeepSeek (via Ollama)"` ... $true, and those must keep matching.)
#
# $State is the row's real answer: "ok" / "note" / "down". $Ok is kept alongside
# it because it is the older name and callers read it; $Ok is derived here so
# the two can never disagree.
$checks = New-Object System.Collections.ArrayList

function Show($label, $state, $detail, $optional, $fix, $id) {
  # Anything that is not one of the three words is a bug in this file, and a row
  # whose state nothing recognises must not be able to count as healthy.
  if ($state -notin @("ok", "note", "down")) { $state = "down" }
  [void]$checks.Add([pscustomobject]@{
    id       = $id
    label    = $label
    state    = $state
    ok       = [bool]($state -eq "ok")
    optional = [bool]$optional
    detail   = $detail
    fix      = $fix
  })
  if ($Json) { return }
  # The marker follows the STATE, not whether the row is optional. An optional
  # service that is up prints OK; the plain NOTE is for the supported degraded
  # states (Redlib down, Ollama not running) and for a row that could not be
  # read at all.
  $mark = if ($state -eq "ok") { "  OK  " } elseif ($state -eq "note") { " NOTE " } else { " DOWN " }
  Write-Host ("  [" + $mark + "] " + $label.PadRight(24) + $detail)
}

# 24, not 20: "Reddit reader (Redlib)" and "DeepSeek (via Ollama)" are 22
# characters, and a column that runs over is worse than a wider one.
$port = Read-OpsEnvValue -EnvFile $envFile -Name "PORT" -Fallback "3000"
$site = Read-OpsEnvValue -EnvFile $envFile -Name "PUBLIC_SITE_URL" -Fallback "https://townreporter.org"

if (-not $Json) {
  Write-Host ""
  Write-Host "  TownReporter, as seen from this machine"
  Write-Host "  --------------------------------------"
  if ($app -ne $here) { Write-Host "  (describing $app)" }
  if ($DryRun) { Write-Host "  (dry run: read-only; nothing here starts or stops anything)" }
}

# Database
$pg = @(Get-NetTCPConnection -LocalPort 5433 -State Listen)
Show "Database" $(if ($pg.Count -gt 0) { "ok" } else { "down" }) $(if ($pg.Count) { "answering on 5433" } else { "nothing on port 5433" }) $false "start-all" "database"

# The app
$appOk = $false
$appDetail = "no answer on port $port"
try {
  $r = Invoke-WebRequest -Uri "http://127.0.0.1:$port/" -UseBasicParsing -TimeoutSec 15
  $appOk = ($r.StatusCode -eq 200)
  $appDetail = "answered $($r.StatusCode) on port $port"
} catch { }
Show "The paper" $(if ($appOk) { "ok" } else { "down" }) $appDetail $false "start-all" "paper"

# The tunnel process
$cf = @(Get-Process -Name cloudflared -ErrorAction SilentlyContinue)
Show "Tunnel" $(if ($cf.Count -gt 0) { "ok" } else { "down" }) $(if ($cf.Count) { "$($cf.Count) process(es) running" } else { "cloudflared is not running" }) $false "restart-tunnel" "tunnel"

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
Show "Public site" $(if ($pubOk) { "ok" } else { "down" }) $pubDetail $false "restart-tunnel" "public-site"

# The watchdog
$wd = Get-ScheduledTaskInfo -TaskName "TownReporter Watchdog" -ErrorAction SilentlyContinue
if ($wd -and $wd.LastRunTime) {
  $mins = [int]((Get-Date) - $wd.LastRunTime).TotalMinutes
  Show "Watchdog" $(if ($mins -le 15) { "ok" } else { "down" }) "last ran $mins minute(s) ago" $false "" "watchdog"
} else {
  Show "Watchdog" "down" "never run, or the task is missing" $false "" "watchdog"
}

# The Reddit reader, if this machine has one.
#
# "up" / "down" in plain words, and never a fault marker: the desk reads a
# subreddit through Reddit's .rss when Redlib is down and says so in the source
# text (src\lib\news\reddit.server.ts). lib-redlib.ps1 owns the answer, so this
# line and the watchdog and the Control menu cannot disagree about it.
. (Join-Path $PSScriptRoot "lib-redlib.ps1")
$redlibDetail = ""
$redlibState = "note"
$redlibOptional = $true
# A fix offered only where a fix exists: a restart repairs a stopped reader, not
# an uninstalled one and not a reader the operator switched off on purpose.
$redlibFix = ""
switch (Get-RedlibOffSwitch -EnvFile $envFile) {
  '0' { $redlibDetail = "switched off (TOWNREPORTER_REDLIB=0)" }
  default {
    switch (Get-RedlibState) {
      'up'     { $redlibState = "ok"; $redlibDetail = "up" }
      'down'   { $redlibDetail = "down - the paper reads Reddit through RSS alone"; $redlibFix = "restart-reddit" }
      'absent' { $redlibDetail = "not installed - the paper reads Reddit through RSS alone" }
    }
  }
}
Show "Reddit reader (Redlib)" $redlibState $redlibDetail $redlibOptional $redlibFix "reddit-reader"

# The model the paper drafts with, first rung of the Automatic ladder.
#
# Wording matters here: Ollama being down is not a fault. "Automatic" moves to
# the next rung (src\lib\news\provider-registry.ts `automaticLadder`), so the
# line says what the paper will do, not that something is broken.
. (Join-Path $PSScriptRoot "lib-ollama.ps1")
$ollamaSwitch = Read-OpsEnvValue -EnvFile $envFile -Name "TOWNREPORTER_OLLAMA" -Fallback '1'
$ollamaDetail = ""
$ollamaState = "note"
switch ($ollamaSwitch) {
  '0' { $ollamaDetail = "switched off - the paper will use the next model" }
  default {
    switch (Get-OllamaState -EnvFile $envFile) {
      'up'       { $ollamaState = "ok"; $ollamaDetail = "ready" }
      'starting' { $ollamaDetail = "starting up - the paper will use the next model for now" }
      'down'     { $ollamaDetail = "Ollama not running - the paper will use the next model" }
      'absent'   { $ollamaDetail = "Ollama not installed - the paper will use the next model" }
      'remote'   { $ollamaDetail = "the DeepSeek model is not on this machine" }
    }
  }
}
Show "DeepSeek (via Ollama)" $ollamaState $ollamaDetail $true "" "model-server"

# The headline, and the advice under it. Both are computed from the rows above
# rather than restated, so the console and the JSON cannot disagree.
#
# An OPTIONAL row that is down is never counted as something needing attention:
# the reader falls back to .rss and Automatic walks past a missing model. Only
# the rows the paper cannot serve without are faults -- which is exactly the
# rows whose state is "down".
$faults = @($checks | Where-Object { $_.state -eq "down" })
$attention = $faults.Count

if ($attention -eq 0) {
  $headline = "Everything is up. Nothing to do."
  $advice = ""
} elseif ($appOk -and -not $pubOk) {
  $headline = "The paper is running but the outside world cannot reach it."
  $advice = "Try option 3, restart the tunnel."
} elseif (-not $appOk -and $pg.Count -gt 0) {
  $headline = "The database is up but the paper is not."
  $advice = "Try option 4."
} elseif ($pg.Count -eq 0) {
  $headline = "The database is not running, so nothing else can be."
  $advice = "Try option 4."
} else {
  $headline = "The watchdog is not running."
  $advice = "Run ops\install-tasks.ps1, or start the TownReporter Watchdog task."
}

if ($Json) {
  # One object on stdout, nothing else. -Compress so it is a single line: the
  # caller reads the whole of stdout and a pretty-printed object would still
  # parse, but a single line keeps the server's log honest about what came back.
  [pscustomobject]@{
    app         = "TownReporter"
    root        = $app
    port        = $port
    site        = $site
    checkedAt   = (Get-Date).ToString("o")
    attention   = $attention
    headline    = $headline
    advice      = $advice
    checks      = @($checks)
  } | ConvertTo-Json -Depth 6 -Compress
  exit 0
}

Write-Host ""
Write-Host "  $headline"
if ($advice) { Write-Host "  $advice" }
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
