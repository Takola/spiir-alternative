from app.taxonomy import built_in_categories, canonical_taxonomy_main_name


def test_legacy_andet_main_category_uses_catalog_name() -> None:
    assert canonical_taxonomy_main_name("Andet") == "Andre leveomkostninger"
    assert canonical_taxonomy_main_name("Andre leveomkostninger") == "Andre leveomkostninger"


def test_gavekort_is_a_privatforbrug_category() -> None:
    assert any(
        category["mainCategoryName"] == "Privatforbrug" and category["categoryName"] == "Gavekort"
        for category in built_in_categories()
    )
