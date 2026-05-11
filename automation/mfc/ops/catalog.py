"""SQLite catalog client.

Wraps sqlite3 with the conveniences our ingest/sync code needs:
  - schema init from automation/db/sqlite_schema.sql
  - JSON serialization on the way in for aliases / show / substitutes
  - upsert helpers that target our exact table shapes
  - health-facts "replace all for target" helper

Stays narrow on purpose; mfc.ops.sync_catalog (Task 12) layers
DB-level differential logic on top.
"""

from __future__ import annotations

import json
import sqlite3
from pathlib import Path
from typing import Any, Iterator


_SCHEMA_PATH = Path(__file__).resolve().parents[2] / "db" / "sqlite_schema.sql"
_JSON_FIELDS_INGREDIENTS = ("aliases", "show")
_JSON_FIELDS_DETAILS = ("substitutes",)


class Catalog:
    def __init__(self, path: str | Path):
        self.path = Path(path)
        self.conn: sqlite3.Connection = sqlite3.connect(str(self.path))
        self.conn.row_factory = sqlite3.Row
        self.conn.execute("PRAGMA foreign_keys = ON")

    def init(self) -> None:
        """Apply the schema (idempotent — all CREATEs use IF NOT EXISTS)."""
        sql = _SCHEMA_PATH.read_text()
        self.conn.executescript(sql)
        self.conn.commit()

    def close(self) -> None:
        self.conn.close()

    def upsert_ingredient(self, row: dict[str, Any]) -> None:
        data = dict(row)
        for k in _JSON_FIELDS_INGREDIENTS:
            if k in data and not isinstance(data[k], str):
                data[k] = json.dumps(data[k])
        cols = list(data.keys())
        placeholders = ",".join(f":{c}" for c in cols)
        col_list = ",".join(cols)
        updates = ",".join(f"{c}=excluded.{c}" for c in cols if c != "id")
        sql = (
            f"INSERT INTO ingredients ({col_list}) VALUES ({placeholders}) "
            f"ON CONFLICT(id) DO UPDATE SET {updates}"
        )
        self.conn.execute(sql, data)
        self.conn.commit()

    def upsert_details(self, row: dict[str, Any]) -> None:
        data = dict(row)
        for k in _JSON_FIELDS_DETAILS:
            if k in data and not isinstance(data[k], str):
                data[k] = json.dumps(data[k])
        cols = list(data.keys())
        placeholders = ",".join(f":{c}" for c in cols)
        col_list = ",".join(cols)
        updates = ",".join(f"{c}=excluded.{c}" for c in cols if c != "id")
        sql = (
            f"INSERT INTO ingredient_details ({col_list}) VALUES ({placeholders}) "
            f"ON CONFLICT(id) DO UPDATE SET {updates}"
        )
        self.conn.execute(sql, data)
        self.conn.commit()

    def set_health_facts(self, category: str, target_id: str, facts: list[str]) -> None:
        """Replace ALL facts for (category, target_id) atomically."""
        with self.conn:
            self.conn.execute(
                "DELETE FROM health_facts WHERE category=? AND target_id=?",
                (category, target_id),
            )
            for i, fact in enumerate(facts):
                self.conn.execute(
                    "INSERT INTO health_facts (category, target_id, sort_order, fact) "
                    "VALUES (?, ?, ?, ?)",
                    (category, target_id, i, fact),
                )

    def iter_ingredients(self) -> Iterator[sqlite3.Row]:
        cur = self.conn.execute("SELECT * FROM ingredients ORDER BY id")
        yield from cur

    def upsert_utensil(self, row: dict[str, Any]) -> None:
        """Upsert a utensil row. JSON-encodes `specs` and `show` on the way in."""
        data = dict(row)
        for k in ("specs", "show"):
            if k in data and not isinstance(data[k], str):
                data[k] = json.dumps(data[k])
        cols = list(data.keys())
        placeholders = ",".join(f":{c}" for c in cols)
        col_list = ",".join(cols)
        updates = ",".join(f"{c}=excluded.{c}" for c in cols if c != "id")
        sql = (
            f"INSERT INTO utensils ({col_list}) VALUES ({placeholders}) "
            f"ON CONFLICT(id) DO UPDATE SET {updates}"
        )
        self.conn.execute(sql, data)
        self.conn.commit()

    def set_utensil_buy_links(self, utensil_id: str, buy_links: list[dict]) -> None:
        """Replace ALL buy_links for utensil_id atomically. Each link is
        {sort_order, store, url, price, affiliate_tag}."""
        with self.conn:
            self.conn.execute("DELETE FROM utensil_buy_links WHERE utensil_id=?", (utensil_id,))
            for link in buy_links:
                self.conn.execute(
                    "INSERT INTO utensil_buy_links "
                    "(utensil_id, sort_order, store, url, price, affiliate_tag) "
                    "VALUES (?, ?, ?, ?, ?, ?)",
                    (
                        utensil_id,
                        link.get("sort_order"),
                        link.get("store"),
                        link.get("url"),
                        link.get("price"),
                        link.get("affiliate_tag"),
                    ),
                )

    def iter_utensils(self) -> Iterator[sqlite3.Row]:
        cur = self.conn.execute("SELECT * FROM utensils ORDER BY id")
        yield from cur
