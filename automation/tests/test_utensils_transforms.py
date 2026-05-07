"""Pure-function tests for ops/utensils.py transforms (no DB)."""

from __future__ import annotations

from mfc.ops import utensils


SAMPLE_BUNDLE = {
    "id": "kadhai-cast-iron",
    "name": "Cast-iron kadhai",
    "tagline": "deep, broad, hot",
    "category": "Cookware",
    "photo": "assets/utensils/kadhai-cast-iron/kadhai-cast-iron.jpg",
    "care_tip": None,
    "specs": {"material": "cast iron", "size": "10\""},
    "show": {"buyLink": True, "careTip": True, "specs": False},
    "ai_filled_at": "2026-05-07T15:30:00Z",
    "amazon": {
        "asin": "B07JFTSKXW",
        "marketplace": "amazon.com",
        "fetched_at": "2026-05-07T15:30:00Z",
    },
    "buy_links": [
        {"sort_order": 0, "store": "Amazon", "url": "https://...",
         "price": "$49.95", "affiliate_tag": "mfc-20"}
    ],
}


def test_bundle_to_utensil_row_maps_amazon_block():
    row = utensils._bundle_to_utensil_row(SAMPLE_BUNDLE)
    assert row["id"] == "kadhai-cast-iron"
    assert row["amazon_asin"] == "B07JFTSKXW"
    assert row["amazon_marketplace"] == "amazon.com"
    assert row["amazon_fetched_at"] == "2026-05-07T15:30:00Z"
    assert row["specs"] == {"material": "cast iron", "size": "10\""}
    assert row["show"] == {"buyLink": True, "careTip": True, "specs": False}


def test_bundle_to_utensil_row_defaults_specs_and_show_to_empty_dict():
    row = utensils._bundle_to_utensil_row({"id": "x", "name": "X"})
    assert row["specs"] == {}
    assert row["show"] == {}
    assert row["amazon_asin"] is None


def test_bundle_to_buy_link_rows_attaches_utensil_id():
    rows = utensils._bundle_to_buy_link_rows(SAMPLE_BUNDLE)
    assert rows == [{
        "utensil_id": "kadhai-cast-iron",
        "sort_order": 0,
        "store": "Amazon",
        "url": "https://...",
        "price": "$49.95",
        "affiliate_tag": "mfc-20",
    }]


def test_bundle_to_buy_link_rows_empty_when_missing():
    assert utensils._bundle_to_buy_link_rows({"id": "x"}) == []
