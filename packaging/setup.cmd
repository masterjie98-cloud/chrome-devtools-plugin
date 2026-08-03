@echo off
setlocal
title AI DevTools Assistant - 安装
cd /d "%~dp0"

set "NODE_BIN=%~dp0runtime\node\win32-x64\node.exe"
if not exist "%NODE_BIN%" (
  echo 安装包缺少 Windows x64 便携 Node：
  echo %NODE_BIN%
  echo 请重新下载完整的 Release ZIP 并完整解压。
  echo.
  pause
  exit /b 1
)

"%NODE_BIN%" "%~dp0runtime\install-local.mjs" %*
set EXITCODE=%ERRORLEVEL%
echo.
pause
exit /b %EXITCODE%
