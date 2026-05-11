"""USDA FDC nutrient-id → our SQLite column name map.

Source: USDA `nutrient.csv` from the Foundation Foods dump. Coverage
analysis on data/usda showed ~140 ids reach >5% of foundation foods;
only those are mapped. Tier 4 (research-only, isomers, lab artifacts)
intentionally omitted.
"""

from __future__ import annotations

# nutrient_id → column name on ingredient_details. Units documented in
# docs/NUTRITION_FIELDS.md + on the Postgres COMMENT ON COLUMN line.
NUTRIENT_MAP: dict[int, str] = {
    # Energy + water
    1008: "calories",
    2047: "calories",
    2048: "calories",
    1062: "energy_kj",
    1051: "water",
    1007: "ash",
    1018: "alcohol",

    # Macros
    1003: "protein",
    1004: "total_fat",
    1005: "carbohydrate",
    1002: "nitrogen",

    # Carb breakdown
    1079: "fiber",
    2033: "fiber_soluble",
    1084: "fiber_insoluble",
    1063: "sugars",
    2000: "sugars",
    1235: "sugars_added",
    1009: "starch",
    1011: "glucose",
    1012: "fructose",
    1010: "sucrose",
    1013: "lactose",
    1014: "maltose",
    1075: "galactose",

    # Fats
    1258: "saturated_fat",
    1292: "mono_fat",
    1293: "poly_fat",
    1257: "trans_fat",
    1253: "cholesterol",

    # Individual SFA
    1259: "sfa_4_0",
    1260: "sfa_6_0",
    1261: "sfa_8_0",
    1262: "sfa_10_0",
    1263: "sfa_12_0",
    1264: "sfa_14_0",
    1299: "sfa_15_0",
    1265: "sfa_16_0",
    1300: "sfa_17_0",
    1266: "sfa_18_0",
    1267: "sfa_20_0",
    1273: "sfa_22_0",
    1301: "sfa_24_0",

    # Individual MUFA
    1314: "mufa_14_1",
    1333: "mufa_15_1",
    1275: "mufa_16_1",
    1323: "mufa_17_1",
    1268: "mufa_18_1",
    1277: "mufa_20_1",
    1279: "mufa_22_1",
    1312: "mufa_24_1",

    # Individual PUFA
    1269: "pufa_18_2_n6_la",
    1404: "pufa_18_3_n3_ala",
    1321: "pufa_18_3_n6_gla",
    1276: "pufa_18_4",
    1313: "pufa_20_2_n6",
    1325: "pufa_20_3_n6",
    1405: "pufa_20_3_n3",
    1316: "pufa_20_4_n6_aa",
    1278: "pufa_20_5_n3_epa",
    1280: "pufa_21_5",
    1318: "pufa_22_2",
    1281: "pufa_22_5_n3_dpa",
    1272: "pufa_22_6_n3_dha",

    # Minerals
    1087: "calcium",
    1089: "iron",
    1090: "magnesium",
    1091: "phosphorus",
    1092: "potassium",
    1093: "sodium",
    1095: "zinc",
    1098: "copper",
    1101: "manganese",
    1103: "selenium",
    1099: "fluoride",
    1100: "iodine",

    # Fat-soluble vitamins
    1106: "vitamin_a",
    1104: "vitamin_a_iu",
    1105: "retinol",
    1108: "carotene_alpha",
    1107: "carotene_beta",
    1120: "cryptoxanthin_beta",
    1122: "lycopene",
    1123: "lutein_zeaxanthin",
    1114: "vitamin_d",
    1111: "vitamin_d2",
    1112: "vitamin_d3",
    1109: "vitamin_e",
    1125: "tocopherol_beta",
    1126: "tocopherol_gamma",
    1127: "tocopherol_delta",
    1185: "vitamin_k",

    # Water-soluble vitamins
    1165: "thiamin",
    1166: "riboflavin",
    1167: "niacin",
    1170: "pantothenic_acid",
    1175: "vitamin_b6",
    1176: "biotin",
    1177: "folate",
    1190: "folate_dfe",
    1178: "vitamin_b12",
    1180: "choline",
    1162: "vitamin_c",

    # Amino acids
    1210: "tryptophan",
    1211: "threonine",
    1212: "isoleucine",
    1213: "leucine",
    1214: "lysine",
    1215: "methionine",
    1216: "cystine",
    1217: "phenylalanine",
    1218: "tyrosine",
    1219: "valine",
    1220: "arginine",
    1221: "histidine",
    1222: "alanine",
    1223: "aspartic_acid",
    1224: "glutamic_acid",
    1225: "glycine",
    1226: "proline",
    1227: "serine",
    1228: "hydroxyproline",

    # Stimulants
    1057: "caffeine",
    1058: "theobromine",
}
