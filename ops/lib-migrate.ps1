<#
  The two steps between "Postgres is listening" and "serve the paper".

  On 2026-09-25 the logon task ran at 20:01, wrote its own "=== started ==="
  line, and then nothing: no [migrate] line, no app, and the site served 502
  until the task was run by hand. The two lines that did it were in
  ops\start-townreporter.ps1:

      $ErrorActionPreference = "Stop"
      & node scripts/with-app-env.mjs node scripts/migrate.mjs 2>&1 | Add-Content $appLog

  In Windows PowerShell 5.1 a native command's stderr under `2>&1` arrives as
  an ErrorRecord, and with the preference on Stop that record is TERMINATING:
  the pipeline stops, the script dies, and everything after it -- the app
  itself -- never runs. At boot Postgres answers the TCP port before it accepts
  queries; migrate wrote "the database system is starting up" to stderr and the
  logon start died on it. The port-only wait above it is exactly the check that
  let that through: a listening port is not a database.

  So this file owns both steps, and neither can be ended by what a child
  process writes:

    Wait-TownReporterDatabase   ask Postgres a real query, up to three minutes,
                                with backoff, and put what it said while it was
                                not ready into the log in plain words
    Invoke-TownReporterMigrate  run migrate with cmd.exe doing the redirection,
                                so its stderr is cmd's own stream and can never
                                be a PowerShell error; capture every line and
                                the exit code into the log; retry three times
                                ten seconds apart; and REPORT the failure
                                rather than throwing on it

  Both are dot-sourced by ops\start-townreporter.ps1, so the logon task logs
  every attempt and exits non-zero when the paper cannot be served -- which is
  the signal ops\watchdog.ps1 now acts on.

  Why cmd.exe owns the redirection: a PowerShell pipeline that reads a native
  command's stderr is the thing that killed the logon task. Handing the whole
  command line to `cmd /c` and pointing Start-Process at two files means no
  PowerShell stream ever carries the child's stderr, whatever the preference is
  in the calling script. The exit code still comes back, and the text still
  lands in the log.

  Dot-source it:
    . (Join-Path $PSScriptRoot "lib-migrate.ps1")
  Then use:
    Wait-TownReporterDatabase -Bin $bin -ConnectionString $url -Log $appLog
    Invoke-TownReporterMigrate -App $app -Log $appLog

  ASCII only: Windows PowerShell 5.1 reads a BOM-less UTF-8 file as ANSI.
#>

. (Join-Path $PSScriptRoot "lib-env.ps1")

function Get-TownReporterDatabaseUrl {
  param([Parameter(Mandatory = $true)][string]$App)
  return (Read-OpsEnvValue -EnvFile (Join-Path $App ".env") -Name "DATABASE_URL" -Fallback "")
}

# The shell that runs the child, as an absolute path: never a PATH lookup, so a
# stray cmd.exe earlier on the path cannot be what applies the migrations.
function Get-TownReporterShell {
  if ($env:ComSpec) { return $env:ComSpec }
  return (Join-Path $env:WINDIR "System32\cmd.exe")
}

<#
  Run one command line through cmd.exe and return what it did.

    Code     the child's exit code (cmd /c propagates the last command's)
    Output   its stdout, one line per element
    Errors   its stderr, one line per element
    Ran      $false only when the process could not be started at all

  Both streams are redirected to FILES rather than piped into PowerShell, and
  the preference is flipped to Continue for the duration as well. Two
  independent reasons the same failure cannot come back: no ErrorRecord is
  built from this child's stderr, and if one were, it would not be terminating.
