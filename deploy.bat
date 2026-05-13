@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"
title Deploy and Backup

echo.
echo  ========================================
echo   Deploy to Netlify + Backup to GitHub
echo  ========================================
echo.

where netlify >nul 2>&1
if errorlevel 1 (
  echo  ERROR: Netlify CLI not installed.
  echo  Run setup-deploy.bat first one time.
  goto :end
)

echo  [1/4] Building...
echo.
call npm run build
if errorlevel 1 (
  echo.
  echo  ERROR: build failed. Fix errors above and retry.
  goto :end
)

echo.
echo  [2/4] Uploading to Netlify production...
echo.
call netlify deploy --prod --dir=dist
if errorlevel 1 (
  echo.
  echo  ERROR: deploy failed.
  goto :end
)

echo.
echo  ========================================
echo   LIVE
echo  ========================================
echo  https://promotion-admin.netlify.app
echo.

where git >nul 2>&1
if errorlevel 1 (
  echo  [SKIP] Git not installed - skipping backup.
  goto :end
)

git rev-parse --is-inside-work-tree >nul 2>&1
if errorlevel 1 (
  echo  [SKIP] Not a git repo - skipping backup.
  goto :end
)

echo  [3/4] Checking for changes to back up...
git status --porcelain > "%TEMP%\gitstat.txt" 2>nul
for %%A in ("%TEMP%\gitstat.txt") do set GITSIZE=%%~zA
if "%GITSIZE%"=="0" (
  del "%TEMP%\gitstat.txt" >nul 2>&1
  echo  No changes since last commit - skipping git backup.
  goto :end
)
del "%TEMP%\gitstat.txt" >nul 2>&1

echo.
set /p MSG="Commit message (empty = 'update'): "
if "!MSG!"=="" set MSG=update

echo.
echo  [4/4] Committing and pushing to GitHub...
git add -A
git commit -m "!MSG!"
if errorlevel 1 (
  echo  Nothing to commit.
  goto :end
)
git push -u origin HEAD
if errorlevel 1 (
  echo  ERROR: push failed. Code is live but not backed up to GitHub.
  goto :end
)

echo.
echo  ========================================
echo   DONE - Live AND backed up
echo  ========================================
echo  Live:   https://promotion-admin.netlify.app
echo  GitHub: https://github.com/hamgiho-rgb/promotion-admin
echo.

:end
echo.
pause
endlocal
