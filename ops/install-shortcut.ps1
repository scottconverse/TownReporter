<#
  Put the TownReporter Control icon on the Desktop.

  SELF-HOSTING.md promised "a TownReporter Control shortcut on the Desktop" and
  nothing in the repository created one, which is the same class of problem an
  audit filed against the scheduled tasks (TW-004): a document describing a
  setup nobody can reproduce.

  The shortcut runs the menu through `cmd /k`, not by pointing at the .cmd
  directly. That matters. Launched by association the console closes the moment
  the batch file ends, and the operator reported exactly that -- the answer
  appeared and the window vanished before it could be read. With /k the window
  belongs to cmd, so nothing the batch does can close it, and the menu's own
  "0" uses `exit` to end the console deliberately.

  Safe to run repeatedly; it overwrites its own shortcut and touches nothing
  else on the Desktop.

  Usage:
    powershell -ExecutionPolicy Bypass -File ops\install-shortcut.ps1
#>
[CmdletBinding(SupportsShouldProcess = $true)]
param([string]$Name = "TownReporter Control")

$ErrorActionPreference = "Stop"

$ops = $PSScriptRoot
$menu = Join-Path $ops "$Name.cmd"
if (-not (Test-Path $menu)) { throw "Missing the menu itself: $menu" }

$desktop = [Environment]::GetFolderPath("Desktop")
$lnk = Join-Path $desktop "$Name.lnk"

if (-not $PSCmdlet.ShouldProcess($lnk, "create desktop shortcut")) { return }

$shell = New-Object -ComObject WScript.Shell
$s = $shell.CreateShortcut($lnk)
$s.TargetPath       = Join-Path $env:WINDIR "System32\cmd.exe"
$s.Arguments        = '/k "{0}"' -f $menu
$s.WorkingDirectory = $ops
$s.Description      = "TownReporter: check it, restart it, start it after a reboot"
$s.Save()

Write-Host ""
Write-Host "  Created: $lnk"
Write-Host "  Runs   : cmd /k `"$menu`""
Write-Host "  The window stays open until you close it, or choose 0."
Write-Host ""
