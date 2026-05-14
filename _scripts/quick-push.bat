@echo off
cd /d "%~dp0"
title Push Bulk Delete Feature

echo.
echo  ========================================
echo   Commit + Push to GitHub
echo  ========================================
echo.

git add -A
git commit -m "ui: remove example helper text under company name field"
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
echo   https://promotion-admin-ati.pages.dev
echo  ========================================

:end
echo.
pause
