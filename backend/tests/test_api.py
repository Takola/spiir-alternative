from pathlib import Path

from fastapi.testclient import TestClient

from app import api


def _client() -> TestClient:
    return TestClient(api.create_app())


def test_active_and_removed_routes() -> None:
    paths = {route.path for route in api.create_app().routes}

    assert {
        "/api/status",
        "/api/spiir/local-ledger/transactions",
        "/api/spiir/local-ledger/overrides",
        "/api/ledger/taxonomy",
        "/api/bank/retrieve/start",
        "/api/bank/retrieve/status",
    } <= paths
    assert {
        "/api/nordea/transactions",
        "/api/nordea/overrides",
        "/api/nordea/retrieve/start",
        "/api/storebox/receipts",
    }.isdisjoint(paths)


def test_status_reports_runtime_storage(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setattr(api, "ensure_runtime_dirs", lambda: None)
    monkeypatch.setattr(api, "get_data_dir", lambda: tmp_path)

    response = _client().get("/api/status")

    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "ok"
    assert payload["storage"]["data_dir"] == str(tmp_path)
    assert payload["timestamp_utc"].endswith("Z")


def test_override_request_is_validated_and_forwarded(monkeypatch) -> None:
    captured: dict[str, object] = {}

    def save(transaction_ids: list[str], patch: dict[str, object]) -> dict[str, object]:
        captured.update(transaction_ids=transaction_ids, patch=patch)
        return {"updated_count": len(transaction_ids), "updated_transactions": []}

    monkeypatch.setattr(api, "save_spiir_local_ledger_overrides", save)
    response = _client().post(
        "/api/spiir/local-ledger/overrides",
        json={
            "transaction_ids": [" tx-1 "],
            "patch": {
                "category": {
                    "categoryType": "Income",
                    "mainCategoryId": "income",
                    "mainCategoryName": "Indkomst",
                    "categoryId": "gifts",
                    "categoryName": "Pengegaver",
                },
                "pending_review": False,
            },
        },
    )

    assert response.status_code == 200
    assert captured == {
        "transaction_ids": ["tx-1"],
        "patch": {
            "category": {
                "categoryType": "Income",
                "mainCategoryId": "income",
                "mainCategoryName": "Indkomst",
                "categoryId": "gifts",
                "categoryName": "Pengegaver",
            },
            "pending_review": False,
        },
    }


def test_override_allows_explicit_category_clear(monkeypatch) -> None:
    captured: dict[str, object] = {}

    def save(transaction_ids: list[str], patch: dict[str, object]) -> dict[str, object]:
        captured.update(transaction_ids=transaction_ids, patch=patch)
        return {"updated_count": 1, "updated_transactions": []}

    monkeypatch.setattr(api, "save_spiir_local_ledger_overrides", save)
    response = _client().post(
        "/api/spiir/local-ledger/overrides",
        json={"transaction_ids": ["tx-1"], "patch": {"category": None}},
    )

    assert response.status_code == 200
    assert captured["patch"] == {"category": None}


def test_override_rejects_invalid_payloads() -> None:
    invalid_payloads = [
        {"transaction_ids": [], "patch": {"pending_review": False}},
        {"transaction_ids": ["   "], "patch": {"pending_review": False}},
        {"transaction_ids": ["tx-1"], "patch": {}},
        {"transaction_ids": ["tx-1"], "patch": {"pending_review": "false"}},
        {"transaction_ids": ["tx-1"], "patch": {"booking_date": "14-08-2026"}},
        {"transaction_ids": ["tx-1"], "patch": {"unknown": True}},
    ]

    client = _client()
    for payload in invalid_payloads:
        response = client.post("/api/spiir/local-ledger/overrides", json=payload)
        assert response.status_code == 422, response.text


def test_override_domain_errors_are_bad_requests(monkeypatch) -> None:
    def fail(_transaction_ids: list[str], _patch: dict[str, object]) -> dict[str, object]:
        raise ValueError("Unknown local ledger transaction: missing")

    monkeypatch.setattr(api, "save_spiir_local_ledger_overrides", fail)
    response = _client().post(
        "/api/spiir/local-ledger/overrides",
        json={"transaction_ids": ["missing"], "patch": {"pending_review": False}},
    )

    assert response.status_code == 400
    assert response.json() == {"detail": "Unknown local ledger transaction: missing"}
