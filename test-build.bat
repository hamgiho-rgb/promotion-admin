@echo off
cd /d "%~dp0"
title Test Build
echo.
echo  Running npm run build...
echo.
call npm run build
echo.
echo  --- Build finished. Check above for errors. ---
pause
