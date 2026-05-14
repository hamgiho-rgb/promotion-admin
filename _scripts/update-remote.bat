@echo off
cd /d "%~dp0"
title Update Remote

echo.
echo  Updating remote URL to promotion-admin (no trailing dash)...
git remote set-url origin https://github.com/hamgiho-rgb/promotion-admin.git
echo.
echo  Current remote:
git remote -v
echo.
echo  Verifying connection (git fetch)...
git fetch origin
if errorlevel 1 (
  echo.
  echo  ERROR: fetch failed. URL may be wrong or repo not accessible.
  goto :end
)
echo.
echo  ========================================
echo   REMOTE UPDATED - all good
echo  ========================================

:end
echo.
pause
