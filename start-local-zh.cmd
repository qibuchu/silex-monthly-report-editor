@echo off
setlocal

set "STORAGE_CONNECTORS=fs"
set "SILEX_FS_ROOT=%APPDATA%\org.silex.desktop\websites"
set "HOSTING_CONNECTORS=download"

cd /d "%~dp0"
echo Starting localized Silex editor...
echo Local project storage: %SILEX_FS_ROOT%
echo Editor URL: http://localhost:6805/?connectorId=fs-storage^&lang=zh
corepack pnpm@10.34.4 start

endlocal
