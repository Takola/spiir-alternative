$env:SPIIR_ALT_DATA_DIR="$PWD\data"
$env:ENABLEBANKING_APP_ID="a1236159-5b1b-40f0-a50a-0370110474c6"
$env:ENABLEBANKING_PRIVATE_KEY_PATH="$PWD\data\local_secrets\enablebanking\$env:ENABLEBANKING_APP_ID.pem"
$env:ENABLEBANKING_REDIRECT_URL="https://your-domain.example/enablebanking/callback"
$env:ENABLEBANKING_PSU_ID="spiir-alternative-local"
$env:SPIIR_CUTOVER_DATE="2025-01-01"
$env:STOREBOX_SOURCE_DIR="$PWD\data\storebox"
.venv\Scripts\python.exe -m uvicorn app.reference_api:app --app-dir backend --reload --port 8000
