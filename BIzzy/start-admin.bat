@echo off
title Business OS - Admin Panel
cd /d %~dp0backend

where node >nul 2>nul
if %errorlevel% neq 0 (
  echo.
  echo  Node.js nahi mila. Pehle Node.js 22 ya usse naya install karo:
  echo  https://nodejs.org - LTS version lo.
  echo.
  pause
  exit /b 1
)

echo.
echo  ==========================================================
echo   ADMIN PANEL ke liye apna admin account set karo
echo   Ye email aur password yaad rakhna - isi se login hoga.
echo   Har baar is file se start karte time yahi dalna hai.
echo  ==========================================================
echo.
set /p ADMIN_EMAIL=Admin email:
set /p ADMIN_PASS=Admin password:
if "%ADMIN_EMAIL%"=="" goto noadmin
if "%ADMIN_PASS%"=="" goto noadmin
set SUPER_ADMIN_EMAIL=%ADMIN_EMAIL%
set SUPER_ADMIN_PASSWORD=%ADMIN_PASS%
echo.
echo  Theek hai - server chalte hi admin account ban jayega.
goto admindone
:noadmin
echo.
echo  Khali chhoda - admin account nahi banega, sirf normal app chalega.
:admindone

if not exist node_modules (
  echo Pehli baar setup ho raha hai - packages install ho rahe hain...
  call npm install
)

echo.
echo  Business OS chal raha hai:  http://localhost:4000
echo  Login page par ADMIN email/password daloge to Admin Panel khulega.
echo  Band karne ke liye ye window band kar do.
echo.
start "" /min cmd /c "timeout /t 2 >nul & start http://localhost:4000"
node server.js
pause
