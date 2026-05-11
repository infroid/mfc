"""Tests for mfc.ops.bundle_decompose_utensil — utensil bundle JSON → SQLite rows."""

from __future__ import annotations


def test_minimal_bundle_yields_just_utensil_row():
    from mfc.ops.bundle_decompose_utensil import decompose

    bundle = {"id": "fork", "name": "Fork"}
    utensil, buy_links = decompose(bundle)

    assert utensil["id"] == "fork"
    assert utensil["name"] == "Fork"
    assert buy_links == []


def test_full_bundle_expands_amazon_and_keeps_buy_links():
    from mfc.ops.bundle_decompose_utensil import decompose

    bundle = {
        "id": "kadhai-cast-iron",
        "name": "Cast-iron kadhai",
        "tagline": "Deep, broad, hot",
        "category": "Cookware",
        "photo": "assets/utensils/kadhai-cast-iron/kadhai-cast-iron.jpg",
        "care_tip": "Hand-wash.",
        "specs": {"material": "Cast iron", "size": "10in", "weight": "2.4kg"},
        "show": {"careTip": True, "specs": True},
        "ai_filled_at": "2026-05-07T15:30:00+00:00",
        "amazon": {
            "asin": "B07JFTSKXW",
            "marketplace": "amazon.com",
            "fetched_at": "2026-05-07T15:30:00+00:00",
        },
        "buy_links": [
            {"sort_order": 0, "store": "Amazon", "url": "https://amazon.com/x", "price": "$49.95", "affiliate_tag": "mfc-20"},
            {"sort_order": 1, "store": "iHerb",  "url": "https://iherb.com/x",  "price": "$55",    "affiliate_tag": None},
        ],
    }
    utensil, buy_links = decompose(bundle)

    # Utensil row
    assert utensil["id"] == "kadhai-cast-iron"
    assert utensil["category"] == "Cookware"
    assert utensil["amazon_asin"] == "B07JFTSKXW"
    assert utensil["amazon_marketplace"] == "amazon.com"
    assert utensil["amazon_fetched_at"] == "2026-05-07T15:30:00+00:00"
    # `amazon` nested object should NOT remain on the row.
    assert "amazon" not in utensil
    # `buy_links` should NOT remain on the row (they're returned separately).
    assert "buy_links" not in utensil

    # Buy links
    assert len(buy_links) == 2
    assert buy_links[0]["store"] == "Amazon"
    assert buy_links[0]["sort_order"] == 0
    assert buy_links[1]["affiliate_tag"] is None


def test_missing_amazon_block_is_safe():
    from mfc.ops.bundle_decompose_utensil import decompose

    bundle = {"id": "spatula", "name": "Spatula"}
    utensil, _ = decompose(bundle)
    # No amazon_* fields present → not in the row at all (or all None)
    assert utensil.get("amazon_asin") is None or "amazon_asin" not in utensil


def test_unknown_fields_dropped():
    """Bundle may include keys we don't map (e.g. legacy fields). Drop them."""
    from mfc.ops.bundle_decompose_utensil import decompose

    bundle = {"id": "x", "name": "X", "legacy_field": "ignore me"}
    utensil, _ = decompose(bundle)
    assert "legacy_field" not in utensil
