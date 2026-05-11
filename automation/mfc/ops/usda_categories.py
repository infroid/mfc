"""USDA verbose food category names → short app-friendly labels."""

from __future__ import annotations


CATEGORY_MAP: dict[str, str] = {
    "Vegetables and Vegetable Products":   "Vegetable",
    "Fruits and Fruit Juices":             "Fruit",
    "Dairy and Egg Products":              "Dairy",
    "Cereal Grains and Pasta":             "Grain",
    "Legumes and Legume Products":         "Legume",
    "Nut and Seed Products":               "Nut & Seed",
    "Finfish and Shellfish Products":      "Seafood",
    "Beef Products":                       "Meat",
    "Pork Products":                       "Meat",
    "Poultry Products":                    "Meat",
    "Lamb, Veal, and Game Products":       "Meat",
    "Sausages and Luncheon Meats":         "Charcuterie",
    "Fats and Oils":                       "Oil & Fat",
    "Spices and Herbs":                    "Spice & Herb",
    "Sweets":                              "Sweet",
    "Soups, Sauces, and Gravies":          "Sauce",
    "Baked Products":                      "Bakery",
    "Beverages":                           "Beverage",
    "Restaurant Foods":                    "Other",
}


def shorten(name: str) -> str:
    """Return the short label for a USDA category. Unmapped names
    pass through unchanged (graceful degrade)."""
    return CATEGORY_MAP.get(name, name)
