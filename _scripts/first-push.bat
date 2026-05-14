@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"
title GitHub First Push

echo.
echo  ========================================
echo   GitHub First Push Helper
echo  ========================================
echo.

where git >nul 2>&1
if errorlevel 1 (
  echo  ERROR: Git is not installed.
  echo  Download: https://git-scm.com/download/win
  echo  After install, open a NEW terminal and try again.
  goto :end
)
echo  [OK] Git found.
echo.

if exist ".git" (
  echo  This folder is already a git repository.
  echo.
  echo  Daily workflow:
  echo    git add .
  echo    git commit -m "message"
  echo    git push
  echo.
  goto :end
)

git config --global user.email >nul 2>&1
if errorlevel 1 (
  echo  One-time Git identity setup:
  set /p GITNAME="  Your name: "
  set /p GITEMAIL="  Your email: "
  git config --global user.name "!GITNAME!"
  git config --global user.email "!GITEMAIL!"
  echo.
)

echo  Create an EMPTY repo at https://github.com/new
echo  Copy its URL (ends with .git)
echo  Example: https://github.com/yourname/promotion-admin.git
echo.
set /p REPOURL="  Paste URL here: "

if "!REPOURL!"=="" (
  echo  ERROR: URL is empty.
  goto :end
)

echo.
echo  Step 1/5: git init
git init -b main
if errorlevel 1 goto :failed

echo  Step 2/5: add remote
git remote add origin "!REPOURL!"
if errorlevel 1 goto :failed

echo  Step 3/5: stage files
git add .
if errorlevel 1 goto :failed

echo  Step 4/5: first commit
git commit -m "first commit"
if errorlevel 1 goto :failed

echo  Step 5/5: push to GitHub
git push -u origin main
if errorlevel 1 goto :pushfail

echo.
echo  ========================================
echo   SUCCESS - Pushed to GitHub
echo  ========================================
echo  Next: connect this repo on Netlify.
echo  See handover doc section 3-3.
echo.
goto :end

:failed
echo.
echo  ERROR: a step failed. Check messages above.
goto :end

:pushfail
echo.
echo  ERROR: push failed. Common causes:
echo    - GitHub authentication missing.
echo      Easy fix: install GitHub Desktop and sign in once.
echo      https://desktop.github.com
echo    - Repository URL wrong.
echo    - Repo on GitHub is not empty.
goto :end

:end
echo.
pause
endlocal
