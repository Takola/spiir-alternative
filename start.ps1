$projectRoot = $PSScriptRoot
$env:SPIIR_ALT_DATA_DIR="$projectRoot\data"
$env:ENABLEBANKING_REDIRECT_URL="https://your-domain.example/enablebanking/callback"
$env:ENABLEBANKING_PSU_ID="spiir-alternative-local"
$env:SPIIR_CUTOVER_DATE="2025-01-01"
& "$projectRoot\.venv\Scripts\python.exe" -m uvicorn app.reference_api:app --app-dir "$projectRoot\backend" --port 8000
