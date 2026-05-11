"""USDA FoodData Central API client.

Two flows:
  fetch_for_name(name, api_key) — search by name → pick best match → pull
                                  nutrients → map to bundle nutrition block.
  fetch_for_id(fdc_id, api_key) — skip search; pull + map directly.

Pure I/O. No DB, no filesystem.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlencode, urlsplit
from urllib.request import Request, urlopen

from .usda_nutrient_map import NUTRIENT_MAP


SEARCH_URL = "https://api.nal.usda.gov/fdc/v1/foods/search"
FOOD_URL   = "https://api.nal.usda.gov/fdc/v1/food/{fdc_id}"
TIMEOUT_S  = 15

# Highest-trust dataType first. Anything not in this list is ignored.
DATA_TYPE_PRIORITY = ("Foundation", "SR Legacy", "Survey (FNDDS)")


class FdcError(RuntimeError):
    pass


class FdcNotFound(FdcError):
    pass


def _now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _get_json(url: str) -> dict:
    req = Request(url, headers={"Accept": "application/json"})
    try:
        with urlopen(req, timeout=TIMEOUT_S) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except HTTPError as exc:
        # Strip query string to avoid leaking api_key into error logs.
        safe_url = urlsplit(url)._replace(query="").geturl()
        raise FdcError(f"HTTP {exc.code} for {safe_url}") from exc
    except (URLError, TimeoutError) as exc:
        raise FdcError(f"network: {exc}") from exc


def _search(name: str, api_key: str) -> dict:
    qs = urlencode({
        "query": name,
        "api_key": api_key,
        "dataType": ",".join(DATA_TYPE_PRIORITY),
        "pageSize": 25,
    })
    return _get_json(f"{SEARCH_URL}?{qs}")


def _pick_best(foods: list[dict]) -> dict | None:
    """Pick the highest-priority food. Returns None if no acceptable match."""
    by_type: dict[str, dict] = {}
    for f in foods:
        dt = f.get("dataType")
        if dt in DATA_TYPE_PRIORITY and dt not in by_type:
            by_type[dt] = f
    for dt in DATA_TYPE_PRIORITY:
        if dt in by_type:
            return by_type[dt]
    return None


def _fetch_food(fdc_id: int, api_key: str) -> dict:
    return _get_json(FOOD_URL.format(fdc_id=fdc_id) + f"?api_key={quote(api_key)}")


def _build_block(food: dict) -> dict:
    block: dict = {
        "source": "fdc",
        "fdcId":  int(food["fdcId"]),
        "filledAt": _now_iso(),
        "aiFilledAt": None,
        "per": "100g",
    }
    for nutrient_entry in food.get("foodNutrients") or []:
        nid = (nutrient_entry.get("nutrient") or {}).get("id")
        amount = nutrient_entry.get("amount")
        if nid is None or amount is None:
            continue
        key = NUTRIENT_MAP.get(int(nid))
        if key is None:
            continue
        # Last write wins when multiple FDC ids map to the same key
        # (e.g. 1008 vs 2047 both → calories). Foundation reports come
        # back in id order, so the more specific Atwater id ends up
        # winning, which is the desired behavior.
        block[key] = amount
    return block


def fetch_for_id(fdc_id: int, *, api_key: str) -> dict:
    food = _fetch_food(fdc_id, api_key)
    return _build_block(food)


def fetch_for_name(name: str, *, api_key: str) -> dict:
    payload = _search(name, api_key)
    foods = payload.get("foods") or []
    pick = _pick_best(foods)
    if pick is None:
        raise FdcNotFound(f"no FDC match for {name!r}")
    return fetch_for_id(int(pick["fdcId"]), api_key=api_key)
