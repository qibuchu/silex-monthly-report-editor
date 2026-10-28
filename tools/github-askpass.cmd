@echo off
echo %~1 | findstr /I "username" >nul
if %errorlevel%==0 (
  echo x-access-token
  exit /b 0
)
"C:\Users\buchutang\Documents\Codex\2026-09-07\h-t\tools\bin\gh.exe" auth token
