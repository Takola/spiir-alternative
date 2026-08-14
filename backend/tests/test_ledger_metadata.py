from __future__ import annotations

from pathlib import Path

from app import spiir_local_ledger_service as ledger


def test_ledger_metadata_does_not_require_bank_staging(monkeypatch) -> None:
    metadata = {
        "last_retrieved_at": "2026-08-14T08:00:00Z",
        "last_retrieve_duration_seconds": 2.5,
        "accounts": [
            {
                "account_id": {"iban": "DK001"},
                "name": "Budget",
                "balance": {"amount": 1234.5, "currency": "DKK"},
            }
        ],
        "account_lookup": {"bank-1": {"id": "DK001", "name": "Budget"}},
    }
    monkeypatch.setattr(ledger, "get_spiir_local_metadata_file", lambda: Path("metadata.json"))
    monkeypatch.setattr(ledger, "_read_json", lambda _path: metadata)
    monkeypatch.setattr(
        ledger,
        "load_bank_transactions",
        lambda: (_ for _ in ()).throw(AssertionError("bank staging should not be read")),
    )

    result = ledger._build_local_ledger_transactions_meta(
        [{"source_id": "bank-1", "source_account_id": "DK001", "source_account_name": "Budget"}]
    )

    assert result["last_retrieved_at"] == "2026-08-14T08:00:00Z"
    assert result["accounts"][0]["balance"]["amount"] == 1234.5
    assert result["account_lookup"]["bank-1"]["id"] == "DK001"
