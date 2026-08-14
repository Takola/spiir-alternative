# Spiir Alternative

A local, single-user personal-finance application. It imports transactions through Enable Banking, stores a canonical local JSON ledger, lets you review and edit transactions, and builds monthly income and expense views from that ledger.

The application is bank-provider-neutral. During consent you choose an available Danish bank (ASPSP); no specific bank is required.

## Screenshots

### Transaction review

![Local ledger transaction review](screenshots/nordea-local-ledger-review.png)

### Monthly overview

![Monthly income and expense chart](screenshots/spiir-monthly-chart-and-table.jpeg)

### Category drilldown

![Category sunburst drilldown](screenshots/spiir-sunburst-drilldown.png)

![Category transactions](screenshots/spiir-category-transactions.png)

## Architecture

The application has one authoritative transaction model:

1. `backend/app/enable_banking_service.py` fetches account balances and booked transactions, archives the provider response, and normalizes it.
2. `backend/app/spiir_local_ledger_service.py` merges normalized transactions into the local ledger and applies local edits, review state, splits, and category suggestions.
3. `backend/app/spiir_service.py` derives the overview and income/expense series from the local ledger.
4. `backend/app/api.py` exposes the FastAPI routes used by the frontend.
5. `frontend/src/LedgerDashboard.tsx` and `frontend/src/SpiirDashboard.tsx` provide transaction review and reporting.

The category catalog is defined in `backend/app/taxonomy.py`; automatic rules live in `backend/app/autocategorization.py`.

Runtime data is stored below `data/` and is ignored by Git. The important files are:

```text
data/
|-- local_secrets/enablebanking/*.pem
|-- transactions/enablebanking/latest_session.json
|-- transactions/enablebanking/transactions.json
|-- transactions/raw/enablebanking/*.json
|-- spiir/local/transactions.json
|-- spiir/local/overrides.json
|-- spiir/local/metadata.json
`-- spiir/processed/{overview.json,tx.json}
```

## Quick start on Windows

Requirements:

- Python 3.11 or newer
- Node.js 22 or newer
- an Enable Banking app and private key if you want live bank data

Install once from PowerShell:

```powershell
py -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r backend\requirements.txt
Set-Location frontend
npm install
Set-Location ..
```

Create `.env` in the repository root (see [Configuration](#configuration)), then run:

```text
start-local.bat
```

This starts the backend at `http://127.0.0.1:8000` and the frontend at `http://127.0.0.1:5173`. `start.ps1` is the PowerShell entry point used by the batch wrapper.

## Manual start

Backend:

```powershell
.\.venv\Scripts\python.exe -m uvicorn app.api:app --app-dir backend --host 127.0.0.1 --port 8000
```

Frontend:

```powershell
Set-Location frontend
npm run dev
```

Vite proxies `/api` to the backend, so the browser never needs the Enable Banking key.

## Configuration

The backend automatically loads a root `.env` file without overriding variables already set in the shell. Copy `env.example` as a starting point, but use normal dotenv assignments in `.env` (omit the shell-only `export` keyword if preferred):

```dotenv
SPIIR_ALT_DATA_DIR=C:/path/to/spiir-alternative/data
ENABLEBANKING_APP_ID=your-enable-banking-app-id
ENABLEBANKING_PRIVATE_KEY_PATH=C:/path/to/spiir-alternative/data/local_secrets/enablebanking/your-enable-banking-app-id.pem
ENABLEBANKING_REDIRECT_URL=https://your-registered-callback.example/callback
ENABLEBANKING_PSU_ID=spiir-alternative-local
SPIIR_CUTOVER_DATE=2026-01-01
```

If exactly one PEM file exists in `data/local_secrets/enablebanking/`, the backend infers the app ID from its filename. Explicit variables are preferable when more than one key exists.

Never put these values in frontend source, `VITE_*` variables, or committed files. `.env`, `data/`, PEM keys, sessions, transaction archives, and local ledgers must remain private.

See [docs/enable-banking.md](docs/enable-banking.md) for consent and session setup.

