@echo off
setlocal

set "STORAGE_CONNECTORS=fs"
set "SILEX_FS_ROOT=%~dp0silex\storage"
set "HOSTING_CONNECTORS=download"

cd /d "%~dp0"
echo Starting localized Silex editor...
echo Writable project storage: %SILEX_FS_ROOT%
echo Editor URL: http://localhost:6805/?connectorId=fs-storage^&lang=zh
corepack pnpm@10.34.4 start

endlocal
