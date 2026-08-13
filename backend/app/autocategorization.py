from __future__ import annotations

import datetime as dt
import re
from typing import Any

from .taxonomy import (
    SKIP_MAIN_CATEGORY_NAMES,
    UNCATEGORIZED_CATEGORY_ID,
    UNCATEGORIZED_CATEGORY_NAME,
    UNCATEGORIZED_MAIN_CATEGORY_ID,
    UNCATEGORIZED_MAIN_CATEGORY_NAME,
)

NON_LETTER_RE = re.compile(r"[^a-zæøå]+")
STOP_WORDS = {
    "aps", "as", "betaling", "betalingsservice", "bgs", "bs", "butikk",
    "dankort", "dkk", "den", "dk", "fra", "gen", "kort", "konto", "koeb",
    "køb", "mastercard", "mobilepay", "nota", "overfoersel", "overførsel",
    "pending", "scti", "til", "usd", "visa", "vipps",
}
MIN_LEDGER_AUTOCATEGORY_CONFIDENCE = 0.92
MIN_LEDGER_AUTOCATEGORY_SUPPORT = 2


def _normalize_lookup_text(*values: Any) -> str:
    raw = " ".join(str(value or "") for value in values).lower().replace("&", " og ")
    tokens = [
        token
        for token in NON_LETTER_RE.sub(" ", raw).split()
        if len(token) >= 3 and token not in STOP_WORDS
    ]
    return " ".join(dict.fromkeys(tokens))


def _ledger_lookup_key(row: dict[str, Any]) -> str:
    return _normalize_lookup_text(
        row.get("description"),
        row.get("original_description"),
        row.get("counterparty"),
        row.get("comment"),
    )


def _bank_lookup_key(transaction: dict[str, Any]) -> str:
    return _normalize_lookup_text(
        transaction.get("description"),
        transaction.get("remittance_information"),
        transaction.get("creditor_name"),
        transaction.get("debtor_name"),
    )


def _auto_category(main_name: str, category_name: str, category_type: str = "Expense") -> dict[str, Any]:
    slug = re.sub(r"[^a-z0-9]+", "-", f"{main_name}-{category_name}".lower()).strip("-")
    main_slug = re.sub(r"[^a-z0-9]+", "-", main_name.lower()).strip("-")
    return {
        "categoryType": category_type,
        "mainCategoryId": f"auto-main:{main_slug}",
        "mainCategoryName": main_name,
        "categoryId": f"auto:{slug}",
        "categoryName": category_name,
    }


