@echo off
setlocal
cd /d "%~dp0pipeline\monthly-service"
node server.mjs
endlocal
