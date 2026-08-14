@echo off
setlocal
cd /d "%~dp0"

if /I "%~1"=="lan" (
    powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0start.ps1" -Lan
) else (
    powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0start.ps1"
)
