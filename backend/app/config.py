from __future__ import annotations

import os
import re
from pathlib import Path

from dotenv import load_dotenv

ROOT_DIR = Path(__file__).resolve().parents[2]
load_dotenv(ROOT_DIR / ".env", override=False)


def _expand_legacy_dotenv_value(value: str) -> str:
    """Accept the old shell-style .env template on Windows during migration."""
    replacements = {"PWD": str(ROOT_DIR)}
    replacements.update({name: os.environ.get(name, "") for name in ("ENABLEBANKING_APP_ID",)})

    def replace(match: re.Match[str]) -> str:
        return replacements.get(match.group(1) or match.group(2), match.group(0))

    return re.sub(r"\$([A-Za-z_][A-Za-z0-9_]*)|\$\{([A-Za-z_][A-Za-z0-9_]*)\}", replace, value)


for _path_env_name in ("SPIIR_ALT_DATA_DIR", "ENABLEBANKING_PRIVATE_KEY_PATH"):
    if _path_env_value := os.getenv(_path_env_name):
        os.environ[_path_env_name] = _expand_legacy_dotenv_value(_path_env_value)


def _env(*names: str) -> str | None:
    for name in names:
        value = os.getenv(name)
        if value:
            return value
    return None


def _path_from_env(names: tuple[str, ...], default: Path) -> Path:
    value = _env(*names)
    if not value:
        return default
    return Path(value).expanduser().resolve()


def get_data_dir() -> Path:
    return _path_from_env(("SPIIR_ALT_DATA_DIR",), ROOT_DIR / "data")


def get_transactions_dir() -> Path:
    return get_data_dir() / "transactions"


def get_spiir_data_dir() -> Path:
    return get_data_dir() / "spiir"


def get_spiir_raw_dir() -> Path:
    return get_spiir_data_dir() / "raw"


def get_spiir_processed_dir() -> Path:
    return get_spiir_data_dir() / "processed"


def get_spiir_local_dir() -> Path:
    return get_spiir_data_dir() / "local"


def get_spiir_raw_export_file() -> Path:
    return get_spiir_raw_dir() / "all_entries.json"


def get_spiir_overview_file() -> Path:
    return get_spiir_processed_dir() / "overview.json"


def get_spiir_transactions_file() -> Path:
    return get_spiir_processed_dir() / "tx.json"


def get_spiir_update_log_file() -> Path:
    return get_spiir_data_dir() / "update.log"


def get_spiir_local_transactions_file() -> Path:
    return get_spiir_local_dir() / "transactions.json"


def get_spiir_local_import_runs_file() -> Path:
    return get_spiir_local_dir() / "import_runs.json"


def get_spiir_local_overrides_file() -> Path:
    return get_spiir_local_dir() / "overrides.json"


def get_spiir_local_metadata_file() -> Path:
    return get_spiir_local_dir() / "metadata.json"


def get_spiir_rebuild_state_file() -> Path:
    return get_spiir_local_dir() / "rebuild_state.json"


def get_spiir_income_expense_series_cache_file() -> Path:
    return get_spiir_local_dir() / "cache" / "income_expense_series.json"
