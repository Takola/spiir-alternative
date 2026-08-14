from __future__ import annotations

import re
import unicodedata
from typing import Any

CATEGORY_CATALOG: dict[str, list[str]] = {
    "Bolig": ["Boliglån/husleje", "El, vand, varme & renovation", "Ejerforening", "Ejendomsskat", "Husforsikring", "Indbo- & familieforsikring", "Alarmsystem", "Udgifter fritidshus", "Ombygning & vedligehold", "Have & planter", "Andre boligudgifter"],
    "Transport": ["Bil-, MC-, bådlån o.l.", "Brændstof", "Bilforsikring & autohjælp", "Ejerafgift/grøn afgift", "Bus, tog, færge o.l.", "Taxi", "Parkering", "Værksted & reservedele", "Anden transport"],
    "Husholdning": ["Dagligvarer", "Kiosk, bager & specialbutikker", "Kantine- & frokostordning"],
    "Andre leveomkostninger": ["Apotek & medicin", "Behandling & læger", "Underholds- & børnebidrag", "Institution", "Fagforening & a-kasse", "Livs- & ulykkesforsikring", "Sundheds- & sygeforsikring", "Briller & kontaktlinser", "TV & streaming", "Telefoni & internet", "Studieudgifter", "Foreninger & kontingenter"],
    "Privatforbrug": ["Fastfood & takeaway", "Bar, cafe & restaurant", "Tøj, sko & accessories", "Møbler & boligudstyr", "Elektronik & computerudstyr", "Film, musik & læsestof", "Online services & software", "Hobby & sportsudstyr", "Biograf, koncerter & forlystelser", "Frisør & personlig pleje", "Sport & fritid", "Hus & havehjælp", "Spil & legetøj", "Tips & lotto", "Babyudstyr", "Kæledyr", "Gaver & velgørenhed", "Gavekort", "Tobak & alkohol", "Kontanthævning & check", "Højskole- & kursusophold", "Serviceydelser & rådgivning", "Andet privatforbrug"],
    "Ferie": ["Fly & Hotel", "Billeje", "Sommerhus & camping", "Ferieaktiviteter", "Rejseforsikring"],
    "Diverse": ["Ukendt", "Bankgebyrer", "Rykkergebyrer", "Bøder & afgifter", "Restskat", "Offentligt gebyr", "Ikke kategoriseret"],
    "Lån & gæld": ["Studielån", "Forbrugslån", "Private lån (venner & familie)", "Udlånsrenter"],
    "Pension & Opsparing": ["Pensionsopsparing", "Børneopsparing", "Anden opsparing", "Værdipapirshandel"],
    "Indkomst": ["Løn", "Pensionsudbetaling", "Dagpenge/overførselsindkomst", "SU & studielån", "Børnepenge", "Underholds- & børnebidrag", "Feriepenge", "Renteindtægter", "Udbytte & afkast", "Overskydende skat", "Boligstøtte", "Anden indkomst", "Pengegaver"],
    "Vis ikke": ["Kontooverførsel", "Udlæg", "Ignorer"],
}

CATEGORY_TYPES = {"Indkomst": "Income", "Pension & Opsparing": "Investment"}

SKIP_MAIN_CATEGORY_NAMES = {"Vis ikke"}
UNCATEGORIZED_MAIN_CATEGORY_NAME = "Diverse"
UNCATEGORIZED_MAIN_CATEGORY_ID = "synthetic-diverse"
UNCATEGORIZED_CATEGORY_NAME = "Ikke kategoriseret"
UNCATEGORIZED_CATEGORY_ID = "synthetic-uncategorized"


def _slug(value: str) -> str:
    ascii_value = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode("ascii")
    return re.sub(r"[^a-z0-9]+", "-", ascii_value.lower()).strip("-")


def canonical_taxonomy_main_name(value: Any) -> str:
    main_name = str(value or UNCATEGORIZED_MAIN_CATEGORY_NAME)
    return "Andre leveomkostninger" if main_name == "Andet" else main_name


def built_in_categories() -> list[dict[str, Any]]:
    categories: list[dict[str, Any]] = []
    for main_name, category_names in CATEGORY_CATALOG.items():
        main_id = f"spiir-main:{_slug(main_name)}"
        category_type = CATEGORY_TYPES.get(main_name, "Expense")
        for category_name in category_names:
            categories.append(
                {
                    "categoryType": category_type,
                    "mainCategoryId": main_id,
                    "mainCategoryName": main_name,
                    "categoryId": f"spiir:{_slug(main_name)}:{_slug(category_name)}",
                    "categoryName": category_name,
                    "usage_count": 0,
                }
            )
    return categories
