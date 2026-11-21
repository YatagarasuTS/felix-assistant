@echo off
rem Феликс из исходников без установки: данные в test\data. Electron — FELIX_ELECTRON или node_modules проекта.
set FELIX_DATA=%~dp0data
if "%FELIX_ELECTRON%"=="" set FELIX_ELECTRON=%~dp0..\node_modules\electron\dist
start "" "%FELIX_ELECTRON%\electron.exe" "%~dp0..\app" %*
