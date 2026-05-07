"""`mfc create-utensil` — scrape an Amazon product page, write a utensil
bundle (JSON + image) to disk, optionally push the row to Supabase.
"""

from __future__ import annotations

import argparse
import re
import unicodedata


AFFILIATE_TAG = "mfc-20"


_SLUG_NORMALIZE_RX = re.compile(r"[^a-z0-9]+")


def slugify(text: str) -> str:
    """ASCII slug: lowercase, strip diacritics, collapse non-alnum runs to '-'."""
    if not text or not text.strip():
        raise ValueError("cannot slugify empty string")
    normalized = unicodedata.normalize("NFKD", text)
    ascii_only = normalized.encode("ascii", "ignore").decode("ascii")
    slug = _SLUG_NORMALIZE_RX.sub("-", ascii_only.lower()).strip("-")
    if not slug:
        raise ValueError(f"slug collapsed to empty for input: {text!r}")
    return slug


_CATEGORY_RULES: list[tuple[str, list[str]]] = [
    ("Cutlery",         ["knife", "knives", "cutlery"]),
    ("Bakeware",        ["bakeware", "baking"]),
    ("Small appliance", ["small appliance", "blender", "mixer", "appliance"]),
    ("Measuring",       ["measuring", "scale", "thermometer"]),
    ("Cookware",        ["cookware", "pot", "pan", "skillet", "wok", "dutch oven"]),
]


def guess_category(breadcrumbs: list[str]) -> str:
    haystack = " ".join(breadcrumbs).lower()
    for category, keywords in _CATEGORY_RULES:
        if any(kw in haystack for kw in keywords):
            return category
    return "Utensil"


def canonical_amazon_url(asin: str, marketplace: str) -> str:
    return f"https://www.{marketplace}/dp/{asin}?tag={AFFILIATE_TAG}"


def register(subparsers: argparse._SubParsersAction) -> None:
    raise NotImplementedError("CLI surface lands in Task 12")


def run(args: argparse.Namespace, config) -> int:
    raise NotImplementedError("orchestrator lands in Task 11")
