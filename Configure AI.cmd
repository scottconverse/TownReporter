@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0installer\Configure-AI.ps1" %*
pause