AUTO_CATEGORY_RULES: list[tuple[re.Pattern[str], dict[str, Any], float]] = [
    (re.compile(r"\boverskydende skat\b", re.I), _auto_category("Indkomst", "Overskydende skat", "Income"), 0.99),
    (re.compile(r"\b(netto|rema\s*1000|365\s|coop|f[øo]tex|kvickly|superbrugsen|sbrugsen|spar\s|aarstiderne|nemlig|lidl|meny|asia bazar)\b", re.I), _auto_category("Husholdning", "Dagligvarer"), 0.98),
    (re.compile(r"\b(bageri|bageriet|lagkagehuset|hart |br[øo]dkunsten|collective bakery|patisserie|bread station|7-eleven|siciliansk is)\b", re.I), _auto_category("Husholdning", "Kiosk, bager & specialbutikker"), 0.96),
    (re.compile(r"\b(kantinen|kantine)\b", re.I), _auto_category("Husholdning", "Kantine- & frokostordning"), 0.98),
    (re.compile(r"\b(rejsekort|dsb|metro|movia|dot billetter)\b", re.I), _auto_category("Transport", "Bus, tog, færge o.l."), 0.99),
    (re.compile(r"\b(easy\s*park|q-?park|parkman|apcoa)\b", re.I), _auto_category("Transport", "Parkering"), 0.98),
    (re.compile(r"\b(circle k|shell|ingo|ok benzin|q8|uno-x)\b", re.I), _auto_category("Transport", "Brændstof"), 0.95),
    (re.compile(r"\b(wolt|just\s*eat|pizz|mcd|burger|sushi|stefanos|tgtg|toogoodtogo)\w*", re.I), _auto_category("Privatforbrug", "Fastfood & takeaway"), 0.96),
    (re.compile(r"\b(cafe|kaffe|coffee|kaffebar|restaurant|mokkari|impact roasters|minas)\w*", re.I), _auto_category("Privatforbrug", "Bar, cafe & restaurant"), 0.93),
    (re.compile(r"\b(apotek|dinapoteker|pharmacy)\w*", re.I), _auto_category("Andre leveomkostninger", "Apotek & medicin"), 0.99),
    (re.compile(r"\b(fysio|fysioterapi|sansefys|kiropraktor|tandl[æa]ge|l[æa]ge|slyngejordemoder)\b", re.I), _auto_category("Andre leveomkostninger", "Behandling & læger"), 0.97),
    (re.compile(r"\b(sygeforsikringen|danmark)\b", re.I), _auto_category("Andre leveomkostninger", "Sundheds- & sygeforsikring"), 0.97),
    (re.compile(r"\b(a-kasse|akademikernes|ase l[øo]nmodtager|frie skolers l[æa]rerforening|fagforening)\b", re.I), _auto_category("Andre leveomkostninger", "Fagforening & a-kasse"), 0.98),
    (re.compile(r"\b(cbb mobil|telmore|yousee|telenor|3 mobil|oister|parknet)\b", re.I), _auto_category("Andre leveomkostninger", "Telefoni & internet"), 0.98),
    (re.compile(r"\b(netflix|hbo|viaplay|tv2|disney\+|spotify|audible)\b", re.I), _auto_category("Andre leveomkostninger", "TV & streaming"), 0.98),
    (re.compile(r"\b(openai|chatgpt|microsoft|google one|google photos|apple\.com/bill|dropbox|adobe|kindle)\w*", re.I), _auto_category("Privatforbrug", "Online services & software"), 0.94),
    (re.compile(r"\b(elgiganten|proshop|avxperten|compumail|power\.dk)\b", re.I), _auto_category("Privatforbrug", "Elektronik & computerudstyr"), 0.95),
    (re.compile(r"\b(zalando|adidas|h&m|magasin|sport 24|boozt)\b", re.I), _auto_category("Privatforbrug", "Tøj, sko & accessories"), 0.93),
    (re.compile(r"\b(babysam|reshopper|momkind|pumkins|pumpkins)\b", re.I), _auto_category("Privatforbrug", "Babyudstyr"), 0.94),
    (re.compile(r"\b(ikea|jem\s*&\s*fix|silvan|jysk)\b", re.I), _auto_category("Bolig", "Ombygning & vedligehold"), 0.93),
    (re.compile(r"\b(matas|normal kbh|fris[øo]r)\b", re.I), _auto_category("Privatforbrug", "Frisør & personlig pleje"), 0.91),
    (re.compile(r"\b(zoo|dgi byen|biograf|cinemaxx|tivoli|family zoo)\b", re.I), _auto_category("Privatforbrug", "Biograf, koncerter & forlystelser"), 0.92),
    (re.compile(r"\b(blomster|interflora|f[øo]dselsdagsgave|afskedsgave|gave til)\b", re.I), _auto_category("Privatforbrug", "Gaver & velgørenhed"), 0.94),
    (re.compile(r"\b(javid cuts|fris[øo]r)\b", re.I), _auto_category("Privatforbrug", "Frisør & personlig pleje"), 0.96),
    (re.compile(r"\b(tr[æa]ning|pulscph|fitness)\b", re.I), _auto_category("Privatforbrug", "Sport & fritid"), 0.94),
    (re.compile(r"\b(garn|bog\s*&\s*id[ée]|panduro)\b", re.I), _auto_category("Privatforbrug", "Hobby & sportsudstyr"), 0.91),
    (re.compile(r"\b(rente af g[æa]ld|provision af maksimum)\b", re.I), _auto_category("Bolig", "Boliglån & renter"), 0.99),
    (re.compile(r"\bbankgebyr\b", re.I), _auto_category("Diverse", "Bankgebyrer"), 0.98),
    (re.compile(r"\b(personskatte|restskat)\b", re.I), _auto_category("Diverse", "Restskat"), 0.98),
    (re.compile(r"\b(adm\.service fyn|p\.\s*g\.\s*administration)\b", re.I), _auto_category("Bolig", "Ejerforening"), 0.96),
    (re.compile(r"\bk[øo]benhavns kommune\b", re.I), _auto_category("Andre leveomkostninger", "Institution"), 0.91),
]

INVESTMENT_TRANSFER_RULES: list[tuple[re.Pattern[str], dict[str, Any]]] = [
    (re.compile(r"\b(b[øo]rneopsparing|matteo aktier)\b", re.I), _auto_category("Investering & pension", "Børneopsparing", "Investment")),
    (re.compile(r"\b(pension|ratepension|aldersopsparing)\b", re.I), _auto_category("Investering & pension", "Pension", "Investment")),
    (re.compile(r"\b(penge til aktier|penge til nordnet(?: skat)?|nordnet|saxo bank)\b", re.I), _auto_category("Investering & pension", "Investering", "Investment")),
]

