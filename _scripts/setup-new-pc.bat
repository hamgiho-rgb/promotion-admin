@echo off
setlocal
cd /d "%~dp0"
title New PC Setup

echo.
echo  ========================================
echo   New PC Setup Helper
echo  ========================================
echo.

set "NODE_OK="
where node >nul 2>&1 && set "NODE_OK=1"
if not defined NODE_OK if exist "C:\Program Files\nodejs\node.exe" (
  set "PATH=C:\Program Files\nodejs;%PATH%"
  set "NODE_OK=1"
)

if not defined NODE_OK (
  echo  ERROR: Node.js is not installed.
  echo  Download LTS: https://nodejs.org
  echo  After install, open a NEW terminal and try again.
  goto :end
)

for /f "delims=" %%v in ('node -v') do set NODEVER=%%v
echo  [OK] Node.js %NODEVER% found.
echo.

if exist ".env" (
  echo  [OK] .env already exists.
) else (
  echo  Creating .env with Supabase keys...
  (
    echo VITE_SUPABASE_URL=https://gnjjninntiwbbzmfcnqt.supabase.co
    echo VITE_SUPABASE_ANON_KEY=sb_publishable_1WFts_MStSQGujnaZfswiw_K6Ds1SKI
    echo VITE_ADMIN_PIN=5555
  ) > .env
  echo  [OK] .env created.
)
echo.

echo  Installing dependencies - takes 1-2 minutes...
echo.
call npm install
if errorlevel 1 (
  echo.
  echo  ERROR: npm install failed. Check internet connection.
  goto :end
)

echo.
echo  ========================================
echo   SUCCESS - Setup complete
echo  ========================================
echo.
echo  Now run: run-dev.bat   (or: npm run dev)
echo  Browser opens at http://localhost:5173
echo.

:end
echo.
pause
endlocal
