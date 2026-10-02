@echo off
title Mafia Tournament OBS
cd /d "%~dp0"
if not exist node_modules (
  echo Installing dependencies...
  call npm install
  if errorlevel 1 pause & exit /b 1
)
echo.
echo Control panel: http://localhost:4173
echo OBS overlay:   http://localhost:4173/overlay.html
echo.
start "" http://localhost:4173
call npm start
pause
