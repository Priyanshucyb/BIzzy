@echo off
title Business OS v3 — Demo Data Load
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
echo  Demo dukaan (Sharma General Store) ka data load ho raha hai...
echo  Note: agar app (server) chal raha hai to pehle use band kar do.
echo.
node seed-demo.js

echo.
echo  Ab start-business-os.bat chalao aur demo login se app kholo:
echo    Owner:  demo@businessos.app / demo1234
echo    Staff:  counter@businessos.app / staff1234
echo.
pause
