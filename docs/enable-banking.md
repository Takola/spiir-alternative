# Enable Banking setup

Enable Banking is this application's bank-connectivity provider. It supplies account metadata, balances, and booked transactions; the application then stores and categorizes those transactions locally. The setup is bank-provider-neutral: choose the Danish personal AIS provider returned for your own bank.

This guide is for a private, single-user installation. It is not guidance for operating a public account-information service.

## Data flow

```text
Enable Banking consent
        |
        v
latest_session.json
        |
        v
POST /api/bank/retrieve/start
        |
        +--> raw response archive
        +--> normalized provider cache
        `--> canonical local JSON ledger --> overview
```

Relevant files:

- `scripts/enablebanking_probe.py` lists providers, creates a consent URL, exchanges the code, and can fetch a diagnostic transaction archive.
- `backend/app/enable_banking_service.py` implements application retrieval, status, normalization, and account balance loading.
- `backend/app/spiir_local_ledger_service.py` merges normalized rows into the canonical local ledger.
- `backend/app/api.py` exposes `/api/bank/retrieve/start` and `/api/bank/retrieve/status`.
- `data/transactions/enablebanking/` stores local consent/session and processed provider data.

## Prerequisites

- an Enable Banking developer account
- a restricted production Account Information (AIS) app for your own accounts
- its app ID and RSA private key PEM
- a redirect URL registered exactly as used during consent
- Python 3.11 or newer and `backend/requirements.txt` installed

Restricted production access is appropriate for fetching only accounts explicitly linked to your personal app. Sandbox data can test signing and requests but cannot validate access to your real accounts. Public or multi-user service requirements are outside this project's scope.

## Configure the app

In the Enable Banking portal, create or configure an Account Information Restricted application. Register a redirect URL and link only the accounts the app should read.

Keep the private key below the ignored data directory:

```text
data/local_secrets/enablebanking/<app-id>.pem
```

Create a root `.env` file:

```dotenv
SPIIR_ALT_DATA_DIR=C:/path/to/spiir-alternative/data
ENABLEBANKING_APP_ID=<app-id>
ENABLEBANKING_PRIVATE_KEY_PATH=C:/path/to/spiir-alternative/data/local_secrets/enablebanking/<app-id>.pem
ENABLEBANKING_REDIRECT_URL=https://your-registered-callback.example/callback
ENABLEBANKING_PSU_ID=spiir-alternative-local
SPIIR_CUTOVER_DATE=2026-01-01
```

The backend automatically loads this `.env`. Existing shell variables take precedence. If exactly one PEM exists in `data/local_secrets/enablebanking/`, the backend can infer the app ID from the PEM filename; set the variables explicitly if multiple keys exist.

The standalone probe does not load `.env` through the backend configuration module. Before running it, load the variables in the current shell or set them for the process. In PowerShell, for example:

```powershell
$env:SPIIR_ALT_DATA_DIR = "$PWD/data"
$env:ENABLEBANKING_APP_ID = "<app-id>"
$env:ENABLEBANKING_PRIVATE_KEY_PATH = "$PWD/data/local_secrets/enablebanking/<app-id>.pem"
$env:ENABLEBANKING_REDIRECT_URL = "https://your-registered-callback.example/callback"
```

Never use `VITE_*` for these values. Vite variables are bundled for browsers. The frontend needs no bank credential; it calls the local backend through the `/api` proxy.

## List available banks

From the repository root:

```powershell
.\.venv\Scripts\python.exe scripts\enablebanking_probe.py aspsps
```

Optionally filter the printed Danish personal AIS list:

```powershell
.\.venv\Scripts\python.exe scripts\enablebanking_probe.py aspsps --name "part of bank name"
```

Use the provider name exactly as returned in the next command.

## Create consent and a session

Generate a consent URL. Choose a duration within the provider's advertised limit:

```powershell
.\.venv\Scripts\python.exe scripts\enablebanking_probe.py auth-url --days 170 --aspsp-name "<provider name>" --aspsp-country DK
```

Open the printed URL and approve access with your bank. The browser returns to the registered redirect URL with a short-lived `code` query parameter. A missing callback page is harmless for this manual flow if the code is visible in the address bar.

Exchange it promptly:

```powershell
.\.venv\Scripts\python.exe scripts\enablebanking_probe.py session --code "<code>"
```

This writes:

```text
data/transactions/enablebanking/latest_session.json
data/transactions/enablebanking/session_<session-id>.json
```

The session contains the accounts made available by consent. Renew consent when the provider's access period expires.

## Verify a transaction fetch

The probe can fetch one account by its zero-based index:

```powershell
.\.venv\Scripts\python.exe scripts\enablebanking_probe.py transactions --account-index 0 --strategy longest
```

Repeat with indices `1`, `2`, and so on if needed. For an explicit window:

```powershell
.\.venv\Scripts\python.exe scripts\enablebanking_probe.py transactions --account-index 0 --strategy default --date-from 2026-01-01 --date-to 2026-01-31
```

The probe follows `continuation_key` pagination and writes diagnostic raw responses below `data/transactions/raw/enablebanking/`.

## Fetch through the application

Start the backend on loopback:

```powershell
.\.venv\Scripts\python.exe -m uvicorn app.api:app --app-dir backend --host 127.0.0.1 --port 8000
```

Then use **Hent seneste** in the frontend, or call:

```powershell
Invoke-RestMethod -Method Post http://127.0.0.1:8000/api/bank/retrieve/start
Invoke-RestMethod http://127.0.0.1:8000/api/bank/retrieve/status
```

The background job reads all locally stored Enable Banking session files, fetches linked accounts and balances, follows transaction pagination, archives provider responses, normalizes and deduplicates rows, and merges rows after `SPIIR_CUTOVER_DATE` into `data/spiir/local/transactions.json`.

The frontend polls the status route. After a merge changes the ledger, reporting data is marked for rebuild and the application can schedule or run `/api/spiir/rebuild-from-local`.

## Local network security

The backend intentionally binds to `127.0.0.1` and has no authentication. Keep it there.

The default Vite server also uses loopback. Starting Vite with `--host 0.0.0.0` makes the UI reachable on the LAN, but its `/api` proxy also gives LAN visitors a path to the local backend. They cannot read the PEM key directly from frontend code, yet they can invoke operations that make the backend use it and can read or edit financial records. Only do this on a trusted network with an appropriate firewall; add authentication and HTTPS before wider exposure.

## Existing-data compatibility

Current files use the provider-neutral `transactions/enablebanking/` location and public `/api/bank/*` routes. The backend still reads old `data/transactions/nordea/transactions.json` and retrieval status files when a current file is absent.

Normalized and local-ledger records may also retain IDs or source values containing `nordea`. These values are deliberately stable compatibility keys for existing local overrides and imported ledgers, regardless of which bank is now selected. Do not bulk-rename them without a tested data migration.

## Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| `Place one Enable Banking private key...` or an app-ID error | no explicit credentials and zero or multiple PEM files | set `ENABLEBANKING_APP_ID` and `ENABLEBANKING_PRIVATE_KEY_PATH`, or leave exactly one correctly named PEM in the local key directory |
| `Missing Enable Banking private key` | the configured path is wrong | use an absolute path and confirm the backend process can read the file |
| `401` or `403` | app/key mismatch, inactive app, expired consent, or unlinked account | verify the app ID matches the PEM, app is active, and consent includes the account |
| Redirect URL mismatch | local value differs from the portal | make `ENABLEBANKING_REDIRECT_URL` exactly match the registered URL |
| Browser shows `Not Found` after consent | no callback handler serves the registered URL | copy the `code` from the final URL if present and exchange it manually |
| Session has no accounts | linking or consent selected no accounts | link accounts, repeat consent, and exchange the new code |
| Few transactions | provider history limit or incremental window | use the probe's `--strategy longest` soon after consent and check booked transactions |
| `Hent seneste` cannot start | backend did not load credentials/session | check `.env`, the PEM location, `latest_session.json`, and backend console output |

## Secret-handling checklist

Before sharing source, logs, screenshots, or CI output:

1. Keep `.env`, `data/`, PEM files, sessions, and transaction archives untracked.
2. Redact account IDs, balances, transaction descriptions, amounts, consent codes, and session IDs.
3. Never send the private key or bank credentials to the frontend.
4. Rotate an Enable Banking key immediately if it appears in Git, chat, CI, or a screenshot.
5. Keep the unauthenticated API bound to loopback.
