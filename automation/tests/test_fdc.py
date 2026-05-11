"""Tests for mfc.ops.fdc — USDA FDC client."""

from __future__ import annotations

import io
import json
from unittest.mock import patch

import pytest


class _FakeResp(io.BytesIO):
    def __init__(self, body: bytes):
        super().__init__(body)
    def __enter__(self):
        return self
    def __exit__(self, *_exc):
        self.close()


def _urlopen_factory(bodies):
    queue = [b if isinstance(b, bytes) else json.dumps(b).encode() for b in bodies]
    def fake(req, timeout=None):
        return _FakeResp(queue.pop(0))
    return fake


SEARCH_FOUNDATION_HIT = {
    "foods": [
        {"fdcId": 9999, "dataType": "Branded",      "description": "Branded spinach"},
        {"fdcId": 173436, "dataType": "Foundation", "description": "Spinach, raw"},
    ]
}

FOOD_DETAIL_SPINACH = {
    "fdcId": 173436,
    "description": "Spinach, raw",
    "dataType": "Foundation",
    "foodNutrients": [
        {"nutrient": {"id": 1008}, "amount": 23},
        {"nutrient": {"id": 1003}, "amount": 2.86},
        {"nutrient": {"id": 1004}, "amount": 0.39},
        {"nutrient": {"id": 1005}, "amount": 3.63},
        {"nutrient": {"id": 1087}, "amount": 99},
        {"nutrient": {"id": 1106}, "amount": 469},
        {"nutrient": {"id": 1213}, "amount": 0.223},
        {"nutrient": {"id": 9999999}, "amount": 0.0},  # unmapped, ignored
    ],
}


def test_search_then_fetch_then_map():
    from mfc.ops import fdc

    with patch("mfc.ops.fdc.urlopen", new=_urlopen_factory([SEARCH_FOUNDATION_HIT, FOOD_DETAIL_SPINACH])):
        block = fdc.fetch_for_name("spinach", api_key="KEY")

    assert block["source"] == "fdc"
    assert block["fdcId"] == 173436
    assert block["per"] == "100g"
    assert block["calories"] == 23
    assert block["protein"] == 2.86
    assert block["calcium"] == 99
    assert block["vitamin_a"] == 469
    assert block["leucine"] == 0.223
    assert 9999999 not in block


def test_empty_search_raises_not_found():
    from mfc.ops import fdc

    with patch("mfc.ops.fdc.urlopen", new=_urlopen_factory([{"foods": []}])):
        with pytest.raises(fdc.FdcNotFound):
            fdc.fetch_for_name("xyz-nonexistent", api_key="KEY")


def test_pinned_id_skips_search():
    from mfc.ops import fdc

    with patch("mfc.ops.fdc.urlopen", new=_urlopen_factory([FOOD_DETAIL_SPINACH])):
        block = fdc.fetch_for_id(173436, api_key="KEY")

    assert block["fdcId"] == 173436
    assert block["protein"] == 2.86


def test_foundation_beats_branded_even_when_branded_first():
    from mfc.ops import fdc

    SEARCH = {
        "foods": [
            {"fdcId": 1, "dataType": "Branded",       "description": "Spinach Brand"},
            {"fdcId": 2, "dataType": "Survey (FNDDS)","description": "Spinach, cooked"},
            {"fdcId": 173436, "dataType": "Foundation","description": "Spinach, raw"},
        ]
    }
    with patch("mfc.ops.fdc.urlopen", new=_urlopen_factory([SEARCH, FOOD_DETAIL_SPINACH])):
        block = fdc.fetch_for_name("spinach", api_key="KEY")
    assert block["fdcId"] == 173436


def test_http_error_does_not_leak_api_key():
    """Regression: api_key was previously embedded in exception message."""
    from urllib.error import HTTPError
    from mfc.ops import fdc

    def fail(req, timeout=None):
        raise HTTPError(url=req.full_url, code=500, msg="boom", hdrs=None, fp=None)

    with patch("mfc.ops.fdc.urlopen", new=fail):
        with pytest.raises(fdc.FdcError) as ex:
            fdc.fetch_for_id(123, api_key="SECRET-KEY-XYZ")

    assert "SECRET-KEY-XYZ" not in str(ex.value)
