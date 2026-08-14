from __future__ import annotations

from datetime import UTC, date, datetime
from typing import Annotated, Self

from fastapi import FastAPI, HTTPException, Query, status
from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    StrictBool,
    StringConstraints,
    model_validator,
)

from .config import get_data_dir
from .enable_banking_service import (
    get_bank_retrieve_status,
    load_ledger_taxonomy,
    start_bank_retrieve_job,
)
from .spiir_local_ledger_service import (
    apply_spiir_local_ledger_import,
    apply_spiir_local_ledger_split_canonicalization,
    apply_spiir_local_ledger_split_fragment_repair,
    load_spiir_local_ledger_transactions,
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

NonEmptyString = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]
HashtagString = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]
CategoryId = NonEmptyString | int


class ApiRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")


class LedgerCategoryRequest(ApiRequest):
    categoryType: NonEmptyString
    mainCategoryId: CategoryId | None = None
    mainCategoryName: NonEmptyString
    categoryId: CategoryId
    categoryName: NonEmptyString


class LedgerSplitRequest(ApiRequest):
    id: NonEmptyString
    amount: float = Field(allow_inf_nan=False)
    note: str = ""
    category: LedgerCategoryRequest


class LedgerOverridePatchRequest(ApiRequest):
    category: LedgerCategoryRequest | None = None
    booking_date: date | None = None
    note: str = ""
    hashtags: list[HashtagString] = Field(default_factory=list)
    append_hashtags: list[HashtagString] = Field(default_factory=list)
    remove_hashtags: list[HashtagString] = Field(default_factory=list)
    is_extraordinary: StrictBool = False
    pending_review: StrictBool = False
    splits: list[LedgerSplitRequest] = Field(default_factory=list)

    @model_validator(mode="after")
    def require_a_change(self) -> Self:
        if not self.model_fields_set:
            raise ValueError("Override patch must contain at least one change")
        return self


class LedgerOverrideRequest(ApiRequest):
    transaction_ids: list[NonEmptyString] = Field(min_length=1)
    patch: LedgerOverridePatchRequest


def iso_utc() -> str:
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")


def create_app() -> FastAPI:
    app = FastAPI(title="Spiir Alternative API", version="0.2.0")

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
    def local_ledger_overrides(payload: LedgerOverrideRequest) -> dict[str, object]:
        try:
            patch = payload.patch.model_dump(mode="json", exclude_unset=True)
            return save_spiir_local_ledger_overrides(payload.transaction_ids, patch)
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

    @app.get("/api/ledger/taxonomy")
    def ledger_taxonomy() -> dict[str, object]:
        return load_ledger_taxonomy()

    @app.post("/api/bank/retrieve/start")
    def bank_retrieve_start() -> dict[str, object]:
        return start_bank_retrieve_job(sync_local_ledger=True)

    @app.get("/api/bank/retrieve/status")
    def bank_retrieve_status() -> dict[str, object]:
        return get_bank_retrieve_status()

    return app


app = create_app()
