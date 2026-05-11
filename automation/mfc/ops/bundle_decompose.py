"""Pure function: ingredient bundle JSON → (ingredients-row, details-row, health-fact-rows).

Handles both legacy ({calories, protein, fat, carbs}) and USDA-rename
({energy_kcal, protein_g, total_fat_g, carbohydrate_g}) nutrition key
conventions. Output uses the new short names (calories / protein /
total_fat / carbohydrate / ...).
"""

from __future__ import annotations

from typing import Any


_INGREDIENT_FIELDS = (
    "id", "name", "aliases", "category", "tagline", "photo", "emoji",
    "default_unit", "show", "ai_filled_at", "created_by", "created_at", "updated_at",
)

# Legacy and USDA-rename → short-name normalization map for the nutrition jsonb.
_NUTRITION_RENAME: dict[str, str] = {
    # legacy 4-macros
    "calories": "calories",
    "protein": "protein",
    "fat": "total_fat",
    "carbs": "carbohydrate",
    # USDA-rename variants
    "energy_kcal": "calories",
    "energy_kj": "energy_kj",
    "water_g": "water",
    "protein_g": "protein",
    "total_fat_g": "total_fat",
    "carbohydrate_g": "carbohydrate",
    "ash_g": "ash",
    "alcohol_g": "alcohol",
    "saturated_fat_g": "saturated_fat",
    "monounsaturated_fat_g": "mono_fat",
    "polyunsaturated_fat_g": "poly_fat",
    "trans_fat_g": "trans_fat",
    "cholesterol_mg": "cholesterol",
    "fiber_total_g": "fiber",
    "fiber_soluble_g": "fiber_soluble",
    "fiber_insoluble_g": "fiber_insoluble",
    "sugars_total_g": "sugars",
    "sugars_added_g": "sugars_added",
    "starch_g": "starch",
    "calcium_mg": "calcium",
    "iron_mg": "iron",
    "magnesium_mg": "magnesium",
    "phosphorus_mg": "phosphorus",
    "potassium_mg": "potassium",
    "sodium_mg": "sodium",
    "zinc_mg": "zinc",
    "copper_mg": "copper",
    "manganese_mg": "manganese",
    "selenium_ug": "selenium",
    "fluoride_ug": "fluoride",
    "iodine_ug": "iodine",
    "vitamin_a_rae_ug": "vitamin_a",
    "vitamin_c_mg": "vitamin_c",
    "vitamin_d_ug": "vitamin_d",
    "vitamin_e_mg": "vitamin_e",
    "vitamin_k_ug": "vitamin_k",
    "thiamin_mg": "thiamin",
    "riboflavin_mg": "riboflavin",
    "niacin_mg": "niacin",
    "pantothenic_acid_mg": "pantothenic_acid",
    "vitamin_b6_mg": "vitamin_b6",
    "biotin_ug": "biotin",
    "folate_total_ug": "folate",
    "folate_dfe_ug": "folate_dfe",
    "vitamin_b12_ug": "vitamin_b12",
    "choline_mg": "choline",
    "tryptophan_g": "tryptophan",
    "threonine_g": "threonine",
    "isoleucine_g": "isoleucine",
    "leucine_g": "leucine",
    "lysine_g": "lysine",
    "methionine_g": "methionine",
    "cystine_g": "cystine",
    "phenylalanine_g": "phenylalanine",
    "tyrosine_g": "tyrosine",
    "valine_g": "valine",
    "arginine_g": "arginine",
    "histidine_g": "histidine",
    "alanine_g": "alanine",
    "aspartic_acid_g": "aspartic_acid",
    "glutamic_acid_g": "glutamic_acid",
    "glycine_g": "glycine",
    "proline_g": "proline",
    "serine_g": "serine",
    "fa_18_3_n3_alpha_linolenic_g": "pufa_18_3_n3_ala",
    "fa_20_5_n3_epa_g": "pufa_20_5_n3_epa",
    "fa_22_6_n3_dha_g": "pufa_22_6_n3_dha",
    "fa_18_2_n6_linoleic_g": "pufa_18_2_n6_la",
    "fa_20_4_n6_arachidonic_g": "pufa_20_4_n6_aa",
    "caffeine_mg": "caffeine",
    "theobromine_mg": "theobromine",
}


def decompose(bundle: dict[str, Any]) -> tuple[dict, dict | None, list[dict]]:
    """Split one bundle dict into (ingredients-row, details-row, health-fact-rows).

    details-row is None if the bundle has no detail-tier data at all.
    health-fact-rows is a list of {sort_order, fact} dicts.
    """
    ing = {k: bundle[k] for k in _INGREDIENT_FIELDS if k in bundle}
    nut = bundle.get("nutrition") or {}
    if isinstance(nut, dict):
        if nut.get("source"):
            ing["source"] = nut["source"]
        if nut.get("fdcId") is not None:
            ing["fdc_id"] = nut["fdcId"]
        if nut.get("fdc_id") is not None:
            ing["fdc_id"] = nut["fdc_id"]

    det: dict = {"id": bundle["id"]}
    if "storage" in bundle:
        det["storage"] = bundle["storage"]
    if "substitutes" in bundle:
        det["substitutes"] = bundle["substitutes"]
    if isinstance(nut, dict):
        if nut.get("per"):
            det["nutrition_per"] = nut["per"]
        if nut.get("filledAt"):
            det["nutrition_filled_at"] = nut["filledAt"]
        for k, v in nut.items():
            if k in ("source", "fdcId", "fdc_id", "filledAt", "aiFilledAt", "per"):
                continue
            short = _NUTRITION_RENAME.get(k)
            if short is not None and v is not None:
                det[short] = v

    has_data = any(k != "id" for k in det.keys())
    if not has_data:
        det = None

    facts: list[dict] = []
    if isinstance(bundle.get("health_fact"), str) and bundle["health_fact"].strip():
        facts.append({"sort_order": 0, "fact": bundle["health_fact"].strip()})

    return ing, det, facts