CHILD_SAVINGS_PERSON_RE = re.compile(r"\b(matteo pesando myhrmann|chiara pesando myhrmann)\b", re.I)
STRONG_INTERNAL_TRANSFER_RE = re.compile(
    r"^(overf[øo]rsel|midlertidige penge|penge til f[æa]lles|til budgetkonto|til andelsprioritet|penge bolig(?: jacob)?|penge jacob|f[æa]lles|fie)$",
    re.I,
)
TRANSFER_HINT_RE = re.compile(r"\b(overf[øo]rsel|penge|f[æa]lles|budgetkonto|andelsprioritet|opsparing|aktier)\b", re.I)


def _set_row_category(row: dict[str, Any], category: dict[str, Any], source: str) -> None:
    row["category_type"] = category.get("categoryType") or "Expense"
    row["main_category_id"] = category.get("mainCategoryId") or UNCATEGORIZED_MAIN_CATEGORY_ID
    row["main_category_name"] = category.get("mainCategoryName") or UNCATEGORIZED_MAIN_CATEGORY_NAME
    row["category_id"] = category.get("categoryId") or UNCATEGORIZED_CATEGORY_ID
    row["category_name"] = category.get("categoryName") or UNCATEGORIZED_CATEGORY_NAME
    row["is_excluded"] = row["main_category_name"] in SKIP_MAIN_CATEGORY_NAMES
    row["category_source"] = source
    row["category_reason"] = None
    row["category_confidence"] = None


def _row_category(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "categoryType": row.get("category_type") or "Expense",
        "mainCategoryId": row.get("main_category_id") or UNCATEGORIZED_MAIN_CATEGORY_ID,
        "mainCategoryName": row.get("main_category_name") or UNCATEGORIZED_MAIN_CATEGORY_NAME,
        "categoryId": row.get("category_id") or UNCATEGORIZED_CATEGORY_ID,
        "categoryName": row.get("category_name") or UNCATEGORIZED_CATEGORY_NAME,
    }


def _is_uncategorized_category(main_category_id: Any, category_id: Any) -> bool:
    return (
        str(main_category_id or "") == str(UNCATEGORIZED_MAIN_CATEGORY_ID)
        or str(category_id or "") == str(UNCATEGORIZED_CATEGORY_ID)
    )


def _paired_internal_transfer_ids(rows: list[dict[str, Any]]) -> set[str]:
    by_amount: dict[int, list[dict[str, Any]]] = {}
    for row in rows:
        if str(row.get("source") or "") != "nordea":
            continue
        amount = float(row.get("amount") or 0)
        if abs(amount) < 0.005:
            continue
        by_amount.setdefault(int(round(abs(amount) * 100)), []).append(row)

    paired: set[str] = set()
    for candidates in by_amount.values():
        positives = [row for row in candidates if float(row.get("amount") or 0) > 0]
        negatives = [row for row in candidates if float(row.get("amount") or 0) < 0]
        used_positive_ids: set[str] = set()
        for negative in negatives:
            try:
                negative_date = dt.date.fromisoformat(str(negative.get("date")))
            except ValueError:
                continue
            matches: list[tuple[int, dict[str, Any]]] = []
            for positive in positives:
                positive_id = str(positive.get("id") or "")
                if positive_id in used_positive_ids or positive.get("source_account_id") == negative.get("source_account_id"):
                    continue
                try:
                    positive_date = dt.date.fromisoformat(str(positive.get("date")))
                except ValueError:
                    continue
                day_distance = abs((positive_date - negative_date).days)
                if day_distance > 2:
                    continue
                positive_hint = bool(TRANSFER_HINT_RE.search(str(positive.get("description") or "")))
                negative_hint = bool(TRANSFER_HINT_RE.search(str(negative.get("description") or "")))
                if not positive_hint and not negative_hint:
                    continue
                matches.append(((int(positive_hint) + int(negative_hint)) * 10 + (2 - day_distance), positive))
            if matches:
                _, positive = max(matches, key=lambda item: item[0])
                positive_id = str(positive.get("id") or "")
                used_positive_ids.add(positive_id)
                paired.update({positive_id, str(negative.get("id") or "")})
    return paired


