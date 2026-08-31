<#
  Put the current main branch onto this install, safely and repeatably.

  Promotion had been a sequence of commands typed from memory, which is how a
  running server got rebuilt underneath itself earlier in this project: every
  health check answered 200 while the editor's desk was dead in the browser for
  twelve minutes. The order below is the lesson from that. Nothing is built
  while the server is up.

  What it does, in order:

    1. refuses if this checkout has uncommitted work, so nothing is lost
    2. backs the database up, and refuses to continue if the dump looks empty
    3. records what is on the paper now, to compare against afterwards
    4. stops THIS install's server (not the shared Postgres, not other installs)
    5. fetches and fast-forwards to origin/main
    6. installs dependencies only if the lockfile actually moved
    7. builds
    8. starts, and waits for the port
    9. verifies: local page, public page, and the same number of stories

  If step 9 fails it says so loudly and tells you where the backup is. It does
  not roll back on its own: an automatic rollback of a half-applied migration
  is a worse problem than a stopped paper, and the operator should decide.

  It promotes the install it LIVES IN, found from its own location, not a path
  passed to it. Running the development copy promotes the development copy.
  That is deliberate: the alternative is a script that can be pointed at the
  live paper by accident from a checkout that is mid-edit.

  ASCII only: Windows PowerShell 5.1 reads a BOM-less UTF-8 file as ANSI.

  Usage:
    powershell -ExecutionPolicy Bypass -File ops\promote.ps1
    powershell -ExecutionPolicy Bypass -File ops\promote.ps1 -WhatIf
#>
[CmdletBinding(SupportsShouldProcess = $true)]
param()

$ErrorActionPreference = "Stop"
$ops = $PSScriptRoot
$app = Split-Path -Parent $ops
. (Join-Path $ops "lib-port.ps1")

function Say($msg) { Write-Host "  $msg" }
function Die($msg) { Write-Host ""; Write-Host "  STOP. $msg" -ForegroundColor Yellow; Write-Host ""; exit 1 }

Set-Location $app
Write-Host ""
Write-Host "  Promoting $app (port $port)"
Write-Host "  ------------------------------------------------------------"

# --- 1. nothing uncommitted -------------------------------------------------
$dirty = (& git status --porcelain) | Where-Object { $_ -notmatch '^\?\?' }
if ($dirty) {
  Say "uncommitted changes here:"
  $dirty | ForEach-Object { Say "    $_" }
  Die "Commit or stash them first. A build would bury them."
}

# --- 2. backup --------------------------------------------------------------
$dbUrl = (Get-Content (Join-Path $app ".env") | Where-Object { $_ -match '^\s*DATABASE_URL\s*=' } | Select-Object -First 1)
if (-not $dbUrl) { Die "No DATABASE_URL in .env, so there is nothing to back up and no paper to promote." }
$dbName = ($dbUrl -split '/')[-1].Trim()
$backupDir = Join-Path (Split-Path -Parent $app) "townreporter-backups"
New-Item -ItemType Directory -Force -Path $backupDir | Out-Null
$backup = Join-Path $backupDir ("{0}_{1}.sql" -f $dbName, (Get-Date -Format "yyyy-MM-dd_HHmm"))

if ($PSCmdlet.ShouldProcess($dbName, "back up to $backup")) {
  & "$env:USERPROFILE\scoop\apps\postgresql\current\bin\pg_dump.exe" -p 5433 -U postgres -d $dbName -f $backup
  if (-not (Test-Path $backup)) { Die "pg_dump wrote nothing. Not promoting without a backup." }
  $bytes = (Get-Item $backup).Length
  # A dump of a real newsroom is megabytes. Anything tiny means it dumped an
  # empty or wrong database, and continuing would promote over live data with
  # no way back.
  if ($bytes -lt 100000) { Die "The backup is only $bytes bytes, which is too small to be this database. Not promoting." }
  Say "backup: $backup ($([math]::Round($bytes/1MB,1)) MB)"
}

# --- 2b. can we even fast-forward? -----------------------------------------
<#
  Ask BEFORE stopping anything.

  The first real run took the paper down, then discovered the merge could not
  proceed because an untracked file sat where an incoming one belonged. The
  paper stayed down while that was sorted out. Everything that can fail without
  consequence must fail before the first destructive step, not after it.
