@echo off
setlocal
title AI DevTools - 后台服务脚手架
cd /d "%~dp0.."

where node >nul 2>nul
if errorlevel 1 (
  echo 未找到 Node.js。请先安装 Node.js 20 或更高版本，然后重新双击本文件。
  echo 下载: https://nodejs.org/
  echo.
  pause
  exit /b 1
)

node scripts\setup-local-scaffold.mjs
set EXITCODE=%ERRORLEVEL%
echo.
pause
exit /b %EXITCODE%
