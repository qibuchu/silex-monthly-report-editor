@echo off
setlocal
cd /d "%~dp0"
node tools\start-demo.cjs
if errorlevel 1 pause
endlocal
