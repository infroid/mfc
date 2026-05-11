"""Pure function: utensil bundle JSON → (utensil-row, buy-link-rows).

Expands `amazon.{asin, marketplace, fetched_at}` into flat
`amazon_asin / amazon_marketplace / amazon_fetched_at` columns on the
utensil row. Drops the nested `amazon` object and the `buy_links` list
(returned separately).
"""

from __future__ import annotations

from typing import Any


_UTENSIL_FIELDS = (
    "id", "name", "tagline", "category", "photo", "care_tip",
    "specs", "show", "ai_filled_at", "created_by", "created_at", "updated_at",
)


def decompose(bundle: dict[str, Any]) -> tuple[dict, list[dict]]:
    """Split one utensil bundle into (utensils-row, buy-link-rows).

    The utensils row contains the columns directly persisted to SQLite.
    Buy-link rows are dicts with {sort_order, store, url, price, affiliate_tag}.
    """
    utensil = {k: bundle[k] for k in _UTENSIL_FIELDS if k in bundle}

    az = bundle.get("amazon") or {}
    if isinstance(az, dict):
        if az.get("asin"):
            utensil["amazon_asin"] = az["asin"]
        if az.get("marketplace"):
            utensil["amazon_marketplace"] = az["marketplace"]
        if az.get("fetched_at"):
            utensil["amazon_fetched_at"] = az["fetched_at"]

    buy_links: list[dict] = []
    for entry in (bundle.get("buy_links") or []):
        if not isinstance(entry, dict):
            continue
        buy_links.append({
            "sort_order":    entry.get("sort_order"),
            "store":         entry.get("store"),
            "url":           entry.get("url"),
            "price":         entry.get("price"),
            "affiliate_tag": entry.get("affiliate_tag"),
        })

    return utensil, buy_links
