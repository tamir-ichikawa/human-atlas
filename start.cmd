@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is required. Please install the LTS version from https://nodejs.org/
  pause
  exit /b 1
)
if not defined HUMAN_ATLAS_PORT set HUMAN_ATLAS_PORT=4318
start "" "http://127.0.0.1:%HUMAN_ATLAS_PORT%"
node server.mjs
pause
