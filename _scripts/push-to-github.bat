@echo off
cd /d "%~dp0"
title GitHub Push

echo.
echo  ========================================
echo   GitHub Push - promotion-admin
echo  ========================================
echo.

echo  [1/3] set remote URL...
git remote set-url origin https://github.com/hamgiho-rgb/promotion-admin.git 2>nul
if errorlevel 1 (
  git remote add origin https://github.com/hamgiho-rgb/promotion-admin.git
)
git remote -v
echo.

echo  [2/3] push to GitHub...
echo  (If a login prompt appears, please sign in.)
echo.
git push -u origin main
if errorlevel 1 goto :pushfail

echo.
echo  ========================================
echo   PUSH SUCCESS
echo  ========================================
echo  Next step: connect Netlify
echo  https://app.netlify.com
echo.
goto :end

:pushfail
echo.
echo  ERROR: push failed.
echo  Common causes:
echo    - GitHub auth missing - install GitHub Desktop and sign in once.
echo      https://desktop.github.com
echo    - Repo URL wrong / repo not empty.
echo.

:end
echo.
pause
