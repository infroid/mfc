"""Tests for create_utensil bundle composition."""

from __future__ import annotations

from datetime import datetime, timezone

from mfc.commands import create_utensil as cu
from mfc.ops.amazon import ProductInfo


_FROZEN = datetime(2026, 5, 7, 15, 30, 0, tzinfo=timezone.utc)


def _info(**overrides):
    base = {
        "asin": "B07JFTSKXW",
        "marketplace": "amazon.com",
        "title": "Cast-iron Kadhai",
        "price": "$49.95",
        "image_urls": ["https://example.com/a.jpg"],
        "breadcrumbs": ["Home & Kitchen", "Cookware", "Woks"],
        "canonical_url": "https://www.amazon.com/dp/B07JFTSKXW",
        "bullets": [],
        "details": {},
    }
    base.update(overrides)
    return ProductInfo(**base)


def test_compose_bundle_full():
    info = _info(
        bullets=[
            "Deep, broad, hot — the workhorse pan.",
            "10-inch diameter, 2.4 kg cast iron.",
        ],
        details={
            "Material": "Cast iron",
            "Item Weight": "2.4 Kilograms",
            "Item Dimensions LxWxH": "10 x 10 x 4 inches",
            "Care Instructions": "Hand-wash, dry on heat, oil lightly.",
        },
    )
    bundle = cu._compose_bundle(
        info=info, utensil_id="kadhai-cast-iron",
        photo_path="https://abc.supabase.co/storage/v1/object/public/utensil-images/kadhai-cast-iron/kadhai-cast-iron.jpg",
        now=_FROZEN,
    )
    assert bundle["id"] == "kadhai-cast-iron"
    assert bundle["name"] == "Cast-iron Kadhai"
    assert bundle["category"] == "Cookware"
    assert bundle["photo"] == "https://abc.supabase.co/storage/v1/object/public/utensil-images/kadhai-cast-iron/kadhai-cast-iron.jpg"
    assert bundle["tagline"] == "Deep, broad, hot — the workhorse pan."
    assert bundle["care_tip"] == "Hand-wash, dry on heat, oil lightly."
    assert bundle["specs"] == {
        "material": "Cast iron",
        "size": "10 x 10 x 4 inches",
        "weight": "2.4 Kilograms",
    }
    assert bundle["show"] == {"buyLink": True, "careTip": True, "specs": True}
    assert bundle["ai_filled_at"] == "2026-05-07T15:30:00+00:00"
    assert bundle["amazon"] == {
        "asin": "B07JFTSKXW",
        "marketplace": "amazon.com",
        "fetched_at": "2026-05-07T15:30:00+00:00",
    }
    assert bundle["buy_links"] == [{
        "sort_order": 0,
        "store": "Amazon",
        "url": "https://www.amazon.com/dp/B07JFTSKXW?tag=mfc-20",
        "price": "$49.95",
        "affiliate_tag": "mfc-20",
    }]


def test_compose_bundle_empty_details_keeps_specs_hidden():
    bundle = cu._compose_bundle(
        info=_info(), utensil_id="x", photo_path=None, now=_FROZEN,
    )
    assert bundle["photo"] is None
    assert bundle["tagline"] is None
    assert bundle["care_tip"] is None
    assert bundle["specs"] == {}
    assert bundle["show"]["specs"] is False


def test_compose_bundle_partial_specs():
    info = _info(details={"Material": "Stainless steel", "Capacity": "5 L"})
    bundle = cu._compose_bundle(
        info=info, utensil_id="pot", photo_path=None, now=_FROZEN,
    )
    assert bundle["specs"] == {"material": "Stainless steel", "size": "5 L"}
    assert "weight" not in bundle["specs"]
    assert bundle["show"]["specs"] is True
