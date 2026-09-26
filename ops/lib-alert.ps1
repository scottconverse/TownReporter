<#
  Telling the owner when something is wrong, once when it starts and once when
  it clears -- and never every five minutes.

  The watchlist item, in his words: alert when something is down for more than
  10 minutes, or when the daily scan fails. The reason this is a file and not a
  dozen lines in watchdog.ps1 is that three different callers have conditions to
  report (the watchdog's probes, the backup run, the scan read) and the "once"
  rule is the hard part. A watchdog that runs every five minutes and alerts on
  every run is a machine that cries wolf, and a machine that cries wolf is worse
  than one that says nothing: the owner stops reading it, and then the one real
  alert is just more noise.

  How the "once" rule is kept. Two dictionaries in logs\alerts.json:

    watching   a condition observed bad but not yet fired. Holds when it was
               first seen bad. This is what turns "down for more than 10
               minutes" into a rule: the first 5-minute run only starts the
               clock, and only a run at least GraceSeconds later fires.
    firing     a condition that HAS been alerted. It is notified once, on the
               transition into this dictionary, and once more on the way out.
               While it sits here, further observations update the detail and
               say nothing.

  A condition whose input is $null is not evaluated at all -- it is left exactly
  as it was, in watching or in firing. That is deliberate: ops\backup.ps1 only
  knows about backups, and it must not be able to clear a "the paper is down"
  alert that the watchdog raised and that the watchdog has not yet seen recover.

  Channels, in order:

    1. logs\alerts.json and the Control page's Attention card. Always. This is
       the channel that cannot fail: it is a file write.
    2. A Windows toast, in-process. Only reaches the desktop if this runs in
       the logged-in session, which the watchdog does (run-hidden.vbs) and a
       scheduled action under a different account would not. Wrapped: a toast
       that will not display is not a reason to lose the alert.
    3. ntfy phone push, and ONLY when ALERT_NTFY_TOPIC is set in the app's .env.
       Off by default: with the key absent, nothing in this file opens a socket
       to anywhere. The owner turns it on by installing the ntfy app and putting
       his own topic in .env; SELF-HOSTING.md says how.

  Times are ISO 8601 UTC in the state file. This process does not know the
  reader's clock, and the page renders local 12-hour times itself.

  ASCII only: Windows PowerShell 5.1 reads a BOM-less UTF-8 file as ANSI.

  Dot-source it:
    . (Join-Path $PSScriptRoot "lib-alert.ps1")
#>

. (Join-Path $PSScriptRoot "lib-env.ps1")

<#
  The one time format the ops code writes: ISO 8601 UTC. Defined here behind a
  guard rather than dot-sourced from lib-backup.ps1, because the alerts have no
  business loading the dump code -- an alert must be evaluable on a machine
  whose pg_dump is missing, which is one of the things it exists to report. The
  guard means whichever library loads first defines it and they cannot drift.
#>
if (-not (Get-Command Get-TownReporterIsoTime -ErrorAction SilentlyContinue)) {
  function Get-TownReporterIsoTime {
    param([datetime]$Time = (Get-Date))
    return $Time.ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ss.fffZ', [Globalization.CultureInfo]::InvariantCulture)
  }
}

<#
  The conditions, and the sentence each one says. Fixed ids: the Control page
  and the state file key on them, so an id is a small public contract, not a
  label. The message is what the owner reads, so it says what is wrong in the
  words he would use, and the detail (filled in by the caller) says which one.
#>
$script:TownReporterAlertConditions = [ordered]@{
  'paper-down' = @{
    Title   = 'TownReporter'
    Message = 'The paper is not answering on this machine'
    Grace   = 600
  }
  'site-down' = @{
    Title   = 'TownReporter'
    Message = 'The public site is not answering'
    Grace   = 600
  }
  'scan-missing' = @{
    Title   = 'TownReporter'
    Message = 'The daily scan has not run, or did not finish'
    Grace   = 0
  }
  'backup-stale' = @{
    Title   = 'TownReporter backups'
    Message = 'No backup has been taken in over a day'
    Grace   = 0
  }
  'offsite-failing' = @{
    Title   = 'TownReporter backups'
    Message = 'The copy of the backups to drive D: is failing'
    Grace   = 0
  }
  'offsite-low-space' = @{
    Title   = 'TownReporter backups'
    Message = 'Drive D: is running out of room for backups'
    Grace   = 0
  }
}

function Get-TownReporterAlertIds {
  return @($script:TownReporterAlertConditions.Keys)
}

function Get-TownReporterAlertConditionSpec {
  param([Parameter(Mandatory = $true)][string]$Id)
  if ($script:TownReporterAlertConditions.Contains($Id)) { return $script:TownReporterAlertConditions[$Id] }
  return @{ Title = 'TownReporter'; Message = $Id; Grace = 0 }
}

# --- The state file the Control page reads --------------------------------
function Get-TownReporterAlertStatePath {
  param([string]$App = (Split-Path -Parent $PSScriptRoot))
  return (Join-Path $App 'logs\alerts.json')
}

<#
  Two ordered hashtables, always present even when empty, so the page can read
  `firing` without checking whether it exists. An unreadable or corrupt file
  yields an empty state and a plain-words `problem` -- never an exception, and
  never a state that looks like "everything is fine but there are no alerts".
#>
function Get-TownReporterAlertState {
  param(
    [string]$StateFile,
    [string]$App = (Split-Path -Parent $PSScriptRoot)
  )
  if (-not $StateFile) { $StateFile = Get-TownReporterAlertStatePath -App $App }
  $state = [ordered]@{
    updatedAt = $null
    problem   = $null
    watching  = [ordered]@{}
    firing    = [ordered]@{}
  }
  if (-not (Test-Path -LiteralPath $StateFile)) { return $state }
  try {
    $raw = Get-Content -LiteralPath $StateFile -Raw -ErrorAction Stop
    if (-not $raw) { return $state }
    $read = $raw | ConvertFrom-Json -ErrorAction Stop
    if ($read.PSObject.Properties.Name -contains 'updatedAt') { $state['updatedAt'] = $read.updatedAt }
    foreach ($bucket in @('watching', 'firing')) {
      if ($read.PSObject.Properties.Name -contains $bucket -and $read.$bucket) {
        foreach ($prop in $read.$bucket.PSObject.Properties) {
          $entry = [ordered]@{}
          foreach ($f in $prop.Value.PSObject.Properties) { $entry[$f.Name] = $f.Value }
          $state[$bucket][$prop.Name] = $entry
        }
      }
    }
  } catch {
    $state['problem'] = "the alert state file could not be read ($($_.Exception.Message))"
  }
  return $state
}

function Save-TownReporterAlertState {
  param(
    [string]$StateFile,
    [Parameter(Mandatory = $true)]$State,
    [string]$App = (Split-Path -Parent $PSScriptRoot)
  )
  if (-not $StateFile) { $StateFile = Get-TownReporterAlertStatePath -App $App }
  $dir = Split-Path -Parent $StateFile
  if ($dir -and -not (Test-Path -LiteralPath $dir)) {
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
  }
  $State['updatedAt'] = Get-TownReporterIsoTime
  $json = $State | ConvertTo-Json -Depth 6
  $temp = "$StateFile.tmp"
  [IO.File]::WriteAllText($temp, $json, (New-Object Text.UTF8Encoding $false))
  Move-Item -LiteralPath $temp -Destination $StateFile -Force
  return $State
}

# --- The rule, with no clock of its own -----------------------------------
<#
  The whole of the "once" logic, as a pure function: give it the state, what was
  observed, and the time, and it returns the new state plus the two lists of
  transitions. No file, no clock, no notification -- which is what makes
  scripts\ci-backup.ps1 able to prove the 10-minute rule and the fire-once rule
  on a fake clock in a second.

  Conditions come in as a list of hashtables:

    @{ Id = 'paper-down'; Active = $true;  Detail = 'nothing answered on port 3000' }
    @{ Id = 'site-down';  Active = $false }
    @{ Id = 'scan-missing'; Active = $null }        # not evaluated: leave it alone

  Active = $null is the "say nothing, change nothing" case, and it is the one
  that keeps a backup-only run from clearing an alert it knows nothing about.

  One level of nesting is flattened, and that is not decoration either. The
  library function that builds the backup conditions hands back an array, and a
  caller that wraps that call in @() gives PowerShell ONE item which is itself
  an array of conditions -- @() does not flatten a nested array. Measured on
  2026-09-25 with two conditions wrapped that way: $c.Id became the array
  @('scan-missing','offsite-failing'), [string] joined it into the single id
  "scan-missing offsite-failing", and logs\alerts.json was written with that as
  its one key. The Control page would have shown one nonsense row and the two
  real alerts would never have fired. So a list of conditions is read as a list
  of conditions however the caller built it, rather than misread as one.
#>
function Test-TownReporterAlertTransition {
  param(
    [Parameter(Mandatory = $true)]$State,
    [Parameter(Mandatory = $true)][AllowEmptyCollection()][array]$Conditions,
    [datetime]$Now = (Get-Date)
  )
  $started = New-Object System.Collections.ArrayList
  $cleared = New-Object System.Collections.ArrayList
  $nowIso = Get-TownReporterIsoTime -Time $Now

  $flat = New-Object System.Collections.ArrayList
  foreach ($c in $Conditions) {
    if ($c -is [array]) { foreach ($inner in $c) { [void]$flat.Add($inner) } }
    else { [void]$flat.Add($c) }
  }

  foreach ($c in $flat) {
    if (-not $c -or -not $c.Id) { continue }
    $id = [string]$c.Id
    $spec = Get-TownReporterAlertConditionSpec -Id $id
    $active = $c.Active

    # Not evaluated this run: touch nothing.
    if ($null -eq $active) { continue }

    if (-not $active) {
      if ($State['watching'].Contains($id)) { $State['watching'].Remove($id) }
      if ($State['firing'].Contains($id)) {
        $was = $State['firing'][$id]
        $State['firing'].Remove($id)
        [void]$cleared.Add([pscustomobject]@{
          Id      = $id
          Title   = $spec.Title
          Message = $spec.Message
          Detail  = "cleared now; it had been wrong since $($was.since)"
          Since   = $was.since
        })
      }
      continue
    }

    # Observed bad. Start the clock the first time it is seen.
    if (-not $State['watching'].Contains($id)) {
      $State['watching'][$id] = [ordered]@{ since = $nowIso; detail = [string]$c.Detail }
    } else {
      $State['watching'][$id]['detail'] = [string]$c.Detail
    }

    if ($State['firing'].Contains($id)) {
      # Already alerted. Keep the note current; say nothing more.
      $State['firing'][$id]['detail'] = [string]$c.Detail
      continue
    }

    $since = $null
    try { $since = [datetime]::Parse($State['watching'][$id]['since'], [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::AdjustToUniversal -bor [Globalization.DateTimeStyles]::AssumeUniversal) } catch { $since = $null }
    if ($null -eq $since) { $since = $Now }
    $ageSeconds = [int]($Now.ToUniversalTime() - $since.ToUniversalTime()).TotalSeconds
    if ($ageSeconds -lt [int]$spec.Grace) { continue }

    $State['firing'][$id] = [ordered]@{
      since      = if ($State['watching'][$id]['since']) { $State['watching'][$id]['since'] } else { $nowIso }
      firedAt    = $nowIso
      message    = $spec.Message
      detail     = [string]$c.Detail
    }
    [void]$started.Add([pscustomobject]@{
      Id      = $id
      Title   = $spec.Title
      Message = $spec.Message
      Detail  = [string]$c.Detail
      Since   = $State['firing'][$id]['since']
    })
  }

  return @{ State = $State; Started = @($started); Cleared = @($cleared) }
}

# --- The channels ----------------------------------------------------------
<#
  A desktop toast, from Windows PowerShell 5.1 through WinRT. Positional
  New-Object rather than -ArgumentList, which is the form that works in 5.1 for
  a WinRT type, and the whole thing is wrapped: this runs in a 5-minute task and
  a toast that cannot be shown must not stop the state file from being written.

  NonInteractive PowerShell in the logged-in session can still show a toast --
  that is exactly why the watchdog is launched by run-hidden.vbs instead of
  running as a service.
#>
function Send-TownReporterAlertToast {
  param(
    [string]$Title = 'TownReporter',
    [Parameter(Mandatory = $true)][string]$Message
  )
  try {
    [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
    [Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null
    $template = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02)
    $texts = $template.GetElementsByTagName('text')
    [void]$texts.Item(0).AppendChild($template.CreateTextNode($Title))
    [void]$texts.Item(1).AppendChild($template.CreateTextNode($Message))
    $toast = New-Object Windows.UI.Notifications.ToastNotification $template
    [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('TownReporter').Show($toast)
    return $true
  } catch {
    return $false
  }
}

<#
  Phone push through ntfy. Reached ONLY when ALERT_NTFY_TOPIC is set in .env:
  with no topic this function returns without opening a socket, so a default
  install sends nothing anywhere. The URL is built from the topic alone, which
  is why the topic is validated first -- a value with a slash or a space in it
  would silently turn into a different URL.
#>
function Send-TownReporterAlertPush {
  param(
    [string]$Topic,
    [string]$Title = 'TownReporter',
    [Parameter(Mandatory = $true)][string]$Message,
    [int]$TimeoutSec = 15
  )
  if (-not $Topic) { return $false }
  if ($Topic -notmatch '^[A-Za-z0-9_-]{1,64}$') { return $false }
  try {
    $headers = @{ Title = $Title; Priority = 'high'; Tags = 'warning' }
    Invoke-RestMethod -Uri "https://ntfy.sh/$Topic" -Method Post -Body $Message -Headers $headers -TimeoutSec $TimeoutSec -UseBasicParsing -ErrorAction Stop | Out-Null
    return $true
  } catch {
    return $false
  }
}

# --- The one entry point ---------------------------------------------------
<#
  Evaluate the conditions, notify whatever changed, write the state.

  -Notify is a seam for the test harness: a script block called with
  (Event, Alert) for every fire and every clear, so a test can count them
  without a desktop or a network. Left alone, the two real channels run.

  Returns the state it wrote, plus the transitions, so a caller that is already
  logging can say what changed in its own log.
#>
function Invoke-TownReporterAlertCheck {
  param(
    [string]$App = (Split-Path -Parent $PSScriptRoot),
    [string]$StateFile,
    [string]$EnvFile,
    [Parameter(Mandatory = $true)][AllowEmptyCollection()][array]$Conditions,
    [datetime]$Now = (Get-Date),
    [scriptblock]$Notify
  )
  if (-not $StateFile) { $StateFile = Get-TownReporterAlertStatePath -App $App }
  if (-not $EnvFile) { $EnvFile = Join-Path $App ".env" }

  $state = Get-TownReporterAlertState -StateFile $StateFile
  $result = Test-TownReporterAlertTransition -State $state -Conditions $Conditions -Now $Now

  # Read once, and only if there is something to send: reading .env on a quiet
  # run is harmless, but a topic that is not set must mean this file never
  # reaches for the network at all.
  $topic = $null
  if ($result.Started.Count -gt 0 -or $result.Cleared.Count -gt 0) {
    $topic = Read-OpsEnvValue -EnvFile $EnvFile -Name 'ALERT_NTFY_TOPIC'
  }

  $events = New-Object System.Collections.ArrayList
  foreach ($alert in $result.Started) {
    [void]$events.Add([pscustomobject]@{ Event = 'started'; Alert = $alert })
  }
  foreach ($alert in $result.Cleared) {
    [void]$events.Add([pscustomobject]@{ Event = 'cleared'; Alert = $alert })
  }

  foreach ($e in $events) {
    $headline = if ($e.Event -eq 'started') { $e.Alert.Message } else { "$($e.Alert.Message) -- this has cleared" }
    if ($Notify) {
      & $Notify $e.Event $e.Alert
    } else {
      [void](Send-TownReporterAlertToast -Title $e.Alert.Title -Message $headline)
      [void](Send-TownReporterAlertPush -Topic $topic -Title $e.Alert.Title -Message $headline)
    }
  }

  Save-TownReporterAlertState -StateFile $StateFile -State $result.State | Out-Null
  return @{ State = $result.State; Started = @($result.Started); Cleared = @($result.Cleared); Events = @($events); Topic = $topic }
}

# --- The daily scan, read-only ---------------------------------------------
<#
  One SELECT, one row, through psql. Read-only, like ops\control\last-scan.cjs,
  and for the same reason: describing the machine must not change it.

  psql rather than shelling out to last-scan.cjs because the reason this alert
  exists is that the scan did not happen, and the scan needs node. An alert that
  only works when the thing that is broken is working is not an alert.

  All the timezone work is in SQL. Windows PowerShell 5.1 cannot resolve IANA
  names -- [TimeZoneInfo]::FindSystemTimeZoneById('America/Denver') throws on a
  Windows box -- so "has today's scan happened yet, in the paper's own zone" is
  a question only Postgres can answer here.

  Columns, in order: zone | local_day | local_clock | scheduled | local_time |
  last_id | last_local_day | last_status | last_error
#>
function Get-TownReporterScanState {
  param(
    [string]$EnvFile,
    [string]$App = (Split-Path -Parent $PSScriptRoot),
    [string]$Psql,
    [int]$PgPort = 5433,
    [string]$Database
  )
  if (-not $EnvFile) { $EnvFile = Join-Path $App ".env" }
  if (-not $Database) {
    $dbUrl = Read-OpsEnvValue -EnvFile $EnvFile -Name 'DATABASE_URL'
    if ($dbUrl) { $Database = ($dbUrl -split '/')[-1].Trim() }
  }
  if (-not $Database) {
    return @{ Ok = $false; Reason = 'there is no DATABASE_URL in .env, so the daily scan could not be read' }
  }
  if (-not $Psql) { $Psql = Join-Path "$env:USERPROFILE\scoop\apps\postgresql\current\bin" 'psql.exe' }
  if (-not (Test-Path -LiteralPath $Psql)) {
    return @{ Ok = $false; Reason = "there is no psql at $Psql, so the daily scan could not be read" }
  }

  $sql = @'
with tz as (
  select coalesce(nullif(max(timezone), ''), 'UTC') as zone from paper_settings
),
sched as (
  select coalesce(bool_or(enabled and not paused), false) as scheduled,
         min(local_time) as local_time
    from daily_scan_policies
),
last_scan as (
  select id, started_at, finished_at, error from scan_runs order by id desc limit 1
)
select (select zone from tz) || '|' ||
       to_char(now() at time zone (select zone from tz), 'YYYY-MM-DD') || '|' ||
       to_char(now() at time zone (select zone from tz), 'HH24:MI') || '|' ||
       case when (select scheduled from sched) then '1' else '0' end || '|' ||
       coalesce((select local_time from sched), '06:00') || '|' ||
       coalesce((select id::text from last_scan), '') || '|' ||
       coalesce(to_char((select started_at from last_scan) at time zone (select zone from tz), 'YYYY-MM-DD'), '') || '|' ||
       case
         when (select id from last_scan) is null then 'none'
         when (select error from last_scan) is not null then 'failed'
         when (select finished_at from last_scan) is null then 'running'
         else 'finished'
       end || '|' ||
       coalesce(replace((select left(error, 200) from last_scan), '|', '/'), '')
'@
  try {
    $line = & $Psql -p $PgPort -U postgres -d $Database -tAc $sql 2>$null
    if ($LASTEXITCODE -ne 0) {
      return @{ Ok = $false; Reason = 'the database did not answer, so the daily scan could not be read' }
    }
    $text = ([string]$line).Trim()
    if (-not $text) {
      return @{ Ok = $false; Reason = 'the database returned nothing about the daily scan' }
    }
    $parts = $text -split '\|', 9
    if ($parts.Count -lt 9) {
      return @{ Ok = $false; Reason = 'the daily scan row could not be understood' }
    }
    return @{
      Ok         = $true
      Reason     = 'read'
      Zone       = $parts[0].Trim()
      LocalDay   = $parts[1].Trim()
      LocalClock = $parts[2].Trim()
      Scheduled  = ($parts[3].Trim() -eq '1')
      LocalTime  = $parts[4].Trim()
      LastId     = $parts[5].Trim()
      LastDay    = $parts[6].Trim()
      LastStatus = $parts[7].Trim()
      LastError  = $parts[8].Trim()
    }
  } catch {
    return @{ Ok = $false; Reason = "the daily scan could not be read ($($_.Exception.Message))" }
  }
}

<#
  Did today's scan happen? Pure, so the rule can be tested on a fake clock and
  a fake scan rather than by waiting until 8 AM.

  When the answer is due: the later of 08:00 local and thirty minutes after the
  paper's own configured scan time. The scan is configured for, say, 06:00 and
  takes a while; asking at 06:31 whether it happened would alert on a scan that
  is simply still running. The 08:00 floor is the watchlist item's own wording
  ("did not run by 8:00 AM") and covers a scan that takes hours.

  Before that time the answer is "nothing to say" -- not "fine". The caller
  leaves the condition unevaluated, so a scan alert already firing stays firing
  until the evidence says otherwise.
#>
function Test-TownReporterScanAlert {
  param(
    [Parameter(Mandatory = $true)]$State,
    [datetime]$Now = (Get-Date),
    [int]$DeadlineHour = 8
  )
  if (-not $State.Ok) {
    return @{ Active = $null; Detail = $State.Reason; Due = $false }
  }
  if (-not $State.Scheduled) {
    return @{ Active = $false; Detail = 'the daily scan is not switched on'; Due = $false }
  }

  $deadline = $Now.Date.AddHours($DeadlineHour)
  $configured = $null
  if ($State.LocalTime -match '^(\d{1,2}):(\d{2})$') {
    $configured = $Now.Date.AddHours([int]$Matches[1]).AddMinutes([int]$Matches[2]).AddMinutes(30)
    if ($configured -gt $deadline) { $deadline = $configured }
  }
  if ($Now -lt $deadline) {
    return @{ Active = $null; Detail = "today's scan is not due until $(Get-Date -Date $deadline -Format 'HH:mm')"; Due = $false }
  }

  $when = "the scan is set for $($State.LocalTime) and it is now $($State.LocalClock)"
  switch ($State.LastStatus) {
    'none' {
      return @{ Active = $true; Detail = "no scan has ever run, and $when"; Due = $true }
    }
    'failed' {
      $why = if ($State.LastError) { " (it said: $($State.LastError))" } else { '' }
      return @{ Active = $true; Detail = "the last scan failed$why, and $when"; Due = $true }
    }
    'running' {
      if ($State.LastDay -and $State.LastDay -lt $State.LocalDay) {
        return @{ Active = $true; Detail = "a scan started on $($State.LastDay) is still marked as running, and $when"; Due = $true }
      }
      return @{ Active = $false; Detail = "today's scan is running now, and $when"; Due = $true }
    }
    default {
      if ($State.LastDay -and $State.LastDay -lt $State.LocalDay) {
        return @{ Active = $true; Detail = "the last scan finished on $($State.LastDay), so today's has not run, and $when"; Due = $true }
      }
      return @{ Active = $false; Detail = "today's scan finished, and $when"; Due = $true }
    }
  }
}
