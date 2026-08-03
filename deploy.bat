@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"
title Deploy via GitHub

echo.
echo  ========================================
echo   Deploy to Cloudflare Pages (via GitHub)
echo  ========================================
echo.

echo  [1/4] Local build sanity check...
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

echo  [2/4] Committing local changes (if any)...
git status --porcelain > "%TEMP%\gitstat.txt" 2>nul
for %%A in ("%TEMP%\gitstat.txt") do set GITSIZE=%%~zA
del "%TEMP%\gitstat.txt" >nul 2>&1

if "%GITSIZE%"=="0" (
  echo  No local changes to commit.
  echo.
) else (
  echo.
  set /p MSG="Commit message (empty = 'update'): "
  if "!MSG!"=="" set MSG=update
  git add -A
  git commit -m "!MSG!"
  if errorlevel 1 (
    echo  ERROR: commit failed.
    goto :end
  )
)

echo.
echo  [3/4] Pulling latest from GitHub (auto rebase)...
git pull --rebase origin main
if errorlevel 1 (
  echo.
  echo  ERROR: git pull failed. Likely a merge conflict.
  echo  Resolve conflicts manually then run:
  echo    git rebase --continue
  echo    then re-run deploy.bat
  goto :end
)

echo.
echo  [4/4] Pushing to GitHub - Cloudflare Pages will auto-deploy in 1-2 min...
git push -u origin HEAD
if errorlevel 1 (
  echo.
  echo  ERROR: push failed. Code not backed up to GitHub.
  goto :end
)

echo.
echo  ========================================
echo   PUSHED - Cloudflare auto-builds now
echo  ========================================
echo  Live (1-2 min): https://promotion-admin-ati.pages.dev
echo  GitHub:         https://github.com/hamgiho-rgb/promotion-admin
echo.

:end
echo.
pause
endlocal