def _autocategorize_rows(rows: list[dict[str, Any]], now: str) -> dict[str, int]:
    paired_transfer_ids = _paired_internal_transfer_ids(rows)
    counts = {
        "categorized_count": 0,
        "transfer_count": 0,
        "income_count": 0,
        "investment_count": 0,
        "child_savings_account_count": 0,
    }

    for row in rows:
        if str(row.get("source") or "") != "nordea" or row.get("splits"):
            continue
        description = str(row.get("description") or "").strip()

        if CHILD_SAVINGS_PERSON_RE.search(str(row.get("source_account_name") or "")):
            child_category = _auto_category("Vis ikke", "Børneopsparingskonto")
            if _row_category(row) != child_category or not bool(row.get("is_excluded")):
                _set_row_category(row, child_category, "autocategorization")
                row.update(pending_review=False, category_reason="child_savings_account_activity", category_confidence=1.0, updated_at=now)
                counts["categorized_count"] += 1
                counts["transfer_count"] += 1
                counts["child_savings_account_count"] += 1
            continue

        search_text = " ".join((description, str(row.get("original_description") or ""), str(row.get("counterparty") or "")))
        named_child_recipient = float(row.get("amount") or 0) < 0 and bool(CHILD_SAVINGS_PERSON_RE.search(str(row.get("counterparty") or "")))
        investment_category = _auto_category("Investering & pension", "Børneopsparing", "Investment") if named_child_recipient else next(
            (category for pattern, category in INVESTMENT_TRANSFER_RULES if pattern.search(search_text)), None
        )
        if investment_category is not None and str(row.get("category_source") or "") != "manual":
            if _row_category(row) != investment_category or bool(row.get("pending_review")):
                _set_row_category(row, investment_category, "autocategorization")
                row.update(pending_review=False, category_reason="investment_transfer", category_confidence=0.99, updated_at=now)
                counts["categorized_count"] += 1
                counts["investment_count"] += 1
            continue

        if not bool(row.get("pending_review")):
            continue

        category: dict[str, Any] | None = None
        confidence = 0.0
        reason = ""
        if str(row.get("category_type") or "Expense") == "Income":
            category, confidence, reason = _row_category(row), 0.99, "strong_income_description"
            counts["income_count"] += 1
        elif str(row.get("id") or "") in paired_transfer_ids or STRONG_INTERNAL_TRANSFER_RE.fullmatch(description):
            category, confidence, reason = _auto_category("Vis ikke", "Kontooverførsel"), 0.99, "own_account_transfer"
            counts["transfer_count"] += 1
        elif _is_uncategorized_category(row.get("main_category_id"), row.get("category_id")):
            for pattern, rule_category, rule_confidence in AUTO_CATEGORY_RULES:
                if pattern.search(search_text):
                    category, confidence, reason = rule_category, rule_confidence, f"merchant_rule:{pattern.pattern}"
                    break

        if category is None or confidence < 0.9:
            continue
        _set_row_category(row, category, "autocategorization")
        row.update(pending_review=False, category_reason=reason, category_confidence=confidence, updated_at=now)
        counts["categorized_count"] += 1

    return counts


def _ledger_category_payload(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "categoryType": str(row.get("category_type") or "Expense"),
        "mainCategoryId": str(row.get("main_category_id") or UNCATEGORIZED_MAIN_CATEGORY_ID),
        "mainCategoryName": str(row.get("main_category_name") or UNCATEGORIZED_MAIN_CATEGORY_NAME),
        "categoryId": str(row.get("category_id") or UNCATEGORIZED_CATEGORY_ID),
        "categoryName": str(row.get("category_name") or UNCATEGORIZED_CATEGORY_NAME),
    }


def _suggest_categories_from_ledger(
    *, ledger_rows: list[dict[str, Any]], candidate_transactions: list[dict[str, Any]]
) -> dict[str, dict[str, Any]]:
    votes_by_key: dict[str, dict[str, int]] = {}
    categories_by_key: dict[str, dict[str, Any]] = {}
    for row in ledger_rows:
        if str(row.get("source") or "") not in {"spiir", "nordea"} or bool(row.get("pending_review")) or row.get("splits"):
            continue
        if _is_uncategorized_category(row.get("main_category_id"), row.get("category_id")):
            continue
        lookup_key = _ledger_lookup_key(row)
        if not lookup_key:
            continue
        category = _ledger_category_payload(row)
        category_key = f"{category['mainCategoryId']}|{category['categoryId']}"
        categories_by_key[category_key] = category
        votes = votes_by_key.setdefault(lookup_key, {})
        votes[category_key] = votes.get(category_key, 0) + 1

    suggestions: dict[str, dict[str, Any]] = {}
    for transaction in candidate_transactions:
        if not _is_uncategorized_category(transaction.get("mainCategoryId"), transaction.get("categoryId")):
            continue
        votes = votes_by_key.get(_bank_lookup_key(transaction)) or {}
        if not votes:
            continue
        total = sum(votes.values())
        top_category_key, top_support = max(votes.items(), key=lambda item: item[1])
        confidence = top_support / total if total > 0 else 0.0
        if top_support < MIN_LEDGER_AUTOCATEGORY_SUPPORT or confidence < MIN_LEDGER_AUTOCATEGORY_CONFIDENCE:
            continue
        transaction_id = str(transaction.get("id") or "").strip()
        category = categories_by_key.get(top_category_key)
        if transaction_id and category:
            suggestions[transaction_id] = category
    return suggestions
