<#
  Starts TownReporter and the Postgres it depends on. Safe to run repeatedly:
  each step is a no-op when the thing is already up.

  Registered as a logon scheduled task by ops/install-tasks.ps1.

  Postgres lives on 5433, NOT the default 5432 — another Postgres that does not
  belong to this project already owns 5432 on this machine. Do not "fix" that by
  moving back; the split is what stops the desk writing to the wrong cluster.
#>
$ErrorActionPreference = "Stop"
$app  = Split-Path -Parent $PSScriptRoot
$bin  = "$env:USERPROFILE\scoop\apps\postgresql\current\bin"
$data = "$env:USERPROFILE\scoop\persist\postgresql\data"
$log  = "$env:USERPROFILE\scoop\persist\postgresql\pg.log"

function Test-Port($p) {
  [bool](Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue)
}

if (-not (Test-Port 5433)) {
  Start-Process -FilePath "$bin\pg_ctl.exe" `
    -ArgumentList "-D","`"$data`"","-l","`"$log`"","start" -NoNewWindow
  for ($i = 0; $i -lt 30 -and -not (Test-Port 5433); $i++) { Start-Sleep -Seconds 1 }
}
if (-not (Test-Port 5433)) { throw "Postgres did not come up on 5433" }

# Apply any migrations added since the last run, then serve.
Set-Location $app

<#
  Capture output to a file.

  The task runs hidden, so anything the app writes to stdout/stderr previously
  went nowhere. That was invisible right up until a scan misbehaved mid-run and
  there was nothing to read. Scan errors, failed fetches, model errors and the
  job drain all log here.

  Kept to the last ~5 MB: a busy desk is chatty and an unbounded log on the
  machine that also serves the paper is its own problem.
#>
$logDir = Join-Path $app "logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$appLog = Join-Path $logDir "townreporter.log"

if ((Test-Path $appLog) -and ((Get-Item $appLog).Length -gt 5MB)) {
  Move-Item $appLog (Join-Path $logDir "townreporter.prev.log") -Force
}

"=== started $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') ===" | Add-Content $appLog

& node scripts/with-app-env.mjs node scripts/migrate.mjs 2>&1 | Add-Content $appLog

if (-not (Test-Port 3000)) {
  # Start-Process, not `| Add-Content`: a PowerShell pipeline holds an exclusive
  # write handle for as long as the app runs, so the log could not be read while
  # the thing you wanted to debug was happening. Redirected process handles allow
  # concurrent reads.
  #
  # node.exe directly rather than the `npm` shim — Start-Process cannot execute
  # a .cmd shim, and this is exactly what `npm start` runs anyway.
  $node = (Get-Command node -ErrorAction Stop).Source
  Start-Process -FilePath $node `
    -ArgumentList "scripts/with-app-env.mjs","node",".output/server/index.mjs" `
    -WorkingDirectory $app `
    -RedirectStandardOutput (Join-Path $logDir "app.out.log") `
    -RedirectStandardError  (Join-Path $logDir "app.err.log") `
    -NoNewWindow
}
