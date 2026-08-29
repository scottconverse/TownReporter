<#
  Moves the current logs aside and starts fresh ones.

  Each file keeps exactly one previous generation. Two generations is what an
  operator actually reads back through; more just fills the disk that Postgres
  needs.

  Some logs cannot be rotated while the paper is running, and that is not a
  failure. `app.out.log`, `app.err.log` and the cloudflared logs are the
  redirected stdout of live processes: Windows gives the writer an exclusive
  handle, so nothing else can truncate or rename them until that process stops.
  The first version tried anyway and reported two red errors on an otherwise
  healthy machine, which is worse than not offering to rotate them at all.

  Those files roll over on their own when their process restarts.
#>
$ErrorActionPreference = "Stop"
$app = Split-Path -Parent $PSScriptRoot
$logDir = Join-Path $app "logs"
if (-not (Test-Path $logDir)) { "no logs directory yet"; return }

$rotated = @()
$held = @()
$empty = 0

foreach ($f in Get-ChildItem $logDir -Filter *.log) {
  if ($f.Name -like "*.prev.log") { continue }
  if ($f.Length -eq 0) { $empty += 1; continue }
  $prev = Join-Path $logDir ($f.BaseName + ".prev.log")
  try {
    Copy-Item $f.FullName $prev -Force
    Set-Content -Path $f.FullName -Value "" -NoNewline -ErrorAction Stop
    $rotated += $f.Name
  } catch {
    # Held open by the process that writes it. Expected, not an error.
    $held += $f.Name
  }
}

if ($rotated.Count) { "rotated: $($rotated -join ', ')" }
if ($held.Count) {
  "still open, so left alone (these roll over when their process restarts): $($held -join ', ')"
}
if ($empty) { "$empty already empty" }
if (-not $rotated.Count -and -not $held.Count -and -not $empty) { "nothing to rotate" }
