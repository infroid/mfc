"""Pure helper that reshapes legacy ingredient nutrition jsonb into the
USDA-aligned schema. Idempotent: rows already in new shape pass through
unchanged.

Legacy schema:
    { "calories": N, "protein": N, "fat": N, "carbs": N }

New schema (subset shown):
    { "source": "manual", "per": "100g", "filledAt": <ISO8601>,
      "energy_kcal": N, "protein_g": N, "total_fat_g": N,
      "carbohydrate_g": N }
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional


_KEY_RENAME = {
    "calories": "energy_kcal",
    "protein":  "protein_g",
    "fat":      "total_fat_g",
    "carbs":    "carbohydrate_g",
}


def _now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def reshape_legacy(nutrition: Optional[dict]) -> Optional[dict]:
    """Return the nutrition jsonb in new shape, or input unchanged when
    not legacy (already-new, empty, or None)."""
    if nutrition is None:
        return None
    if not isinstance(nutrition, dict) or not nutrition:
        return nutrition
    if "source" in nutrition:
        return nutrition

    out: dict = {}
    out["source"] = "manual"
    out["per"] = nutrition.get("per", "100g")
    out["filledAt"] = nutrition.get("filledAt", _now_iso())

    for k, v in nutrition.items():
        if k in ("source", "per", "filledAt"):
            continue
        out[_KEY_RENAME.get(k, k)] = v
    return out
