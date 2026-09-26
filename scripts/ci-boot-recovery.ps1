<#
  The proof that a reboot cannot kill the logon start any more.

  On 2026-09-25 the logon task ran at 20:01, wrote its own "=== started ==="
  line, and then nothing -- no [migrate] line, no app, 502 from the site until
  someone ran the task by hand. The two lines that did it were in
  ops\start-townreporter.ps1:

      $ErrorActionPreference = "Stop"
      & node scripts/with-app-env.mjs node scripts/migrate.mjs 2>&1 | Add-Content $appLog

  In Windows PowerShell 5.1 a native command's stderr under 2>&1 arrives as an
  ErrorRecord, and with the preference on Stop that record TERMINATES the
  script. At boot Postgres answers the port before it accepts queries, migrate
  wrote "the database system is starting up" to stderr, and the logon start
  died on the first line of it.

  A reboot is not needed to prove this, and is not used here. This script runs
  the real functions -- Wait-TownReporterDatabase and Invoke-TownReporterMigrate
  out of ops\lib-migrate.ps1, which is the exact code ops\start-townreporter.ps1
  runs between "the port is open" and "serve the paper" -- against stubs:

    * a probe that refuses to answer twice (writing "the database system is
      starting up" to stderr, like a Postgres in crash recovery) and then
      answers, which is the boot that used to kill the task
    * a probe that never answers, which must end in a plain-words line and a
      FALSE return rather than a throw
    * a migrate that fails twice on stderr and then succeeds, under
      $ErrorActionPreference = "Stop" in the caller -- exactly the conditions
      of the failure
    * a migrate that never succeeds, which must report rather than throw
    * the old idiom itself, run once to show it really does die: that is the
      regression this file exists to keep shut

  Nothing here touches Postgres, this machine's 5433, the paper, or any other
  live service. It is all .cmd stubs in a temp directory, and the only
  PowerShell it runs is this repo's own ops code. Safe to run on the machine
  that serves the paper.

  Run:
    powershell -ExecutionPolicy Bypass -File scripts\ci-boot-recovery.ps1
    powershell -ExecutionPolicy Bypass -File scripts\ci-boot-recovery.ps1 -Keep

  Exit 0 when every check passed. Anything else prints FAIL lines and exits 1,
  and the temp directory is left behind with -Keep.

  ASCII only: Windows PowerShell 5.1 reads a BOM-less UTF-8 script as ANSI.
#>
[CmdletBinding()]
param(
  [string]$WorkDir,
  [switch]$Keep
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
. (Join-Path $repoRoot "ops\lib-migrate.ps1")

$failures = New-Object System.Collections.ArrayList
function Check {
  param([string]$What, [bool]$Ok, [string]$Detail = "")
  if ($Ok) {
    Write-Host "  ok    $What"
  } else {
    Write-Host "  FAIL  $What"
    if ($Detail) { Write-Host "        $Detail" }
    [void]$failures.Add($What)
  }
}

function Read-Log {
  param([string]$Log)
  if (-not (Test-Path -LiteralPath $Log)) { return "" }
  return (Get-Content -Raw -LiteralPath $Log -ErrorAction SilentlyContinue)
}

function Write-Stub {
  param([string]$Path, [string[]]$Lines)
  $dir = Split-Path -Parent $Path
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
  Set-Content -LiteralPath $Path -Value $Lines -Encoding ASCII
}

$temp = $WorkDir
if (-not $temp) {
  $temp = Join-Path ([IO.Path]::GetTempPath()) ("boot-recovery-" + [Guid]::NewGuid().ToString("N").Substring(0, 8))
}
New-Item -ItemType Directory -Force -Path $temp | Out-Null
$logDir = Join-Path $temp "logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$bin = Join-Path $temp "bin"
New-Item -ItemType Directory -Force -Path $bin | Out-Null
$dbUrl = "postgres://postgres@127.0.0.1:5433/townreporter"

Write-Host ""
Write-Host "  Boot recovery, proven without a reboot"
Write-Host "  -------------------------------------"
Write-Host "  working in $temp"
Write-Host ""

<#
  The stubs.

  goto rather than an if-block per attempt: batch parses a parenthesised block
  as one line, so `if ... ( redirect & exit /b )` is a class of bug in its own
  right and this is the shape that cannot go wrong. `%~dp0` is the stub's own
  directory, so each stub keeps its marker files beside itself.
#>
$probeCmd = Join-Path $temp "probe\probe.cmd"
Write-Stub -Path $probeCmd -Lines @(
  "@echo off",
  "if not exist ""%~dp0try1"" goto first",
  "if not exist ""%~dp0try2"" goto second",
  "echo 1",
  "exit /b 0",
  ":first",
  "type nul > ""%~dp0try1""",
  "echo the database system is starting up 1>&2",
  "exit /b 2",
  ":second",
  "type nul > ""%~dp0try2""",
  "echo the database system is starting up 1>&2",
  "exit /b 2"
)

$migrateCmd = Join-Path $temp "migrate\migrate.cmd"
Write-Stub -Path $migrateCmd -Lines @(
  "@echo off",
  "if not exist ""%~dp0try1"" goto first",
  "if not exist ""%~dp0try2"" goto second",
  "echo applying migrations",
  "echo the schema is current",
  "exit /b 0",
  ":first",
  "type nul > ""%~dp0try1""",
  "echo the database system is starting up 1>&2",
  "exit /b 3",
  ":second",
  "type nul > ""%~dp0try2""",
  "echo the database system is starting up 1>&2",
  "exit /b 3"
)

$alwaysFails = Join-Path $temp "always-fails\always-fails.cmd"
Write-Stub -Path $alwaysFails -Lines @(
  "@echo off",
  "echo the database system is starting up 1>&2",
  "exit /b 3"
)

# ---------------------------------------------------------------------------
# 1. The boot that killed the task: the database refuses, then answers.
# ---------------------------------------------------------------------------
Write-Host "  1. a database that refuses queries for two attempts, then answers"
$probeLog = Join-Path $logDir "probe-recovers.log"
$answered = Wait-TownReporterDatabase -Log $probeLog -Bin $bin -ConnectionString $dbUrl `
  -TimeoutSeconds 30 -MaxIntervalSeconds 1 -ProbeCommand ('"' + $probeCmd + '"')
$text = Read-Log $probeLog
Check "the wait returns true once a query is answered" ($answered -eq $true)
Check "it logged that it was refused at least once" ($text -match 'not answering queries yet \(the database system is starting up\)') $text
Check "it logged what the database said while it was not ready" ($text -match 'the database system is starting up') $text
Check "it logged the recovery in the end" ($text -match 'accepted a query after \d+ second\(s\) and 3 attempt\(s\)') $text
Check "it says which instrument asked the question" ($text -match 'accepted a query after \d+ second\(s\) and 3 attempt\(s\), asked with the probe this run was given') $text
Check "the unchanged reason is written once, not once per attempt" (([regex]::Matches($text, 'not answering queries yet')).Count -eq 1) $text

# ---------------------------------------------------------------------------
# 2. The database never answers: a plain-words failure, not a throw.
# ---------------------------------------------------------------------------
Write-Host "  2. a database that never answers"
$deadLog = Join-Path $logDir "probe-dead.log"
$dead = $true
try {
  $dead = Wait-TownReporterDatabase -Log $deadLog -Bin $bin -ConnectionString $dbUrl `
    -TimeoutSeconds 2 -MaxIntervalSeconds 1 -ProbeCommand ('"' + $alwaysFails + '"')
} catch {
  Check "the wait does not throw when the budget runs out" $false $_.Exception.Message
}
$text = Read-Log $deadLog
Check "the wait returns false when the budget runs out" ($dead -eq $false)
Check "it says in plain words that the paper was not started" ($text -match 'would not answer a query within 2 second\(s\), so the paper was NOT started') $text
Check "it names the last thing the database said" ($text -match 'last thing it said was: the database system is starting up') $text

# ---------------------------------------------------------------------------
# 3. No client tool at all: go on to migrate, which retries.
# ---------------------------------------------------------------------------
Write-Host "  3. a cluster with no psql.exe or pg_isready.exe"
$noToolLog = Join-Path $logDir "probe-notool.log"
$noTool = Wait-TownReporterDatabase -Log $noToolLog -Bin $bin -ConnectionString $dbUrl
$text = Read-Log $noToolLog
Check "the wait does not block the paper on a missing client tool" ($noTool -eq $true)
Check "it says why it asked nothing" ($text -match 'no psql\.exe or pg_isready\.exe in') $text

# ---------------------------------------------------------------------------
# 4. migrate fails twice on stderr and then succeeds, under Stop.
# ---------------------------------------------------------------------------
Write-Host "  4. migrate fails twice, then applies (the caller is on Stop)"
$migrateLog = Join-Path $logDir "migrate-recovers.log"
$applied = $false
$threw = ""
try {
  # $ErrorActionPreference is Stop in THIS script, exactly as it is in
  # ops\start-townreporter.ps1. That preference is the whole of the defect: if
  # the migrate child's stderr can reach a PowerShell stream, this throw
  # happens and everything after it -- the app start -- never runs.
  $applied = Invoke-TownReporterMigrate -App $temp -Log $migrateLog -CommandLine ('"' + $migrateCmd + '"') -Attempts 3 -DelaySeconds 0
} catch {
  $threw = $_.Exception.Message
}
$text = Read-Log $migrateLog
Check "the caller's Stop preference did not end the script" ($threw -eq "") $threw
Check "migrate is reported as applied" ($applied -eq $true)
Check "the first attempt is in the log" ($text -match '\[migrate\] attempt 1 of 3') $text
Check "the child's stderr is in the log, marked as stderr" ($text -match '\[migrate\]   \(stderr\) the database system is starting up') $text
Check "the failed exit code is in the log" ($text -match '\[migrate\] attempt 1 failed with exit code 3') $text
Check "the third attempt is in the log" ($text -match '\[migrate\] attempt 3 of 3') $text
Check "the success is in the log" ($text -match '\[migrate\] applied, exit code 0') $text
Check "the child's own output is in the log" ($text -match '\[migrate\]   the schema is current') $text

# ---------------------------------------------------------------------------
# 5. migrate never succeeds: report, do not throw.
# ---------------------------------------------------------------------------
Write-Host "  5. migrate that never applies"
$stuckLog = Join-Path $logDir "migrate-stuck.log"
$stuck = $true
$threw = ""
try {
  $stuck = Invoke-TownReporterMigrate -App $temp -Log $stuckLog -CommandLine ('"' + $alwaysFails + '"') -Attempts 3 -DelaySeconds 0
} catch {
  $threw = $_.Exception.Message
}
$text = Read-Log $stuckLog
Check "a permanently failing migrate does not throw" ($threw -eq "") $threw
Check "it returns false, so the caller can exit non-zero" ($stuck -eq $false)
Check "all three attempts were made" (([regex]::Matches($text, '\[migrate\] attempt \d of 3')).Count -eq 3) $text
Check "it says the schema is NOT current and the paper was NOT started" ($text -match 'the database schema is NOT current after 3 attempts, so the paper was NOT started') $text
Check "it says where the whole of the last attempt is" ($text -match 'boot-migrate\.out\.log and boot-migrate\.err\.log') $text

# ---------------------------------------------------------------------------
# 6. The old idiom, run once, to show it really does die.
# ---------------------------------------------------------------------------
Write-Host "  6. the 2026-09-25 idiom, for the record"
$oldWayDied = $false
try {
  $ErrorActionPreference = "Stop"
  & (Get-TownReporterShell) "/c" ('"' + $alwaysFails + '"') 2>&1 | Out-Null
} catch {
  $oldWayDied = $true
} finally {
  $ErrorActionPreference = "Stop"
}
Check "a native command's stderr under 2>&1 still terminates on Stop (the cause)" ($oldWayDied -eq $true)

Write-Host ""
if ($failures.Count -gt 0) {
  Write-Host "  boot recovery: $($failures.Count) check(s) FAILED"
  Write-Host ""
  exit 1
}
Write-Host "  boot recovery: every check passed"
Write-Host ""

if (-not $Keep -and -not $WorkDir) {
  Remove-Item -LiteralPath $temp -Recurse -Force -ErrorAction SilentlyContinue
}
exit 0
