@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"
title Deploy via GitHub

echo.
echo  ========================================
echo   Deploy to Netlify (via GitHub)
echo  ========================================
echo.

echo  [1/3] Local build sanity check...
echo.
call npm run build
if errorlevel 1 (
  echo.
  echo  ERROR: build failed. Fix errors above and retry.
  goto :end
)

echo.
echo  ========================================
echo   Build OK
echo  ========================================
echo.

where git >nul 2>&1
if errorlevel 1 (
  echo  ERROR: Git not installed.
  goto :end
)

git rev-parse --is-inside-work-tree >nul 2>&1
if errorlevel 1 (
  echo  ERROR: Not a git repo.
  goto :end
)

echo  [2/3] Checking for changes...
git status --porcelain > "%TEMP%\gitstat.txt" 2>nul
for %%A in ("%TEMP%\gitstat.txt") do set GITSIZE=%%~zA
if "%GITSIZE%"=="0" (
  del "%TEMP%\gitstat.txt" >nul 2>&1
  echo  No changes since last commit. Skipping push.
  echo  Live site should already be up-to-date.
  goto :end
)
del "%TEMP%\gitstat.txt" >nul 2>&1

echo.
set /p MSG="Commit message (empty = 'update'): "
if "!MSG!"=="" set MSG=update

echo.
echo  [3/3] Pushing to GitHub - Netlify will auto-deploy in 1-2 min...
git add -A
git commit -m "!MSG!"
if errorlevel 1 (
  echo  Nothing to commit.
  goto :end
)
git push -u origin HEAD
if errorlevel 1 (
  echo  ERROR: push failed. Code not backed up to GitHub.
  goto :end
)

echo.
echo  ========================================
echo   PUSHED - Netlify auto-builds now
echo  ========================================
echo  Live (1-2 min): https://promotion-admin-ati.pages.dev
echo  GitHub:         https://github.com/hamgiho-rgb/promotion-admin
echo  Build progress: https://app.netlify.com/projects/promotion-admin/deploys
echo.

:end
echo.
pause
endlocal
