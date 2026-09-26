<#
  Put the TownReporter Control icon on the Desktop.

  SELF-HOSTING.md promised "a TownReporter Control shortcut on the Desktop" and
  nothing in the repository created one, which is the same class of problem an
  audit filed against the scheduled tasks (TW-004): a document describing a
  setup nobody can reproduce.

  WHAT THE ICON RUNS NOW

  It used to run the numbered menu through `cmd /k`, so that the console stayed
  open long enough to read the answer. The Control page (ops\control.ps1) has no
  console to keep open, so the shortcut runs the launcher through
  `wscript.exe ops\run-hidden.vbs`, the same hidden-launch path the watchdog
  uses -- wscript.exe has no console of its own and Run(command, 0, True) starts
  the child with the window never drawn, so double-clicking the icon puts no
  black window on the screen at all. That is the point of the substitution: the
  owner asked for mission control instead of a terminal screen.

  The menu has not gone anywhere. ops\TownReporter Control.cmd still works,
  still has every numbered item, and item 7 opens this page. If the Control page
  cannot start, the launcher says so and names the menu, and a shortcut pointed
  at the .cmd can be made again with -Fallback.

  Safe to run repeatedly; it overwrites its own shortcut and touches nothing
  else on the Desktop. It is NOT run automatically by anything, and making the
  icon is a deliberate act by whoever owns the machine.

  Usage:
    powershell -ExecutionPolicy Bypass -File ops\install-shortcut.ps1
    powershell -ExecutionPolicy Bypass -File ops\install-shortcut.ps1 -Fallback
#>
[CmdletBinding(SupportsShouldProcess = $true)]
param(
  [string]$Name = "TownReporter Control",
  # Point the icon back at the console menu instead. Kept as a real option
  # rather than a comment, because the Console is the fallback if the page ever
  # cannot start on some machine.
  [switch]$Fallback
)

$ErrorActionPreference = "Stop"

$ops = $PSScriptRoot
$menu = Join-Path $ops "$Name.cmd"
$launcher = Join-Path $ops "control.ps1"
$hidden = Join-Path $ops "run-hidden.vbs"

if ($Fallback) {
  if (-not (Test-Path $menu)) { throw "Missing the menu: $menu" }
  $target = Join-Path $env:WINDIR "System32\cmd.exe"
  $arguments = '/k "{0}"' -f $menu
  $description = "TownReporter: the numbered menu (the Control page's fallback)"
} else {
  if (-not (Test-Path $launcher)) { throw "Missing the launcher: $launcher" }
  if (-not (Test-Path $hidden)) { throw "Missing the hidden launcher: $hidden" }
  # wscript.exe, not node.exe and not powershell.exe: this is the executable
  # whose child is never drawn, and it takes the .vbs first and the script
  # second. The launcher resolves node itself and says so if node is missing.
  $target = Join-Path $env:WINDIR "System32\wscript.exe"
  $arguments = '"{0}" "{1}"' -f $hidden, $launcher
  $description = "TownReporter: the Control page -- is it up, and the buttons that fix it"
}

$desktop = [Environment]::GetFolderPath("Desktop")
$lnk = Join-Path $desktop "$Name.lnk"

if (-not $PSCmdlet.ShouldProcess($lnk, "create desktop shortcut")) { return }

$shell = New-Object -ComObject WScript.Shell
$s = $shell.CreateShortcut($lnk)
$s.TargetPath       = $target
$s.Arguments        = $arguments
$s.WorkingDirectory = $ops
$s.Description      = $description
$s.Save()

Write-Host ""
Write-Host "  Created: $lnk"
Write-Host "  Runs   : $target $arguments"
Write-Host ""
if ($Fallback) {
  Write-Host "  The numbered menu. Choose 7 in it to open the Control page."
} else {
  Write-Host "  No window opens: the icon starts the Control page and opens your browser"
  Write-Host "  on it. The page closes itself an hour after the last tab is shut."
  Write-Host "  The menu is still there if you want it: ops\$Name.cmd"
}
Write-Host ""
