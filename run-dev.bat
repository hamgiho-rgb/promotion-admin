@echo off
chcp 65001 >nul
title 프로모션 어드민 - 개발 서버
cd /d "%~dp0"
echo.
echo ========================================
echo  프로모션 어드민 - 개발 서버 시작
echo ========================================
echo.
echo 브라우저에서 http://localhost:5173 으로 접속하세요.
echo 서버를 끄려면 이 창에서 Ctrl + C 를 누르세요.
echo.
powershell -NoProfile -Command "$env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User'); Set-Location '%~dp0'; npm run dev"
pause
