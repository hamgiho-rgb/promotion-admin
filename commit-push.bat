@echo off
cd /d "%~dp0"
title Commit and Push

echo.
echo  ========================================
echo   Commit and Push to GitHub
echo  ========================================
echo.

set /p MSG="Commit message: "
if "%MSG%"=="" set MSG=update

git add -A
git commit -m "%MSG%"
if errorlevel 1 (
  echo.
  echo  Nothing to commit, or commit failed.
  goto :end
)

git push
if errorlevel 1 (
  echo.
  echo  ERROR: push failed.
  goto :end
)

echo.
echo  ========================================
echo   PUSHED - Netlify will auto-deploy in 1-2 minutes
echo   https://promotion-admin.netlify.app
echo  ========================================

:end
echo.
pause
