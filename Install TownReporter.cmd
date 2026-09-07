@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0installer\Install.ps1" %*
if errorlevel 1 echo Installation failed. Read the message above; your existing data was not deleted.
pause
