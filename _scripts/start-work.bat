@echo off
setlocal
cd /d "%~dp0"
title Start Work - Pull Latest

echo.
echo  ========================================
echo   Start Work - Pull Latest from GitHub
echo  ========================================
echo.

where git >nul 2>&1
if errorlevel 1 (
  echo  ERROR: Git not installed.
  goto :end
)

echo  Fetching latest from GitHub...
echo.
git pull
if errorlevel 1 (
  echo.
  echo  ERROR: pull failed. You may have local changes that conflict.
  echo  Run: git status   to see what is going on.
  goto :end
)

echo.
echo  ========================================
echo   READY - now run run-dev.bat to start
echo  ========================================
echo.

:end
echo.
pause
endlocal
