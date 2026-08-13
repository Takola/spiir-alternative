@echo off
setlocal
cd /d "%~dp0"

set "SPIIR_ALT_DATA_DIR=%~dp0data"
set "ENABLEBANKING_REDIRECT_URL=https://your-domain.example/enablebanking/callback"
set "ENABLEBANKING_PSU_ID=spiir-alternative-local"
set "SPIIR_CUTOVER_DATE=2025-01-01"

rem Stop stale backend instances and orphaned reload workers holding port 8000.
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$owners=@(Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue ^| Select-Object -ExpandProperty OwningProcess -Unique); $processes=@(Get-CimInstance Win32_Process); $ids=@($processes ^| Where-Object { $_.CommandLine -match 'uvicorn app\.reference_api:app' -and $_.CommandLine -match 'spiir-alternative' } ^| Select-Object -ExpandProperty ProcessId); foreach($ownerPid in $owners){ $ids += $ownerPid; $ids += @($processes ^| Where-Object { $_.CommandLine -match ('parent_pid=' + $ownerPid + '\b') } ^| Select-Object -ExpandProperty ProcessId) }; $ids ^| Sort-Object -Unique ^| ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }"

start "Spiir Alternative - Backend" cmd.exe /k ""%~dp0.venv\Scripts\python.exe" -m uvicorn app.reference_api:app --app-dir "%~dp0backend" --port 8000"
start "Spiir Alternative - Frontend" cmd.exe /k "cd /d ""%~dp0frontend"" && npm.cmd run dev"

echo Started the backend and frontend in separate windows.
echo Close any older backend/frontend windows first, or the new server cannot use ports 8000 and 5173.
echo Open http://localhost:5173/
