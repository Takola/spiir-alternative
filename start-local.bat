@echo off
setlocal
cd /d "%~dp0"

if /I "%~1"=="lan" set "SPIIR_FRONTEND_HOST=0.0.0.0"

if not exist "%~dp0.venv\Scripts\python.exe" (
    echo Missing .venv. Create it and install backend\requirements.txt first.
    pause
    exit /b 1
)

if not exist "%~dp0frontend\node_modules" (
    echo Missing frontend dependencies. Run npm install in frontend first.
    pause
    exit /b 1
)

start "Spiir Alternative - Backend" cmd.exe /k ""%~dp0.venv\Scripts\python.exe" -m uvicorn app.api:app --app-dir "%~dp0backend" --host 127.0.0.1 --port 8000"
start "Spiir Alternative - Frontend" cmd.exe /k "cd /d "%~dp0frontend" && npm.cmd run dev"

echo Started backend and frontend in separate windows.
echo Open http://localhost:5173/
if /I "%~1"=="lan" echo LAN mode: open http://YOUR-PC-IP:5173/ only on a trusted network.
