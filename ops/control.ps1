<#
  Open the Control page. This is what the Desktop icon runs.

  The Desktop icon used to open `TownReporter Control.cmd` -- a numbered menu in
  a console window running `cmd /k`. The owner, 2026-09-25: "You know what I'd
  like instead of a terminal screen like this is something like mission control
  for DSH." This launcher is that substitution: it starts the local Control page
  with no window at all and opens the browser on it. The menu is still in the
  repository as the fallback (menu line 7 opens this).

  It is NOT a scheduled task and NOT a service. The page's server starts here,
  when somebody asks for it, and goes away by itself an hour later. Nothing
  about this file changes what the paper does.

  Two things it deliberately does NOT do:

    - It never starts the paper, the tunnel, Postgres, Redlib or Ollama. The
      page is a window onto the install; the buttons on the page are what act,
      and only when a person presses one.
    - It never installs or repairs anything. If node is not on this machine it
      says so and exits -- guessing at an interpreter to run would be worse than
      the sentence explaining why it stopped.

  Run from anywhere: double-clicked via the shortcut, or by hand.

    ops\control.ps1
    ops\control.ps1 -NoBrowser     # start it, do not open a window
    ops\control.ps1 -Check         # is it running? exit 0 if yes, 1 if no

  ASCII only: PS 5.1 reads a BOM-less UTF-8 file as ANSI.
#>

[CmdletBinding()]
param(
  [int]$Port = 3095,
  [switch]$NoBrowser,
  [switch]$Check
)

$ErrorActionPreference = "SilentlyContinue"

$app = Split-Path -Parent $PSScriptRoot
$server = Join-Path $PSScriptRoot "control\control-server.mjs"
$pidFile = Join-Path $PSScriptRoot ".control.pid"
$url = "http://127.0.0.1:$Port/"

# 127.0.0.1, never localhost: localhost can resolve to ::1, and TW-INC-2026-09-02
# is the incident where exactly that made a health probe answer for a different
# program's socket. The page's server binds IPv4 loopback and this must ask the
# same question it answers.
function Test-ControlAnswering {
  try {
    $r = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 4
    return ($r.StatusCode -eq 200)
  } catch {
    return $false
  }
}

if ($Check) {
  if (Test-ControlAnswering) { exit 0 }
  exit 1
}

if (-not (Test-Path $server)) {
  Write-Host "The Control page is missing: $server"
  exit 1
}

# Already up? Then this is just "open the window", which is what pressing the
# Desktop icon for the second time should mean.
if (Test-ControlAnswering) {
  if (-not $NoBrowser) { Start-Process $url }
  exit 0
}

# The pid file is left by the server itself. It is only a hint -- the page
# answering above is the real answer -- but it lets this launcher say "it is
# starting" instead of starting a second one underneath a slow first start.
$starting = $false
if (Test-Path $pidFile) {
  $recorded = 0
  [void][int]::TryParse((Get-Content $pidFile -First 1), [ref]$recorded)
  if ($recorded -gt 0 -and (Get-Process -Id $recorded -ErrorAction SilentlyContinue)) {
    # Something with that pid is alive and the page is not answering yet:
    # give it the ten seconds below before concluding anything.
    $starting = $true
  } else {
    # A pid file whose process is gone is a server that was killed rather than
    # closed. Remove it so the next reader is not misled by it.
    Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
  }
}

$node = Get-Command node.exe -ErrorAction SilentlyContinue
if (-not $node) {
  Write-Host "Node is not installed on this machine, so the Control page cannot start."
  Write-Host "The menu still works: ops\TownReporter Control.cmd"
  exit 1
}

if (-not $starting) {
  # Start it hidden and detached. -WindowStyle Hidden on node.exe means no
  # console is ever drawn for it: the page is the interface, and a black window
  # appearing next to the browser would be the terminal screen this replaced.
  Start-Process -FilePath $node.Source `
    -ArgumentList @($server) `
    -WorkingDirectory $app `
    -WindowStyle Hidden | Out-Null
}

# Wait for it to answer. Ten seconds is generous for a zero-dependency server on
# loopback; the wait exists so a slow start does not open a browser on a page
# that is not there yet.
$ready = $false
for ($i = 0; $i -lt 20; $i++) {
  Start-Sleep -Milliseconds 500
  if (Test-ControlAnswering) { $ready = $true; break }
}

if (-not $ready) {
  Write-Host "The Control page did not answer on $url within ten seconds."
  Write-Host "Nothing else was started or stopped. Try again, or use the menu:"
  Write-Host "  ops\TownReporter Control.cmd"
  exit 1
}

if (-not $NoBrowser) { Start-Process $url }
exit 0
