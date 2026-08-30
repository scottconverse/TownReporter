<#
  Stops this install's TownReporter server. Postgres only if you ask.

  Never matches by image name: `node.exe` and `postgres.exe` both run on this
  machine for other things, and a blanket stop-by-name has taken down
  unrelated software here before.

  Postgres is shared. One cluster on 5433 serves the live paper, the
  development copy, the end-to-end databases and whatever scratch databases
  are in flight, so stopping it as part of stopping the paper reaches a long
  way past the paper. It is now opt-in.

    ops\stop-townreporter.ps1                    # the app only
    ops\stop-townreporter.ps1 -IncludeDatabase   # the app and the cluster
#>
[CmdletBinding()]
param([switch]$IncludeDatabase)

$app = Split-Path -Parent $PSScriptRoot

<#
  Stop the server on THIS install's port, not every TownReporter on the box.

  The match was on the command line alone. Every instance runs the same
  `node .output/server/index.mjs`, with no absolute path in it, so the filter
  read as "stop the paper" and behaved as "stop every TownReporter server on
  this machine". This box runs a development copy and several throwaway
  instances beside the live one, so a promotion would have taken them all
  down, and the first sign would have been someone else's work stopping for
  no reason.

  The port is the discriminator: it comes from this install's own .env, and
  two servers cannot share one. Whoever is listening on it IS this install.
#>
. (Join-Path $PSScriptRoot "lib-port.ps1")

$owners = @(Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue |
            Select-Object -ExpandProperty OwningProcess -Unique)
if ($owners.Count -eq 0) {
  Write-Host "nothing is listening on $port"
}
foreach ($owner in $owners) {
  $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$owner" -ErrorAction SilentlyContinue
  if (-not $proc) { continue }
  # Belt and braces: the port says which install, this says it is our server
  # and not something unrelated that happens to have taken the socket.
  if ($proc.Name -ne 'node.exe' -or $proc.CommandLine -notlike "*.output/server/index.mjs*") {
    Write-Host "port $port is held by PID $owner ($($proc.Name)), which is not this app -- leaving it alone"
    continue
  }
  Write-Host "stopping app PID $owner on port $port"
  Stop-Process -Id $owner -Force -ErrorAction SilentlyContinue
}

$bin  = "$env:USERPROFILE\scoop\apps\postgresql\current\bin"
$data = "$env:USERPROFILE\scoop\persist\postgresql\data"
if (-not $IncludeDatabase) {
  Write-Host "leaving Postgres running (shared with the development copy); pass -IncludeDatabase to stop it too"
} elseif (Get-NetTCPConnection -LocalPort 5433 -State Listen -ErrorAction SilentlyContinue) {
  Write-Host "stopping Postgres on 5433"
  & "$bin\pg_ctl.exe" -D $data stop -m fast
}
