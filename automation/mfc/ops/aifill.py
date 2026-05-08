"""Anthropic Claude fallback for ingredient nutrition.

Used only when FDC has no match for an ingredient. Returns a bundle
nutrition block with source="ai". Strict schema check: all returned keys
must be in the allowed nutrition vocabulary; values must be non-negative
numbers.
"""

from __future__ import annotations

from datetime import datetime, timezone

from .fdc_nutrient_map import NUTRIENT_MAP


class AiFillError(RuntimeError):
    pass


# Allowed nutrient keys = anything in the FDC mapping (which defines the
# bundle vocabulary).
ALLOWED_KEYS = {key for key, _u in NUTRIENT_MAP.values()}


def _now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


# Tool input schema — Anthropic uses this for tool_use validation. We then
# revalidate locally to be strict about negative values + extra keys.
_TOOL_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "properties": {key: {"type": "number", "minimum": 0} for key in sorted(ALLOWED_KEYS)},
}

_TOOL = {
    "name": "report_nutrition",
    "description": "Report best-estimate per-100g nutrition for the ingredient.",
    "input_schema": _TOOL_SCHEMA,
}

_SYSTEM = (
    "You are a nutrition database. For the ingredient described, return your "
    "best per-100g estimate of standard food nutrients via the report_nutrition "
    "tool. Use Indian/regional reference values where applicable. Omit any "
    "nutrient you are not confident estimating — never invent placeholder "
    "values. Values must be non-negative numbers in the units encoded by the "
    "key suffixes (_g, _mg, _ug, _kcal, _kj)."
)


def _client(api_key: str):
    # Imported lazily so tests can patch this factory without the
    # anthropic SDK being importable.
    from anthropic import Anthropic
    return Anthropic(api_key=api_key)


def suggest_nutrition(name: str, *, category: str | None, api_key: str) -> dict:
    user_msg = f"Ingredient: {name}"
    if category:
        user_msg += f"\nCategory: {category}"
    client = _client(api_key)
    msg = client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=1024,
        system=_SYSTEM,
        tools=[_TOOL],
        tool_choice={"type": "tool", "name": "report_nutrition"},
        messages=[{"role": "user", "content": user_msg}],
    )

    payload: dict | None = None
    for block in msg.content:
        if getattr(block, "type", None) == "tool_use" and getattr(block, "name", None) == "report_nutrition":
            payload = getattr(block, "input", None)
            break
    if not isinstance(payload, dict):
        raise AiFillError("model did not call report_nutrition")

    bad = [k for k in payload.keys() if k not in ALLOWED_KEYS]
    if bad:
        raise AiFillError(f"model returned out-of-schema keys: {bad[:5]}")
    for k, v in payload.items():
        if not isinstance(v, (int, float)) or v < 0:
            raise AiFillError(f"value for {k} is invalid: {v!r}")

    now = _now_iso()
    block: dict = {
        "source": "ai",
        "fdcId": None,
        "filledAt": now,
        "aiFilledAt": now,
        "per": "100g",
    }
    block.update(payload)
    return block
