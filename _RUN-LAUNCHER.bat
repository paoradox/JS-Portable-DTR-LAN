@echo off
color 0A
setlocal

:: ---- Check for Administrator rights ----
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo Administrator rights required. Restarting with elevation...
    powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
    exit /b
)

:: ---- Move to the folder this .bat lives in (relative paths) ----
cd /d "%~dp0"

:: ---- Launch the server, then close this console ----
start "" "launcher\DTRServer.exe"
exit