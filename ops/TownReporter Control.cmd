@echo off
REM TownReporter, without a terminal.
REM
REM Double-click this. Pick a number. Nothing here needs a developer, and
REM nothing here can print, publish or delete anything on the paper.
setlocal
set "OPS=%~dp0"
set "PS=%WINDIR%\System32\WindowsPowerShell\v1.0\powershell.exe"

:menu
cls
echo.
echo   TOWNREPORTER
echo   ============
echo.
echo   1  Is it up?          Check the paper, the tunnel and the database
echo   2  Restart the paper  When the desk is slow or acting strange
echo   3  Restart the tunnel When the site is down but the desk works
echo   4  Start everything   After a reboot, or if nothing is running
echo   5  Stop everything    Takes the paper offline until you start it again
echo.
echo   0  Close this window
echo.
set /p "choice=  Choose a number and press Enter: "

if "%choice%"=="1" goto check
if "%choice%"=="2" goto restart
if "%choice%"=="3" goto tunnel
if "%choice%"=="4" goto startall
if "%choice%"=="5" goto stopall
if "%choice%"=="0" exit /b 0
goto menu

:check
echo.
echo   Checking...
echo.
"%PS%" -NoProfile -ExecutionPolicy Bypass -File "%OPS%status.ps1"
goto done

:restart
echo.
echo   Restarting the paper. It is offline for about ten seconds.
schtasks /run /tn "TownReporter Restart" >nul 2>&1
timeout /t 15 /nobreak >nul
"%PS%" -NoProfile -ExecutionPolicy Bypass -File "%OPS%status.ps1"
goto done

:tunnel
echo.
echo   Restarting the tunnel. The desk keeps working; the public site blinks.
schtasks /run /tn "TownReporter Tunnel Restart" >nul 2>&1
timeout /t 15 /nobreak >nul
"%PS%" -NoProfile -ExecutionPolicy Bypass -File "%OPS%status.ps1"
goto done

:startall
echo.
echo   Starting the database, the paper and the tunnel.
schtasks /run /tn "TownReporter" >nul 2>&1
schtasks /run /tn "TownReporter Tunnel" >nul 2>&1
timeout /t 20 /nobreak >nul
"%PS%" -NoProfile -ExecutionPolicy Bypass -File "%OPS%status.ps1"
goto done

:stopall
echo.
set /p "sure=  This takes the paper OFFLINE. Type YES to confirm: "
if /i not "%sure%"=="YES" goto menu
"%PS%" -NoProfile -ExecutionPolicy Bypass -File "%OPS%stop-townreporter.ps1"
echo.
echo   Stopped. Choose 4 to start it again.
goto done

:done
echo.
pause
goto menu
