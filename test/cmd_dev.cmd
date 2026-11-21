@echo off
rem Команда текстом: test\cmd_dev.cmd "--cmd=какая погода"
set FELIX_DATA=%~dp0data
if "%FELIX_ELECTRON%"=="" set FELIX_ELECTRON=%~dp0..\node_modules\electron\dist
"%FELIX_ELECTRON%\electron.exe" "%~dp0..\app" %*
