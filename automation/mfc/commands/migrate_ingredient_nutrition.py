"""`mfc migrate-ingredient-nutrition` — one-shot reshape of legacy
ingredient nutrition jsonb. Idempotent."""

from __future__ import annotations

import argparse

from ..clients import sb as sb_client
from ..core import log
from ..core.config import Config
from ..ops.nutrition_migration import reshape_legacy


def register(subparsers: argparse._SubParsersAction) -> None:
    p = subparsers.add_parser(
        "migrate-ingredient-nutrition",
        help="Reshape legacy ingredient nutrition jsonb to USDA schema (idempotent)",
    )
    p.set_defaults(handler=run)


def run(args: argparse.Namespace, config: Config) -> int:
    sb = sb_client.service_client(config)
    rows = (
        sb.table("ingredients")
        .select("id, nutrition")
        .order("id")
        .execute()
        .data
        or []
    )

    log.step(f"migrate-ingredient-nutrition · {len(rows)} row(s) to inspect")
    touched = 0
    skipped = 0
    for row in rows:
        before = row.get("nutrition")
        after = reshape_legacy(before)
        if after is before or after == before:
            skipped += 1
            continue
        sb.table("ingredients").update(
            {"nutrition": after, "nutrition_source": "manual"}
        ).eq("id", row["id"]).execute()
        touched += 1
        log.ok(f"reshaped {row['id']}")

    log.step(f"done · reshaped {touched} · skipped {skipped}")
    return 0
