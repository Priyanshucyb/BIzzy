@echo off
title Business OS v3
cd /d %~dp0backend

where node >nul 2>nul
if %errorlevel% neq 0 (
  echo.
  echo  Node.js nahi mila. Pehle Node.js 22 ya usse naya install karo:
  echo  https://nodejs.org  ^(LTS version^)
  echo.
  pause
  exit /b 1
)

if not exist node_modules (
  echo Pehli baar setup ho raha hai - packages install ho rahe hain...
  call npm install
)

echo.
echo  Business OS chal raha hai:  http://localhost:4000
echo  Band karne ke liye ye window band kar do.
echo.
start "" /min cmd /c "timeout /t 2 >nul & start http://localhost:4000"
node server.js
pause
