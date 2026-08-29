' Run a PowerShell script with no window at all.
'
' The watchdog and the monitor tick run every five minutes, and both of them
' put a console window on the operator's screen for a second or two. That is
' not cosmetic: the window takes focus, so it interrupts whatever is being
' typed and the caret has to be put back by hand. Twelve times an hour.
'
' -WindowStyle Hidden does not fix it. Task Scheduler launches powershell.exe
' in the interactive session, and the console host is created and shown before
' the script's own window style is applied. The flash happens first.
'
' wscript.exe has no console of its own, and Run with intWindowStyle 0 starts
' the child hidden from the beginning, so nothing is ever drawn. The security
' context is untouched — same user, same session, same profile — which matters
' here because the desk shells out to the Claude Code CLI and that reads the
' operator's own login out of their profile.
'
' Waits for the script to finish (bWaitOnReturn = True) so that Task Scheduler
' reports the real exit code and two runs can never overlap.
'
'   wscript.exe run-hidden.vbs "C:\path\to\script.ps1"

Option Explicit

Dim shell, script, command, exitCode

If WScript.Arguments.Count < 1 Then
  WScript.Quit 2
End If

script = WScript.Arguments(0)

Set shell = CreateObject("WScript.Shell")
command = "powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File """ & script & """"

' 0 = hidden, True = wait and return the child's exit code.
exitCode = shell.Run(command, 0, True)

WScript.Quit exitCode
