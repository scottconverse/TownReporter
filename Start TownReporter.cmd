@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0installer\Start.ps1" %*
if errorlevel 1 pause
