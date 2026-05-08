"""USDA FoodData Central nutrient-id → bundle-key map.

FDC nutrient ids are stable across data sources. Only ids listed here are
copied into the bundle nutrition block; everything else is ignored.

Sources for the ids:
  - https://fdc.nal.usda.gov/portal-data/external/nutrients
  - Cross-referenced with Foundation/SR Legacy/FNDDS reports.
"""

from __future__ import annotations


# id → (bundle_key, expected_unit). The unit is informational; FDC reports
# already standardize to per-100g for the data types we use, and the key
# carries the unit suffix so values are stored verbatim.
NUTRIENT_MAP: dict[int, tuple[str, str]] = {
    # ── Energy + proximates ────────────────────────────────────────────
    1008: ("energy_kcal", "kcal"),
    2047: ("energy_kcal", "kcal"),     # Atwater general (preferred when present)
    2048: ("energy_kcal", "kcal"),     # Atwater specific
    1062: ("energy_kj",   "kJ"),
    1051: ("water_g",     "g"),
    1003: ("protein_g",   "g"),
    1004: ("total_fat_g", "g"),
    1005: ("carbohydrate_g", "g"),
    1007: ("ash_g",       "g"),

    # ── Fats ───────────────────────────────────────────────────────────
    1258: ("saturated_fat_g",          "g"),
    1292: ("monounsaturated_fat_g",    "g"),
    1293: ("polyunsaturated_fat_g",    "g"),
    1257: ("trans_fat_g",              "g"),
    1253: ("cholesterol_mg",           "mg"),

    # ── Carbohydrate breakdown ─────────────────────────────────────────
    1079: ("fiber_total_g",     "g"),
    2033: ("fiber_soluble_g",   "g"),
    1084: ("fiber_insoluble_g", "g"),
    2000: ("sugars_total_g",    "g"),
    1063: ("sugars_total_g",    "g"),  # legacy id for "sugars, total"
    1235: ("sugars_added_g",    "g"),
    1009: ("starch_g",          "g"),

    # ── Minerals ───────────────────────────────────────────────────────
    1087: ("calcium_mg",    "mg"),
    1089: ("iron_mg",       "mg"),
    1090: ("magnesium_mg",  "mg"),
    1091: ("phosphorus_mg", "mg"),
    1092: ("potassium_mg",  "mg"),
    1093: ("sodium_mg",     "mg"),
    1095: ("zinc_mg",       "mg"),
    1098: ("copper_mg",     "mg"),
    1101: ("manganese_mg",  "mg"),
    1103: ("selenium_ug",   "µg"),
    1099: ("fluoride_ug",   "µg"),

    # ── Vitamins ───────────────────────────────────────────────────────
    1106: ("vitamin_a_rae_ug",   "µg"),
    1162: ("vitamin_c_mg",       "mg"),
    1114: ("vitamin_d_ug",       "µg"),
    1109: ("vitamin_e_mg",       "mg"),
    1185: ("vitamin_k_ug",       "µg"),
    1165: ("thiamin_mg",         "mg"),
    1166: ("riboflavin_mg",      "mg"),
    1167: ("niacin_mg",          "mg"),
    1170: ("pantothenic_acid_mg","mg"),
    1175: ("vitamin_b6_mg",      "mg"),
    1176: ("biotin_ug",          "µg"),
    1177: ("folate_total_ug",    "µg"),
    1190: ("folate_dfe_ug",      "µg"),
    1178: ("vitamin_b12_ug",     "µg"),
    1180: ("choline_mg",         "mg"),

    # ── Selected fatty acids ───────────────────────────────────────────
    1404: ("fa_18_3_n3_alpha_linolenic_g", "g"),
    1278: ("fa_20_5_n3_epa_g",             "g"),
    1272: ("fa_22_6_n3_dha_g",             "g"),
    1269: ("fa_18_2_n6_linoleic_g",        "g"),
    1316: ("fa_20_4_n6_arachidonic_g",     "g"),

    # ── Amino acids ────────────────────────────────────────────────────
    1210: ("tryptophan_g",     "g"),
    1211: ("threonine_g",      "g"),
    1212: ("isoleucine_g",     "g"),
    1213: ("leucine_g",        "g"),
    1214: ("lysine_g",         "g"),
    1215: ("methionine_g",     "g"),
    1216: ("cystine_g",        "g"),
    1217: ("phenylalanine_g",  "g"),
    1218: ("tyrosine_g",       "g"),
    1219: ("valine_g",         "g"),
    1220: ("arginine_g",       "g"),
    1221: ("histidine_g",      "g"),
    1222: ("alanine_g",        "g"),
    1223: ("aspartic_acid_g",  "g"),
    1224: ("glutamic_acid_g",  "g"),
    1225: ("glycine_g",        "g"),
    1226: ("proline_g",        "g"),
    1227: ("serine_g",         "g"),

    # ── Stimulants ─────────────────────────────────────────────────────
    1057: ("caffeine_mg",     "mg"),
    1058: ("theobromine_mg",  "mg"),
}
