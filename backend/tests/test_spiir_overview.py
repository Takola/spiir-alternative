from __future__ import annotations

import pandas as pd

from app.spiir_service import _make_period_overview


def test_difference_excludes_investments() -> None:
    period = "2025-10"
    frame = pd.DataFrame(
        [
            {
                "yyyymm": period,
                "amount": 65488.0,
                "categoryType": "Income",
                "mainCategoryName": "Indkomst",
                "mainCategoryId": "income",
                "categoryName": "Løn",
                "categoryId": "salary",
                "comment": "",
                "hashtags": [],
            },
            {
                "yyyymm": period,
                "amount": -23815.0,
                "categoryType": "Expense",
                "mainCategoryName": "Diverse",
                "mainCategoryId": "expense",
                "categoryName": "Andet",
                "categoryId": "other",
                "comment": "",
                "hashtags": [],
            },
            {
                "yyyymm": period,
                "amount": -40400.0,
                "categoryType": "Investment",
                "mainCategoryName": "Investering & pension",
                "mainCategoryId": "investment",
                "categoryName": "Investering",
                "categoryId": "stocks",
                "comment": "",
                "hashtags": [],
            },
        ]
    )

    overview = _make_period_overview(frame, [period], "yyyymm")
    difference = next(row for row in overview["rows"] if row["key"] == "diff")

    assert difference["label"] == "Result"
    assert difference["values"][period] == 41673


def _expense_row(period: str, amount: float, description: str) -> dict[str, object]:
    return {
        "yyyymm": period,
        "amount": amount,
        "categoryType": "Expense",
        "mainCategoryName": "Privatforbrug",
        "mainCategoryId": "private",
        "categoryName": "Bar, cafe & restaurant",
        "categoryId": "restaurant",
        "comment": description,
        "hashtags": [],
    }


def test_positive_expense_reimbursement_offsets_the_original_cost() -> None:
    period = "2026-08"
    frame = pd.DataFrame(
        [
            _expense_row(period, -1000, "Dinner paid for the group"),
            _expense_row(period, 1000, "MobilePay reimbursement"),
        ]
    )

    overview = _make_period_overview(frame, [period], "yyyymm")
    expense = next(row for row in overview["rows"] if row["key"] == "expense")

    assert expense["values"][period] == 0


def test_refund_and_repurchase_count_only_the_final_purchase() -> None:
    period = "2026-08"
    frame = pd.DataFrame(
        [
            _expense_row(period, -9000, "Original purchase"),
            _expense_row(period, 9000, "Refund to account"),
            _expense_row(period, -9000, "Repurchase with gift card"),
        ]
    )

    overview = _make_period_overview(frame, [period], "yyyymm")
    expense = next(row for row in overview["rows"] if row["key"] == "expense")

    assert expense["values"][period] == -9000
