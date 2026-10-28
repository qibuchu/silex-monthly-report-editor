@echo off
setlocal

set "STORAGE_CONNECTORS=fs"
set "SILEX_FS_ROOT=%~dp0silex\storage"
set "HOSTING_CONNECTORS=download"

cd /d "%~dp0"
echo Starting localized Silex editor...
echo Writable project storage: %SILEX_FS_ROOT%
echo Editor URL: http://localhost:6805/?connectorId=fs-storage^&lang=zh
if not exist "dist\server\server\index.js" (
  echo Server build not found. Run the project build first.
  exit /b 1
)
node dist/server/server/

endlocal
