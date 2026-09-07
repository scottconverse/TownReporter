@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0installer\Stop.ps1" %*
pause
