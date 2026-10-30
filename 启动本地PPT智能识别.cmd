@echo off
setlocal
cd /d "%~dp0"
node pipeline\monthly-service\start-local-template-ai.mjs
if errorlevel 1 pause
endlocal
