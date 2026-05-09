"""Tests for mfc.ops.aifill — Anthropic-backed nutrition fallback."""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest


def _good_tool_use_response():
    """Stand-in for the Anthropic Messages API response shape."""
    block = MagicMock()
    block.type = "tool_use"
    block.name = "report_nutrition"
    block.input = {
        "energy_kcal": 572,
        "protein_g":   25.5,
        "total_fat_g": 50.0,
        "carbohydrate_g": 21.7,
        "calcium_mg":  140,
    }
    msg = MagicMock()
    msg.content = [block]
    return msg


def _bad_tool_use_response():
    """Tool returns legacy keys not in the allowed USDA vocabulary."""
    block = MagicMock()
    block.type = "tool_use"
    block.name = "report_nutrition"
    block.input = {"calories": 572, "protein": 25.5}
    msg = MagicMock()
    msg.content = [block]
    return msg


def test_returns_block_with_source_ai():
    from mfc.ops import aifill

    client = MagicMock()
    client.messages.create.return_value = _good_tool_use_response()
    with patch("mfc.ops.aifill._client", return_value=client):
        block = aifill.suggest_nutrition("kasuri methi", category="Herb", api_key="K")

    assert block["source"] == "ai"
    assert block["per"] == "100g"
    assert block["energy_kcal"] == 572
    assert "filledAt" in block
    assert "aiFilledAt" in block
    assert block["aiFilledAt"] is not None


def test_legacy_or_unknown_keys_raise_aifill_error():
    from mfc.ops import aifill

    client = MagicMock()
    client.messages.create.return_value = _bad_tool_use_response()
    with patch("mfc.ops.aifill._client", return_value=client):
        with pytest.raises(aifill.AiFillError):
            aifill.suggest_nutrition("xyz", category="Herb", api_key="K")


def test_sdk_exception_wrapped_as_aifill_error():
    """Regression: any SDK error (auth, rate limit, network) must be
    converted to AiFillError so the orchestrator records it as a miss
    instead of dying mid-bulk-run."""
    from mfc.ops import aifill

    class _FakeAuthError(Exception):
        pass

    client = MagicMock()
    client.messages.create.side_effect = _FakeAuthError("invalid x-api-key")
    with patch("mfc.ops.aifill._client", return_value=client):
        with pytest.raises(aifill.AiFillError) as ex:
            aifill.suggest_nutrition("xyz", category="Herb", api_key="K")
    assert "_FakeAuthError" in str(ex.value)
    assert "invalid x-api-key" in str(ex.value)
