@echo off
setlocal
title AI DevTools Assistant Installer
cd /d "%~dp0"

set "NODE_BIN=%~dp0runtime\node\win32-x64\node.exe"
set "INSTALLED_ROOT=%LOCALAPPDATA%\AI DevTools Assistant"
set "INSTALLED_NODE=%INSTALLED_ROOT%\runtime\node\win32-x64\node.exe"
set "INSTALLED_MCP_SERVER=%INSTALLED_ROOT%\runtime\mcp\server.js"
if not exist "%NODE_BIN%" (
  echo The installer is missing the bundled Windows x64 Node.js runtime:
  echo %NODE_BIN%
  echo Download the complete Release ZIP again and extract all files.
  echo.
  pause
  exit /b 1
)

"%NODE_BIN%" "%~dp0runtime\install-local.mjs" %*
set EXITCODE=%ERRORLEVEL%
if "%EXITCODE%"=="0" (
  where codex >nul 2>&1
  if errorlevel 1 (
    echo.
    echo Codex CLI was not found on PATH. You can register it later with:
    echo codex mcp add --env AI_DEVTOOLS_MCP_TOOL_PROFILE=smart ai-devtools -- "%INSTALLED_NODE%" "%INSTALLED_MCP_SERVER%"
  ) else (
    echo.
    choice /C YN /N /M "Codex CLI detected. Register AI DevTools MCP now? [Y/N] "
    if errorlevel 2 (
      echo Skipped Codex MCP registration.
    ) else (
      codex mcp remove ai-devtools >nul 2>&1
      codex mcp add --env AI_DEVTOOLS_MCP_TOOL_PROFILE=smart ai-devtools -- "%INSTALLED_NODE%" "%INSTALLED_MCP_SERVER%"
      if errorlevel 1 (
        echo Codex MCP registration failed. Run this command manually:
        echo codex mcp add --env AI_DEVTOOLS_MCP_TOOL_PROFILE=smart ai-devtools -- "%INSTALLED_NODE%" "%INSTALLED_MCP_SERVER%"
      ) else (
        echo Codex MCP registration completed.
        codex mcp get ai-devtools
      )
    )
  )
)
echo.
pause
exit /b %EXITCODE%
