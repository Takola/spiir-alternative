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

    assert difference["label"] == "Difference"
    assert difference["values"][period] == 41673
