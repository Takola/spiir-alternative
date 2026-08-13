from __future__ import annotations

from app.spiir_local_ledger_service import _autocategorize_rows


def row(
    transaction_id: str,
    description: str,
    amount: float,
    account: str,
    *,
    date: str = "2026-08-11",
    category_type: str = "Expense",
    counterparty: str | None = None,
    account_name: str = "",
) -> dict[str, object]:
    return {
        "id": transaction_id,
        "source": "nordea",
        "source_account_id": account,
        "source_account_name": account_name,
        "date": date,
        "amount": amount,
        "description": description,
        "original_description": description,
        "counterparty": counterparty,
        "category_type": category_type,
        "main_category_id": "synthetic-diverse" if category_type == "Expense" else "synthetic-income",
        "main_category_name": "Diverse" if category_type == "Expense" else "Indkomst",
        "category_id": "synthetic-uncategorized" if category_type == "Expense" else "synthetic-income-default",
        "category_name": "Ikke kategoriseret" if category_type == "Expense" else "Løn og ydelser",
        "pending_review": True,
        "splits": [],
    }


def test_autocategorizes_known_merchant_and_leaves_unknown_pending() -> None:
    rows = [
        row("netto", "Kontaktløs Dankort Netto Tagensvej", -125.5, "a"),
        row("unknown", "MobilePay Some New Person", -125.5, "a"),
    ]

    result = _autocategorize_rows(rows, "now")

    assert result["categorized_count"] == 1
    assert rows[0]["category_name"] == "Dagligvarer"
    assert rows[0]["pending_review"] is False
    assert rows[1]["category_name"] == "Ikke kategoriseret"
    assert rows[1]["pending_review"] is True


def test_mortgage_interest_and_credit_limit_fee_are_housing_debt_costs() -> None:
    rows = [
        row("interest", "Rente af gæld", -3779.22, "home"),
        row("limit-fee", "Provision af maksimum", -791.58, "home"),
    ]

    result = _autocategorize_rows(rows, "now")

    assert result["categorized_count"] == 2
    assert all(item["main_category_name"] == "Bolig" for item in rows)
    assert all(item["category_name"] == "Boliglån & renter" for item in rows)


def test_pairs_only_transfer_like_cross_account_transactions() -> None:
    rows = [
        row("transfer-out", "Til Budgetkonto", -1000, "wife"),
        row("transfer-in", "Overførsel", 1000, "shared"),
        row("purchase", "Bageriet Blond", -50, "wife"),
        row("refund", "Klarna Thaibutikken", 50, "husband"),
    ]

    result = _autocategorize_rows(rows, "now")

    assert result["transfer_count"] == 2
    assert rows[0]["main_category_name"] == "Vis ikke"
    assert rows[1]["main_category_name"] == "Vis ikke"
    assert rows[2]["main_category_name"] != "Vis ikke"
    assert rows[3]["main_category_name"] != "Vis ikke"


def test_accepts_strong_income_detection_without_manual_review() -> None:
    rows = [row("salary", "Lønoverførsel", 42000, "husband", category_type="Income")]

    result = _autocategorize_rows(rows, "now")

    assert result["income_count"] == 1
    assert rows[0]["pending_review"] is False
    assert rows[0]["category_type"] == "Income"


def test_stock_transfer_is_investment_even_when_previously_reviewed_as_expense() -> None:
    investment = row("stocks", "Penge til aktier", -20000, "husband")
    investment["pending_review"] = False
    investment["category_source"] = "autocategorization"
    investment["main_category_name"] = "Pension & Opsparing"
    investment["category_name"] = "Anden opsparing"

    result = _autocategorize_rows([investment], "now")

    assert result["investment_count"] == 1
    assert investment["category_type"] == "Investment"
    assert investment["main_category_name"] == "Investering & pension"
    assert investment["category_name"] == "Investering"
    assert investment["pending_review"] is False


def test_investment_rule_does_not_replace_manual_category() -> None:
    investment = row("manual", "Penge til aktier", -20000, "husband")
    investment["pending_review"] = False
    investment["category_source"] = "manual"

    result = _autocategorize_rows([investment], "now")

    assert result["investment_count"] == 0
    assert investment["category_type"] == "Expense"


def test_saxo_dot_com_bookstore_is_not_classified_as_investment() -> None:
    bookstore = row("saxo-bookstore", "MobilePay køb MobilePay Saxo.com", -1304.80, "wife")

    result = _autocategorize_rows([bookstore], "now")

    assert result["investment_count"] == 0
    assert bookstore["category_type"] == "Expense"
    assert bookstore["main_category_name"] == "Diverse"
    assert bookstore["pending_review"] is True


def test_generic_transfer_to_named_child_is_child_savings() -> None:
    transfer = row(
        "matteo-savings",
        "Penge",
        -6000,
        "father",
        date="2025-01-02",
        counterparty="Matteo Pesando Myhrmann",
        account_name="Jacob Valdemar Pesando",
    )

    result = _autocategorize_rows([transfer], "now")

    assert result["investment_count"] == 1
    assert transfer["category_type"] == "Investment"
    assert transfer["main_category_name"] == "Investering & pension"
    assert transfer["category_name"] == "Børneopsparing"
    assert transfer["pending_review"] is False


def test_activity_on_child_savings_account_is_excluded() -> None:
    movement = row(
        "child-account-movement",
        "Indbetaling",
        6000,
        "matteo-account",
        account_name="Matteo Pesando Myhrmann",
    )

    result = _autocategorize_rows([movement], "now")

    assert result["child_savings_account_count"] == 1
    assert movement["main_category_name"] == "Vis ikke"
    assert movement["category_name"] == "Børneopsparingskonto"
    assert movement["is_excluded"] is True
    assert movement["pending_review"] is False
