<#
  Where the paper listens, read from .env rather than guessed.

  PORT is documented as configurable, and the ops scripts hard-coded 3000 while
  an architecture diagram said 8080 - three answers to one question, which an
  audit filed as TW-005. Change PORT in .env and the app moves; the watchdog
  and the restart scripts then looked at the wrong socket and "repaired" a
  server that was fine.

  A plain `Get-NetTCPConnection -LocalPort $p -State Listen` has no address
  filter, so it is satisfied by a listener on ANY family. On 2026-09-02 an
  unrelated dev server (vinext) held [::1]:3000 -- IPv6 only -- while
  TownReporter binds 127.0.0.1:3000 (IPv4). The unfiltered check saw a
  listener, concluded the paper was already up, and never started it; the
  site served 502 for ~25 minutes. Test-TownReporterPort and
  Get-TownReporterPortOwner below only count listeners on an address the app
  can actually bind to.

  Dot-source it:  . (Join-Path $PSScriptRoot "lib-port.ps1")
  Then use:       $port  (a string, so it drops straight into a URL)

  ASCII only: PS 5.1 reads a BOM-less UTF-8 file as ANSI.
#>
function Get-TownReporterPort {
  $app = Split-Path -Parent $PSScriptRoot
  $envFile = Join-Path $app ".env"
  if (Test-Path $envFile) {
    $line = Get-Content $envFile |
      Where-Object { $_ -match '^\s*PORT\s*=' } |
      Select-Object -First 1
    if ($line) {
      $value = ($line -replace '^\s*PORT\s*=\s*', '').Trim()
      if ($value -match '^\d+$') { return $value }
    }
  }
  return "3000"
}

# Read the same way PORT is read above, so HOST and PORT can never disagree
# about which .env line wins.
function Get-TownReporterHost {
  $app = Split-Path -Parent $PSScriptRoot
  $envFile = Join-Path $app ".env"
  if (Test-Path $envFile) {
    $line = Get-Content $envFile |
      Where-Object { $_ -match '^\s*HOST\s*=' } |
      Select-Object -First 1
    if ($line) {
      $value = ($line -replace '^\s*HOST\s*=\s*', '').Trim()
      if ($value) { return $value }
    }
  }
  return "127.0.0.1"
}

# The set of LocalAddress values a listener must match to be a socket this
# app could actually own: loopback, the all-interfaces wildcard, or whatever
# HOST names in .env. Anything else (an IPv6-only "::1" or "::" listener,
# for instance, when HOST is not IPv6) belongs to some other program.
function Get-TownReporterBindableAddresses {
  @("127.0.0.1", "0.0.0.0", (Get-TownReporterHost)) | Select-Object -Unique
}

# PID(s) of the listener(s) on $Port that sit on an address this app can
# bind to. Empty when the only listener(s) present are on a different
# address family (e.g. IPv6-only) -- those do not block this app's start.
function Get-TownReporterPortOwner {
  param([int]$Port = $port)
  $bindable = Get-TownReporterBindableAddresses
  @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
    Where-Object { $bindable -contains $_.LocalAddress } |
    Select-Object -ExpandProperty OwningProcess -Unique)
}

# True only when a LISTEN socket exists on $Port whose LocalAddress this app
# could actually bind to. An IPv6-only listener from another program on the
# same port number returns false here, on purpose.
function Test-TownReporterPort {
  param([int]$Port = $port)
  (Get-TownReporterPortOwner -Port $Port).Count -gt 0
}

$port = Get-TownReporterPort