#>
& git fetch origin --quiet
$head = (& git rev-parse HEAD).Trim()
$target = (& git rev-parse origin/main).Trim()
if ($head -ne $target) {
  $ahead = (& git rev-list --count origin/main..HEAD).Trim()
  if ($ahead -ne '0') { Die "This checkout has $ahead commit(s) origin/main does not. Push or reset them first." }
  <#
    Ask git whether a fast-forward is POSSIBLE, without performing one.

    The first version of this check ran `git merge --ff-only --no-commit
    --no-ff`, which is self-contradictory -- and git resolved it by doing a
    real merge and stopping before the commit. A check that changes the thing
    it is checking is not a check. It left the live checkout mid-merge with
    everything staged, on a run whose whole purpose was to find problems
    BEFORE touching anything.

    `merge-base --is-ancestor` answers the same question and reads nothing but
    the commit graph.
  #>
  & git merge-base --is-ancestor HEAD origin/main
  if ($LASTEXITCODE -ne 0) {
    Die "origin/main is not ahead of this checkout in a straight line. A fast-forward is not possible."
  }
  # A file is a collision when it is arriving from origin/main, already exists
  # on disk, and git is not tracking it -- git refuses to overwrite those.
  $incoming = @(& git diff --name-only HEAD origin/main)
  $tracked = @(& git ls-files)
  $collisions = @()
  foreach ($f in $incoming) {
    if (-not (Test-Path $f)) { continue }
    if ($tracked -contains $f) { continue }
    $collisions += $f
  }
  if ($collisions.Count -gt 0) {
    Say 'these untracked files sit where incoming ones belong:'
    $collisions | ForEach-Object { Say "    $_" }
    Die 'Move or delete them first. Stopping now would take the paper down for a merge that cannot run.'
  }
}

# --- 3. what is on the paper now -------------------------------------------
$before = & "$env:USERPROFILE\scoop\apps\postgresql\current\bin\psql.exe" -p 5433 -U postgres -d $dbName -tAc "select count(*) from articles where status='published'"
$before = "$before".Trim()
Say "published stories now: $before"

# --- 4. stop this install ---------------------------------------------------
<#
  Stop the app here, not through stop-townreporter.ps1.

  That script is part of what is being upgraded, so on the run that matters it
  is whatever version the OLD checkout had. On the first real promotion the old
  one stopped the shared Postgres cluster as well -- serving the live paper, the
  development copy and every test database -- and recovery from an unclean stop
  took 226 seconds of fsync while the site returned 500.

  A promotion must not depend on a fix arriving in the same promotion. This
  stops exactly one process: whatever holds this install's port.
#>
if ($PSCmdlet.ShouldProcess("the app on port $port", "stop")) {
  <#
    Hold the watchdog off BEFORE the first destructive step. During the
    v0.5.4 promotion the five-minute watchdog saw the deliberately-stopped
    app, "repaired" it 45 seconds before the build finished writing, and the
    paper served a half-written build -- old pages naming script files that
    no longer existed. watchdog.ps1 stands down while this marker is under
    30 minutes old; the age cap keeps a promote that dies here from
    silencing the watchdog forever.
  #>
  New-Item -ItemType Directory -Force -Path (Join-Path $app "logs") | Out-Null
  $promoteMarker = Join-Path $app "logs\promote-in-progress"
  Set-Content -Path $promoteMarker -Value (Get-Date -Format o) -Encoding ASCII

  $owners = @(Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue |
              Select-Object -ExpandProperty OwningProcess -Unique)
  foreach ($owner in $owners) {
    $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$owner" -ErrorAction SilentlyContinue
    if (-not $proc) { continue }
    if ($proc.Name -ne 'node.exe' -or $proc.CommandLine -notlike '*.output/server/index.mjs*') {
      Die "Port $port is held by PID $owner ($($proc.Name)), which is not this app. Not touching it."
    }
    Say "stopping the app, PID $owner"
    Stop-Process -Id $owner -Force -ErrorAction SilentlyContinue
  }
  Start-Sleep -Seconds 2
  # Postgres is deliberately left running: one cluster serves the live paper,
  # the development copy and every scratch database on this machine.
}

# --- 5. fetch and fast-forward ---------------------------------------------
$lockBefore = if (Test-Path "package-lock.json") { (Get-FileHash "package-lock.json").Hash } else { "" }
if ($PSCmdlet.ShouldProcess("origin/main", "fast-forward")) {
  & git fetch origin --quiet
  $head = (& git rev-parse HEAD).Trim()
  $target = (& git rev-parse origin/main).Trim()
  if ($head -eq $target) {
    Say "already at origin/main ($($head.Substring(0,7)))"
  } else {
    & git merge --ff-only origin/main
    if ($LASTEXITCODE -ne 0) { Die "Could not fast-forward. This checkout has diverged from origin/main." }
    Say "moved $($head.Substring(0,7)) -> $($target.Substring(0,7))"
  }
}