#>
function Invoke-TownReporterCommand {
  param(
    [Parameter(Mandatory = $true)][string]$CommandLine,
    [Parameter(Mandatory = $true)][string]$StdOutFile,
    [Parameter(Mandatory = $true)][string]$StdErrFile,
    [string]$WorkingDirectory
  )
  $before = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  $code = 1
  $ran = $true
  Remove-Item -LiteralPath $StdOutFile, $StdErrFile -Force -ErrorAction SilentlyContinue
  try {
    # ArgumentList is an ARRAY with the command line as ONE element: cmd /c
    # takes everything after the switch as its command, so no part of the
    # command line is ever re-parsed or re-quoted on the way through.
    $startArgs = @{
      FilePath               = (Get-TownReporterShell)
      # /s + one outer pair of quotes: cmd strips exactly that pair and keeps every
      # inner quote. Plain /c strips the FIRST and LAST quote of a line that starts
      # with one, which broke "C:\...\psql.exe" -d "..." -tAc "select 1" at boot.
      ArgumentList           = @("/s", "/c", ("`"" + $CommandLine + "`""))
      NoNewWindow            = $true
      RedirectStandardOutput = $StdOutFile
      RedirectStandardError  = $StdErrFile
      PassThru               = $true
      Wait                   = $true
    }
    if ($WorkingDirectory) { $startArgs["WorkingDirectory"] = $WorkingDirectory }
    $proc = Start-Process @startArgs
    $code = [int]$proc.ExitCode
  } catch {
    $ran = $false
    $code = 1
    Set-Content -LiteralPath $StdErrFile -Value "could not run it at all: $($_.Exception.Message)" -Force -ErrorAction SilentlyContinue
  } finally {
    $ErrorActionPreference = $before
  }
  $out = @()
  $err = @()
  if (Test-Path -LiteralPath $StdOutFile) { $out = @(Get-Content -LiteralPath $StdOutFile -ErrorAction SilentlyContinue) }
  if (Test-Path -LiteralPath $StdErrFile) { $err = @(Get-Content -LiteralPath $StdErrFile -ErrorAction SilentlyContinue) }
  return [pscustomobject]@{
    Code    = $code
    Output  = $out
    Errors  = $err
    Ran     = $ran
    Command = $CommandLine
  }
}

<#
  The command line that asks Postgres a real question on the connection this
  install actually uses.

  psql -tAc "select 1" is preferred: it ships beside the pg_ctl.exe this script
  already starts, needs no npm dependency, and proves the server will run a
  query -- which is the thing that was not true when the port was already open.
  pg_isready is the fallback when a cluster has no client tools; it is a weaker
  question, so it is only used when psql is absent.
#>
function Get-TownReporterPgProbe {
  param([string]$Bin, [string]$ConnectionString)
  if (-not $Bin -or -not $ConnectionString) { return "" }
  $psql = Join-Path $Bin "psql.exe"
  if (Test-Path -LiteralPath $psql) {
    return ('"' + $psql + '" -d "' + $ConnectionString + '" -tAc "select 1"')
  }
  $isReady = Join-Path $Bin "pg_isready.exe"
  if (Test-Path -LiteralPath $isReady) {
    $hostName = "127.0.0.1"
    $portNumber = ""
    try {
      $uri = [uri]$ConnectionString
      if ($uri.Host) { $hostName = $uri.Host }
      if ($uri.Port -gt 0) { $portNumber = [string]$uri.Port }
    } catch { }
    return ('"' + $isReady + '" -h ' + $hostName + ' -p ' + $portNumber + ' -q')
  }
  return ""
}

<#
  Wait until Postgres will ANSWER A QUERY, not merely accept a socket.

  Returns $true when it answered, $false when the budget ran out. Either way
  the log says what happened in plain words, including what Postgres itself
  said while it was not ready -- "the database system is starting up" is the
  line that names crash recovery, and it is worth more to the next reader than
  any sentence written here.

  The last reason is only written when it CHANGES, so a three-minute recovery
  is a handful of log lines rather than sixty copies of the same one.
#>
function Wait-TownReporterDatabase {
  param(
    [Parameter(Mandatory = $true)][string]$Log,
    [Parameter(Mandatory = $true)][string]$Bin,
    [Parameter(Mandatory = $true)][string]$ConnectionString,
    [int]$TimeoutSeconds = 180,
    [int]$MaxIntervalSeconds = 5,
    # Test-only seam: a command line to ask instead of psql, so a CI runner can
    # prove the wait survives a database that refuses queries for a while
    # without a real cluster anywhere near it. Unset on the machine that serves
    # the paper, where psql is the question.
    [string]$ProbeCommand
  )
  $probe = $ProbeCommand
  # Which instrument asked, named in the log: "accepted a query" means the
  # stronger psql question when psql is what asked it, and the weaker
  # "is the server accepting connections" when pg_isready is all a cluster
  # ships. A verdict is only as good as the question behind it.
  $how = "psql"
  if ($ProbeCommand) {
    $how = "the probe this run was given"
  } elseif (-not (Test-Path -LiteralPath (Join-Path $Bin "psql.exe"))) {
    $how = "pg_isready"
  }
  if (-not $probe) { $probe = Get-TownReporterPgProbe -Bin $Bin -ConnectionString $ConnectionString }
  if (-not $probe) {
    # No client tool to ask with. Say so and go on: migrate has its own retries,
    # and a probe that cannot run must not be the reason the paper stays down.
    "[postgres] no psql.exe or pg_isready.exe in $Bin, so no query could be asked; going on to migrations, which retry" | Add-Content -LiteralPath $Log
    return $true
  }
  # The probe's own words land in a file beside the log, not in it: sixty
  # copies of a recovery message would bury the lines that matter.
  $logDir = Split-Path -Parent $Log
  $probeOut = Join-Path $logDir "boot-probe.out.log"
  $probeErr = Join-Path $logDir "boot-probe.err.log"

  $started = Get-Date
  $waited = 0
  $attempt = 0
  $lastReason = ""
  while ($true) {
    $attempt++
    $result = Invoke-TownReporterCommand -CommandLine $probe -StdOutFile $probeOut -StdErrFile $probeErr
    $answered = ($result.Code -eq 0 -and (@($result.Output) -match '^\s*1\s*$').Count -gt 0)
    if ($answered) {
      $seconds = [int]((Get-Date) - $started).TotalSeconds
      if ($waited -gt 0) {
        "[postgres] accepted a query after $seconds second(s) and $attempt attempt(s), asked with $how" | Add-Content -LiteralPath $Log
      } else {
        "[postgres] accepted a query straight away, asked with $how" | Add-Content -LiteralPath $Log
      }
      return $true
    }
    $reason = (@($result.Errors) + @($result.Output) | Where-Object { "$_".Trim() } | Select-Object -First 1)
    if (-not $reason) { $reason = "exit code $($result.Code) and no output" }
    $reason = ("$reason").Trim()
    if ($reason -ne $lastReason) {
      "[postgres] not answering queries yet ($reason)" | Add-Content -LiteralPath $Log
      $lastReason = $reason
    }
    if ($waited -ge $TimeoutSeconds) { break }
    # 1s, 2s, 3s ... capped: quick while a recovery is about to finish, and
    # cheap while it is not. Both ends matter -- this runs at every logon.
    $sleep = [Math]::Min($attempt, $MaxIntervalSeconds)
    if (($waited + $sleep) -gt $TimeoutSeconds) { $sleep = $TimeoutSeconds - $waited }
    Start-Sleep -Seconds $sleep
    $waited += $sleep
  }
  $howLong = if ($TimeoutSeconds -ge 60) { "$([int]($TimeoutSeconds / 60)) minute(s)" } else { "$TimeoutSeconds second(s)" }
  "[postgres] would not answer a query within $howLong, so the paper was NOT started." | Add-Content -LiteralPath $Log
  "[postgres] last thing it said was: $lastReason" | Add-Content -LiteralPath $Log
  "[postgres] its own log is townreporter-postgres.log in the data directory; a dirty shutdown means crash recovery, and recovery sometimes takes longer than its own wait." | Add-Content -LiteralPath $Log
  return $false
}

<#
  Apply the migrations, and keep applying them until they take or the tries run
  out. Returns $true when the schema is current, $false when it is not.

  The command line is exactly the one that was there before -- same script, same
  wrapper, same `2>&1` -- with cmd.exe doing the redirection. That is the whole
  repair: the command did not need to change, only the stream it writes to.
#>
function Invoke-TownReporterMigrate {
  param(
    [Parameter(Mandatory = $true)][string]$App,
    [Parameter(Mandatory = $true)][string]$Log,
    [int]$Attempts = 3,
    [int]$DelaySeconds = 10,
    [string]$Node,
    # Test-only seam: the command line to run instead of migrate, so a CI
    # runner can prove the retry keeps going when something writes to stderr
    # and fails twice. Unset on the machine that serves the paper.
    [string]$CommandLine
  )
  $command = $CommandLine
  if (-not $command) {
    $nodeExe = $Node
    if (-not $nodeExe) { $nodeExe = "node" }
    $command = ('"' + $nodeExe + '" scripts/with-app-env.mjs node scripts/migrate.mjs 2>&1')
  }
  $logDir = Split-Path -Parent $Log
  $outFile = Join-Path $logDir "boot-migrate.out.log"
  $errFile = Join-Path $logDir "boot-migrate.err.log"

  for ($attempt = 1; $attempt -le $Attempts; $attempt++) {
    "[migrate] attempt $attempt of $Attempts" | Add-Content -LiteralPath $Log
    $result = Invoke-TownReporterCommand -CommandLine $command -WorkingDirectory $App -StdOutFile $outFile -StdErrFile $errFile
    foreach ($line in @($result.Output)) { "[migrate]   $line" | Add-Content -LiteralPath $Log }
    foreach ($line in @($result.Errors)) { "[migrate]   (stderr) $line" | Add-Content -LiteralPath $Log }
    if ($result.Code -eq 0) {
      "[migrate] applied, exit code 0" | Add-Content -LiteralPath $Log
      return $true
    }
    "[migrate] attempt $attempt failed with exit code $($result.Code)" | Add-Content -LiteralPath $Log
    if ($attempt -lt $Attempts) {
      "[migrate] waiting $DelaySeconds second(s) and trying again" | Add-Content -LiteralPath $Log
      Start-Sleep -Seconds $DelaySeconds
    }
  }
  "[migrate] the database schema is NOT current after $Attempts attempts, so the paper was NOT started." | Add-Content -LiteralPath $Log
  "[migrate] the whole of the last attempt is in boot-migrate.out.log and boot-migrate.err.log beside this log." | Add-Content -LiteralPath $Log
  return $false
}
