@echo off
cd /d "%~dp0"
title Push Bulk Delete Feature

echo.
echo  ========================================
echo   Commit + Push to GitHub
echo  ========================================
echo.

git add -A
git commit -m "feat: AW favicon + filter-wide 'select all' for bulk delete"
if errorlevel 1 (
  echo.
  echo  Nothing new to commit, or commit failed.
  goto :end
)

echo.
echo  Pushing to GitHub...
git push
if errorlevel 1 (
  echo.
  echo  ERROR: push failed.
  goto :end
)

echo.
echo  ========================================
echo   PUSHED - Netlify will auto-deploy
echo   in about 1-2 minutes
echo   https://promotion-admin.netlify.app
echo  ========================================

:end
echo.
pause
