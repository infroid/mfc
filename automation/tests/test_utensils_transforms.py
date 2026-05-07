"""Pure-function tests for ops/utensils.py transforms (no DB)."""

from __future__ import annotations

from dataclasses import dataclass

from mfc.ops import utensils


@dataclass
class _FakeConfig:
    supabase_url: str = "https://abc.supabase.co"


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
    row = utensils._bundle_to_utensil_row(_FakeConfig(), SAMPLE_BUNDLE)
    assert row["id"] == "kadhai-cast-iron"
    assert row["amazon_asin"] == "B07JFTSKXW"
    assert row["amazon_marketplace"] == "amazon.com"
    assert row["amazon_fetched_at"] == "2026-05-07T15:30:00Z"
    assert row["specs"] == {"material": "cast iron", "size": "10\""}
    assert row["show"] == {"buyLink": True, "careTip": True, "specs": False}


def test_bundle_to_utensil_row_defaults_specs_and_show_to_empty_dict():
    row = utensils._bundle_to_utensil_row(_FakeConfig(), {"id": "x", "name": "X"})
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


def test_db_to_bundle_round_trips_canonical_fields():
    db_row = {
        "id": "kadhai", "name": "K", "tagline": None, "category": "Cookware",
        "photo": "assets/utensils/kadhai/kadhai.jpg", "care_tip": None,
        "specs": {"material": "ci"}, "show": {"buyLink": True},
        "ai_filled_at": "2026-05-07T15:30:00Z",
        "amazon_asin": "B07X", "amazon_marketplace": "amazon.com",
        "amazon_fetched_at": "2026-05-07T15:30:00Z",
        "created_at": "ignored", "updated_at": "ignored", "created_by": "ignored",
    }
    buy_links = [
        {"sort_order": 0, "store": "Amazon", "url": "https://...", "price": "$1",
         "affiliate_tag": "mfc-20"},
    ]
    bundle = utensils._db_to_bundle(db_row, buy_links)
    assert bundle["id"] == "kadhai"
    assert bundle["category"] == "Cookware"
    assert "tagline" not in bundle  # nones stripped
    assert "care_tip" not in bundle
    assert bundle["amazon"] == {
        "asin": "B07X", "marketplace": "amazon.com",
        "fetched_at": "2026-05-07T15:30:00Z",
    }
    assert bundle["buy_links"] == [{
        "sort_order": 0, "store": "Amazon", "url": "https://...",
        "price": "$1", "affiliate_tag": "mfc-20",
    }]


def test_db_to_bundle_drops_amazon_block_when_no_asin():
    db_row = {"id": "x", "name": "X", "specs": {}, "show": {},
              "amazon_asin": None, "amazon_marketplace": None,
              "amazon_fetched_at": None}
    bundle = utensils._db_to_bundle(db_row, [])
    assert "amazon" not in bundle


def test_bundle_to_utensil_row_normalizes_legacy_photo_path():
    bundle = dict(SAMPLE_BUNDLE)
    bundle["photo"] = "assets/utensils/kadhai-cast-iron/kadhai-cast-iron.jpg"
    row = utensils._bundle_to_utensil_row(_FakeConfig(), bundle)
    assert row["photo"] == \
        "https://abc.supabase.co/storage/v1/object/public/utensil-images/kadhai-cast-iron/kadhai-cast-iron.jpg"


def test_bundle_to_utensil_row_passes_through_full_url():
    bundle = dict(SAMPLE_BUNDLE)
    bundle["photo"] = "https://abc.supabase.co/storage/v1/object/public/utensil-images/x/x.jpg"
    row = utensils._bundle_to_utensil_row(_FakeConfig(), bundle)
    assert row["photo"] == bundle["photo"]