# --- 6. dependencies, only if the lockfile moved ---------------------------
$lockAfter = if (Test-Path "package-lock.json") { (Get-FileHash "package-lock.json").Hash } else { "" }
if ($lockBefore -ne $lockAfter) {
  Say "the lockfile changed; installing dependencies"
  if ($PSCmdlet.ShouldProcess("dependencies", "npm ci")) { & npm ci }
} else {
  Say "lockfile unchanged; skipping install"
}

# --- 7. build (the server is DOWN here, on purpose) ------------------------
if ($PSCmdlet.ShouldProcess("the app", "build")) {
  Say "building"
  & npm run build
  if ($LASTEXITCODE -ne 0) { Die "The build failed. The paper is still down. Backup: $backup" }
}

# --- 8. start ---------------------------------------------------------------
if ($PSCmdlet.ShouldProcess("the app", "start")) {
  & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $ops "start-townreporter.ps1")
  for ($i = 0; $i -lt 60 -and -not (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue); $i++) {
    Start-Sleep -Seconds 1
  }
}

# --- 9. verify --------------------------------------------------------------
Write-Host ""
Say "checking"
$fail = @()

try {
  $local = (Invoke-WebRequest "http://127.0.0.1:$port/" -UseBasicParsing -TimeoutSec 30).StatusCode
  if ($local -eq 200) { Say "[ OK ] the paper answers on $port" } else { $fail += "local answered $local" }
} catch { $fail += "local did not answer: $($_.Exception.Message)" }

<#
  A 200 from the front page is server-side HTML and proves nothing about the
  client: during the watchdog-race incident the paper answered 200 while
  every script asset 500d and every click was dead. So fetch a script the
  page itself names -- if the served HTML and the on-disk build disagree,
  this is the line that catches it.
#>
try {
  $html = (Invoke-WebRequest "http://127.0.0.1:$port/" -UseBasicParsing -TimeoutSec 30).Content
  $m = [regex]::Match($html, '/assets/[A-Za-z0-9_.-]+\.js')
  if (-not $m.Success) {
    $fail += "the served page names no script asset at all"
  } else {
    $assetCode = (Invoke-WebRequest "http://127.0.0.1:$port$($m.Value)" -UseBasicParsing -TimeoutSec 30).StatusCode
    if ($assetCode -eq 200) { Say "[ OK ] the page's own script asset serves ($($m.Value))" }
    else { $fail += "script asset $($m.Value) answered $assetCode -- served HTML and built assets disagree" }
  }
} catch { $fail += "script asset check failed: $($_.Exception.Message)" }

$site = $env:PUBLIC_SITE_URL
if (-not $site) { $site = "https://townreporter.org" }
try {
  $pub = (Invoke-WebRequest $site -UseBasicParsing -TimeoutSec 40).StatusCode
  if ($pub -eq 200) { Say "[ OK ] $site answers" } else { $fail += "$site answered $pub" }
} catch { $fail += "$site did not answer: $($_.Exception.Message)" }

$after = & "$env:USERPROFILE\scoop\apps\postgresql\current\bin\psql.exe" -p 5433 -U postgres -d $dbName -tAc "select count(*) from articles where status='published'"
$after = "$after".Trim()
if ($after -eq $before) { Say "[ OK ] still $after published stories" }
else { $fail += "published stories went from $before to $after" }

Write-Host ""
<#
  The marker comes off on BOTH paths. On success the promote is over; on
  failure the watchdog is the only automatic thing that can still help, so
  muzzling it for the rest of the 30-minute cap would make a bad promote
  worse. The operator message stays the authority either way.
#>
Remove-Item (Join-Path $app "logs\promote-in-progress") -Force -ErrorAction SilentlyContinue
if ($fail.Count -gt 0) {
  $fail | ForEach-Object { Write-Host "  [FAIL] $_" -ForegroundColor Yellow }
  Die "Promotion finished but the paper is not healthy. The backup is at $backup"
}
Write-Host "  Promoted. The paper is up and the archive is intact." -ForegroundColor Green
Write-Host "  Backup kept at $backup"
Write-Host ""
