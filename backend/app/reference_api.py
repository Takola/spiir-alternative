from __future__ import annotations

from datetime import UTC, datetime
from typing import Annotated, Any

from fastapi import FastAPI, HTTPException, Query, status

from .config import get_data_dir
from .nordea_service import (
    get_nordea_retrieve_status,
    load_nordea_taxonomy,
    load_nordea_transactions,
    refresh_nordea_account_balances,
    retrieve_nordea_transactions,
    save_nordea_overrides,
    start_nordea_retrieve_job,
)
from .spiir_local_ledger_service import (
    apply_nordea_sync_into_spiir_local_ledger,
    apply_spiir_local_ledger_import,
    apply_spiir_local_ledger_split_canonicalization,
    apply_spiir_local_ledger_split_fragment_repair,
    load_spiir_local_ledger_transactions,
    preview_nordea_sync_into_spiir_local_ledger,
    preview_spiir_local_ledger_import,
    preview_spiir_local_ledger_split_canonicalization,
    preview_spiir_local_ledger_split_fragment_repair,
    save_spiir_local_ledger_overrides,
)
from .spiir_service import (
    get_spiir_status,
    load_spiir_income_expense_series,
    load_spiir_overview,
    load_spiir_transactions,
    read_spiir_update_log,
    rebuild_spiir_processed,
    schedule_spiir_rebuild_if_due,
)
from .storage import ensure_runtime_dirs


def iso_utc() -> str:
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")


def create_app() -> FastAPI:
    app = FastAPI(title="Spiir Alternative Reference API", version="0.1.0")

    @app.get("/api/status")
    def status_route() -> dict[str, object]:
        ensure_runtime_dirs()
        return {
            "status": "ok",
            "timestamp_utc": iso_utc(),
            "storage": {
                "data_dir": str(get_data_dir()),
            },
        }

    @app.get("/api/spiir/status")
    def spiir_status() -> dict[str, object]:
        payload = get_spiir_status()
        if payload.get("rebuild_required"):
            schedule_spiir_rebuild_if_due()
        return payload

    @app.post("/api/spiir/rebuild-from-local/schedule")
    def spiir_schedule_rebuild_from_local(delay_seconds: float = Query(10.0, ge=0, le=300)) -> dict[str, object]:
        return schedule_spiir_rebuild_if_due(delay_seconds=delay_seconds)

    @app.post("/api/spiir/rebuild-from-local")
    def spiir_rebuild_from_local() -> dict[str, object]:
        try:
            return rebuild_spiir_processed(source="local")
        except (FileNotFoundError, RuntimeError) as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    @app.get("/api/spiir/overview")
    def spiir_overview() -> dict[str, object]:
        try:
            return load_spiir_overview()
        except FileNotFoundError as exc:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc

    @app.get("/api/spiir/transactions")
    def spiir_transactions() -> list[dict[str, object]]:
        try:
            return load_spiir_transactions()
        except FileNotFoundError as exc:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc

    @app.get("/api/spiir/update-log")
    def spiir_update_log() -> str:
        return read_spiir_update_log()

    @app.get("/api/spiir/local-ledger/preview")
    def local_ledger_preview(sample_limit: Annotated[int, Query(ge=1, le=200)] = 25) -> dict[str, object]:
        try:
            return preview_spiir_local_ledger_import(sample_limit=sample_limit)
        except FileNotFoundError as exc:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc

    @app.post("/api/spiir/local-ledger/apply")
    def local_ledger_apply() -> dict[str, object]:
        try:
            return apply_spiir_local_ledger_import()
        except FileNotFoundError as exc:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc

    @app.get("/api/spiir/local-ledger/nordea-sync/preview")
    def nordea_sync_preview() -> dict[str, object]:
        try:
            return preview_nordea_sync_into_spiir_local_ledger()
        except (FileNotFoundError, ValueError) as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    @app.post("/api/spiir/local-ledger/nordea-sync/apply")
    def nordea_sync_apply() -> dict[str, object]:
        try:
            return apply_nordea_sync_into_spiir_local_ledger()
        except (FileNotFoundError, ValueError) as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    @app.get("/api/spiir/local-ledger/transactions")
    def local_ledger_transactions(
        limit: Annotated[int | None, Query(ge=1)] = None,
        offset: Annotated[int, Query(ge=0)] = 0,
    ) -> dict[str, object]:
        return load_spiir_local_ledger_transactions(limit=limit, offset=offset)

    @app.get("/api/spiir/local-ledger/income-expense-series")
    def local_ledger_income_expense_series() -> dict[str, object]:
        try:
            return load_spiir_income_expense_series()
        except (FileNotFoundError, ValueError) as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    @app.post("/api/spiir/local-ledger/overrides")
    def local_ledger_overrides(payload: dict[str, Any]) -> dict[str, object]:
        try:
            transaction_ids = [str(item) for item in payload.get("transaction_ids") or [] if str(item).strip()]
            patch = payload.get("patch", {})
            if not isinstance(patch, dict):
                raise ValueError("Invalid local ledger patch")
            return save_spiir_local_ledger_overrides(transaction_ids, patch)
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    @app.get("/api/spiir/local-ledger/splits/migration-preview")
    def split_migration_preview(sample_limit: Annotated[int, Query(ge=1, le=200)] = 25) -> dict[str, object]:
        return preview_spiir_local_ledger_split_canonicalization(sample_limit=sample_limit)

    @app.post("/api/spiir/local-ledger/splits/migration-apply")
    def split_migration_apply() -> dict[str, object]:
        return apply_spiir_local_ledger_split_canonicalization()

    @app.get("/api/spiir/local-ledger/splits/repair-preview")
    def split_repair_preview(sample_limit: Annotated[int, Query(ge=1, le=200)] = 25) -> dict[str, object]:
        return preview_spiir_local_ledger_split_fragment_repair(sample_limit=sample_limit)

    @app.post("/api/spiir/local-ledger/splits/repair-apply")
    def split_repair_apply() -> dict[str, object]:
        return apply_spiir_local_ledger_split_fragment_repair()

    @app.get("/api/nordea/transactions")
    def nordea_transactions() -> dict[str, object]:
        return load_nordea_transactions()

    @app.post("/api/nordea/refresh-balances")
    def nordea_refresh_balances() -> dict[str, int | str | None]:
        return refresh_nordea_account_balances()

    @app.get("/api/nordea/taxonomy")
    def nordea_taxonomy() -> dict[str, object]:
        return load_nordea_taxonomy()

    @app.post("/api/nordea/overrides")
    def nordea_overrides(payload: dict[str, Any]) -> dict[str, object]:
        try:
            transaction_ids = [str(item) for item in payload.get("transaction_ids", [])]
            patch = payload.get("patch", {})
            if not isinstance(patch, dict):
                raise ValueError("Invalid Nordea override patch")
            return save_nordea_overrides(transaction_ids, patch)
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    @app.post("/api/nordea/retrieve")
    def nordea_retrieve() -> dict[str, object]:
        try:
            return retrieve_nordea_transactions()
        except (FileNotFoundError, RuntimeError) as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    @app.post("/api/nordea/retrieve/start")
    def nordea_retrieve_start() -> dict[str, object]:
        return start_nordea_retrieve_job(sync_local_ledger=True)

    @app.get("/api/nordea/retrieve/status")
    def nordea_retrieve_status() -> dict[str, object]:
        return get_nordea_retrieve_status()

    return app


app = create_app()
