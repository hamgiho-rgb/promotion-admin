@echo off
setlocal
cd /d "%~dp0"
title Netlify Deploy Setup (One-time)

echo.
echo  ========================================
echo   Netlify Deploy Setup - one time
echo  ========================================
echo.

REM ensure Node/npm
where npm >nul 2>&1
if errorlevel 1 (
  echo  ERROR: npm not found. Install Node.js LTS first.
  echo  https://nodejs.org
  goto :end
)

echo  [1/3] Installing Netlify CLI globally...
echo.
call npm install -g netlify-cli
if errorlevel 1 (
  echo.
  echo  ERROR: install failed. Check internet or run as admin.
  goto :end
)

echo.
echo  [2/3] Logging in to Netlify (browser will open)...
echo.
call netlify login
if errorlevel 1 (
  echo.
  echo  ERROR: login failed.
  goto :end
)

echo.
echo  [3/3] Linking this folder to your Netlify site...
echo  When asked, choose: 'Use current git remote origin'
echo  or pick 'promotion-admin' from the list.
echo.
call netlify link
if errorlevel 1 (
  echo.
  echo  ERROR: link failed.
  goto :end
)

echo.
echo  ========================================
echo   SETUP DONE
echo  ========================================
echo.
echo  From now on just double-click deploy.bat to deploy.
echo  No git, no GitHub - goes straight to Netlify.
echo.

:end
echo.
pause
endlocal
