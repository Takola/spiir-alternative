# Spiir Alternative

A local, single-user personal-finance app that fetches bank transactions through Enable Banking and displays them in a local React frontend.

The normal workflow is:

1. authorize an account through Enable Banking
2. fetch balances and booked transactions
3. merge them into the local ledger
4. review categories, notes, splits, and pending transactions in the frontend
5. view income, expense, and category summaries


## What is where

```text
backend/
├── app/
│   ├── api.py                         FastAPI routes
│   ├── enable_banking_service.py      Enable Banking client and bank retrieval
│   ├── spiir_local_ledger_service.py  canonical local ledger and edits
│   ├── spiir_service.py               derived overview/reporting data
│   ├── taxonomy.py                    category catalog
│   └── autocategorization.py          automatic categorization rules
├── enablebanking_probe.py             consent/session diagnostic utility
├── requirements.txt
├── pyproject.toml                     pytest and Ruff configuration
└── tests/                             backend regression tests

frontend/
├── src/LedgerDashboard.tsx            transaction review UI
├── src/SpiirDashboard.tsx             overview/reporting UI
└── package.json

data/                                  private runtime data; never commit it
.env                                   private local configuration; never commit it
start-local.bat                        Windows launcher for backend + frontend
start.ps1                              PowerShell launcher alternative
simple_guide.txt                       short setup note for humans 
```

## Windows setup

Requirements: Python 3.11 or newer, Node.js 22 or newer, and an Enable Banking application/private key for live bank data.

Install dependencies once from PowerShell:

```powershell
py -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r backend\requirements.txt
Set-Location frontend
npm install
Set-Location ..
```

Create `.env` in the repository root. Start from [env.example](env.example), using normal dotenv assignments:

```dotenv
SPIIR_ALT_DATA_DIR=data
ENABLEBANKING_APP_ID=your-enable-banking-app-id
ENABLEBANKING_PRIVATE_KEY_PATH=data/local_secrets/enablebanking/your-enable-banking-app-id.pem
ENABLEBANKING_REDIRECT_URL=https://your-registered-callback.example/callback
ENABLEBANKING_PSU_ID=spiir-alternative-local
```

The backend loads `.env` automatically. It also accepts the older `$PWD/data` path syntax, but `SPIIR_ALT_DATA_DIR=data` is preferred on Windows. Put the private key at `data/local_secrets/enablebanking/<app-id>.pem`; if exactly one PEM exists there, the backend can infer the app ID from its filename.

Start both services by double-clicking `start-local.bat`, then open <http://localhost:5173/>. The backend runs on <http://127.0.0.1:8000/>. For deliberate trusted-LAN access, run `start-local.bat lan`; this exposes the unauthenticated finance API through the frontend proxy, so use it only on a trusted network.

## First Enable Banking authorization

The PEM file is required, but it only identifies/signs your Enable Banking application. It does not grant access to a bank account. You must complete the consent flow below once for each account connection. After a successful consent, the saved session is reused by **Hent seneste**; you do not repeat these commands for every fetch.

If `data/transactions/enablebanking/latest_session.json` already exists and is still valid, skip this section and use **Hent seneste** in the frontend.

To create a new consent session, run these commands from the repository root:

```powershell
.\.venv\Scripts\python.exe backend\enablebanking_probe.py aspsps --name "part of your bank name"
.\.venv\Scripts\python.exe backend\enablebanking_probe.py auth-url --days 170 --aspsp-name "<provider name>" --aspsp-country DK
```

The first command lists matching providers. The second creates a consent URL. Open the printed URL, complete the bank/MitID authorization, then exchange the returned code:

```powershell
.\.venv\Scripts\python.exe backend\enablebanking_probe.py session --code "<code-from-redirect>"
```

This creates `data/transactions/enablebanking/latest_session.json`. Then use **Hent seneste** in the frontend or call:

```powershell
Invoke-RestMethod -Method Post http://127.0.0.1:8000/api/bank/retrieve/start
Invoke-RestMethod http://127.0.0.1:8000/api/bank/retrieve/status
```

The retrieval job fetches each linked account, records balances when available, archives raw responses, normalizes and deduplicates transactions, and merges them into the local ledger.

## Runtime data

All content under `data/` is private and ignored by Git.

```text
data/
├── local_secrets/enablebanking/*.pem       private key
├── transactions/enablebanking/             current sessions and bank state
├── transactions/raw/enablebanking/         raw bank-response archives
├── transactions/nordea/                    legacy compatibility staging path
├── backups/                                snapshots before local writes
└── spiir/
    ├── local/                              canonical ledger, overrides, metadata
    ├── processed/                          derived overview and transaction output
    └── raw/                                optional old Spiir-export compatibility input
```

The `spiir` directory name is historical. `spiir/local/transactions.json` is the canonical ledger even when all new data comes from Enable Banking. The old `transactions/nordea/` folder is retained as a fallback for existing data and should not be deleted until a successful fetch has created `transactions/enablebanking/transactions.json`.

Raw bank archives and old backups are not required for normal frontend display, but backups can restore manual categories, notes, splits, and review state. Prune them only after keeping a recovery copy.

## Main API routes

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/api/status` | backend and storage status |
| `POST` | `/api/bank/retrieve/start` | start bank fetch and ledger merge |
| `GET` | `/api/bank/retrieve/status` | poll retrieval progress |
| `GET` | `/api/ledger/taxonomy` | categories and hashtags |
| `GET` | `/api/spiir/local-ledger/transactions` | read canonical ledger rows |
| `POST` | `/api/spiir/local-ledger/overrides` | save categories, notes, splits, and review edits |
| `GET` | `/api/spiir/local-ledger/income-expense-series` | chart data |
| `POST` | `/api/spiir/rebuild-from-local` | rebuild derived reporting files |
| `GET` | `/api/spiir/overview` | read derived overview |

## Development checks

The backend tests and lint configuration live under `backend/`:

```powershell
Set-Location backend
..\.venv\Scripts\python.exe -m pytest
..\.venv\Scripts\python.exe -m ruff check app tests
Set-Location ..\frontend
npm test
npm run build
```

`.pytest_cache/` and `.ruff_cache/` are disposable tool caches. They are recreated automatically after running the corresponding commands.

## Security

Enable Banking keys, consent sessions, raw responses, balances, transactions, and `.env` must remain local and private. The backend and frontend bind to loopback by default. LAN mode is intentionally unauthenticated and should only be used on a trusted network.