## Bank retrieval

Once `data/transactions/enablebanking/latest_session.json` exists, use the **Hent seneste** action in the transaction view. The same operation is available through the API:

```powershell
Invoke-RestMethod -Method Post http://127.0.0.1:8000/api/bank/retrieve/start
Invoke-RestMethod http://127.0.0.1:8000/api/bank/retrieve/status
```

The job fetches each account, records its current booked balance when available, archives the raw response, normalizes and deduplicates transactions, and merges eligible rows into the local ledger. `SPIIR_CUTOVER_DATE` prevents live-bank rows on or before that date from duplicating historical imports.

## Main API routes

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/api/status` | Process and storage status |
| `POST` | `/api/bank/retrieve/start` | Start bank fetch and local-ledger merge |
| `GET` | `/api/bank/retrieve/status` | Poll the fetch job |
| `GET` | `/api/ledger/taxonomy` | Categories and hashtags |
| `GET` | `/api/spiir/local-ledger/transactions` | Read the canonical ledger |
| `POST` | `/api/spiir/local-ledger/overrides` | Apply transaction edits |
| `GET` | `/api/spiir/local-ledger/income-expense-series` | Read chart data |
| `POST` | `/api/spiir/rebuild-from-local` | Rebuild processed reporting data |
| `GET` | `/api/spiir/overview` | Read the processed overview |

The import-preview/apply and split migration/repair routes in `backend/app/api.py` are maintenance and compatibility operations, not a second transaction model.

## Network and security

The default backend and Vite server bind to `127.0.0.1`. The FastAPI API has no login and must not be exposed directly to the LAN or internet.

To open the UI to another device on a trusted LAN, explicitly use LAN mode:

```powershell
start-local.bat lan
```

This is still a security decision: Vite's `/api` proxy effectively gives every visitor who can reach the frontend access to the unauthenticated backend operations, including reading and editing financial data and starting a bank fetch. The private key is not downloaded to their browser, but they can cause the backend to use it. Use this only on a trusted network with a restrictive firewall. Add authentication and HTTPS before broader access.

## Compatibility with existing data

Some stored transaction IDs, source fields, import-run labels, CSS classes, and fallback paths retain `nordea` in their internal value. They are legacy compatibility keys so existing overrides and ledgers continue to match; they do not restrict the selected Enable Banking provider. Do not rewrite those IDs in existing JSON by hand.

An older Spiir postings export can still be imported once from `data/spiir/raw/all_entries.json` with the local-ledger preview/apply routes. New activity should enter through `/api/bank/retrieve/start` and the canonical local ledger.

## Storage decision: JSON ledger, not SQLite (for now)

Decision: keep `data/spiir/local/transactions.json` as the canonical store for this single-user application.

Why: writes are already atomic and backed up, the data remains inspectable and portable, current dataset sizes fit in memory, and moving to SQLite would add migration and dual-storage risk without solving a demonstrated problem. The service and API boundaries keep a future migration possible.

Reconsider SQLite when concurrent writers, multi-user access, substantially larger datasets, complex ad-hoc queries, or measurable JSON read/write bottlenecks become real requirements. A future migration should preserve transaction IDs and overrides and include a verified rollback/export path.

## Tests and CI

Run the same checks used by `.github/workflows/ci.yml`:

```powershell
Set-Location backend
..\.venv\Scripts\python.exe -m ruff check app tests
..\.venv\Scripts\python.exe -m pytest
Set-Location ..\frontend
npm test
npm run build
```

GitHub Actions runs backend lint/tests and frontend tests/build on pushes and pull requests.

## Privacy checklist

Before sharing a fork, log, screenshot, or patch:

1. Confirm `.env`, `data/`, and all PEM files are untracked.
2. Remove sessions, account identifiers, balances, transaction descriptions, notes, and amounts from examples.
3. Rotate any key exposed in source control, chat, CI output, or screenshots.
4. Keep the API loopback-only unless you have added an authentication boundary.
