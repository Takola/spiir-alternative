param([switch]$Lan)

$projectRoot = $PSScriptRoot
$pythonPath = "$projectRoot\.venv\Scripts\python.exe"
if (-not (Test-Path -LiteralPath $pythonPath)) {
    throw "Missing .venv. Create it and install backend/requirements.txt first."
}
if (-not (Test-Path -LiteralPath "$projectRoot\frontend\node_modules")) {
    throw "Missing frontend dependencies. Run npm install in frontend first."
}
if (-not (Test-Path -LiteralPath "$projectRoot\.env")) {
    Write-Warning "No .env file found. Bank retrieval will require a configured PEM and Enable Banking settings."
}
if ($Lan) {
    $env:SPIIR_FRONTEND_HOST = "0.0.0.0"
}

$escapedRoot = [regex]::Escape($projectRoot)
Get-CimInstance Win32_Process |
    Where-Object {
        $_.CommandLine -match $escapedRoot -and
        ($_.CommandLine -match "uvicorn app\.api:app" -or $_.CommandLine -match "vite")
    } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

Start-Process -FilePath $pythonPath -ArgumentList @("-m", "uvicorn", "app.api:app", "--app-dir", "$projectRoot\backend", "--host", "127.0.0.1", "--port", "8000") -WorkingDirectory $projectRoot
Start-Process -FilePath "npm.cmd" -ArgumentList @("run", "dev") -WorkingDirectory "$projectRoot\frontend"

Write-Host "Open http://localhost:5173/"
if ($Lan) {
    Write-Warning "LAN mode exposes the frontend and its proxied finance API to the local network. Use only on a trusted network."
}
