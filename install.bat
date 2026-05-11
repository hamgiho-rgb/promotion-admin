@echo off
title Install Packages

cd /d "%~dp0"

echo.
echo === Finding Node.js installation ===
echo.

set "NODEDIR="

if exist "C:\Program Files\nodejs\npm.cmd" set "NODEDIR=C:\Program Files\nodejs"
if exist "C:\Program Files (x86)\nodejs\npm.cmd" set "NODEDIR=C:\Program Files (x86)\nodejs"
if exist "%LOCALAPPDATA%\Programs\nodejs\npm.cmd" set "NODEDIR=%LOCALAPPDATA%\Programs\nodejs"
if exist "%APPDATA%\npm\npm.cmd" set "NODEDIR=%APPDATA%\npm"
if exist "%LOCALAPPDATA%\Volta\bin\npm.cmd" set "NODEDIR=%LOCALAPPDATA%\Volta\bin"

if "%NODEDIR%"=="" (
    echo Node.js not found in common locations.
    echo Please check:
    echo   C:\Program Files\nodejs\
    echo   %%LOCALAPPDATA%%\Programs\nodejs\
    echo.
    pause
    exit /b 1
)

echo Found Node.js at: %NODEDIR%
set "PATH=%NODEDIR%;%PATH%"
echo.

echo === Node / NPM Versions ===
"%NODEDIR%\node.exe" -v
call "%NODEDIR%\npm.cmd" -v
echo.

echo === Installing packages ^(takes 1-2 minutes^) ===
call "%NODEDIR%\npm.cmd" install
echo.

if errorlevel 1 (
    echo INSTALL FAILED
) else (
    echo INSTALL DONE
)

echo.
echo Press any key to close this window.
pause >nul
