"""`mfc fetch-ingredient-image[s]` — download illustrated PNGs from
thiings.co/things/<slug> into ingredient bundle dirs.

Idempotent on disk: files that already exist are skipped unless --force.
DB rows are NOT updated by this command — sync-ingredient-images +
sync-ingredients handle that downstream.
"""

from __future__ import annotations

import argparse
import time
from dataclasses import dataclass, field
from pathlib import Path

from ..clients import sb as sb_client
from ..core import log
from ..core.config import Config
from ..ops import thiings


REL_DIR = "assets/ingredients"
SLEEP_BETWEEN_REQUESTS_S = 0.5


@dataclass
class RunReport:
    fetched: list[str] = field(default_factory=list)
    skipped: list[str] = field(default_factory=list)
    misses:  list[tuple[str, str]] = field(default_factory=list)
    failed:  list[tuple[str, str]] = field(default_factory=list)

    def print(self) -> None:
        log.step(
            f"Fetched: {len(self.fetched)}   Skipped: {len(self.skipped)}   "
            f"Misses: {len(self.misses)}   Failed: {len(self.failed)}"
        )
        if self.misses:
            log.info("Misses:")
            for slug, reason in self.misses:
                log.info(f"  - {slug}   ({reason})")
        if self.failed:
            log.info("Failed:")
            for slug, reason in self.failed:
                log.info(f"  - {slug}   ({reason})")


def _output_path(config: Config, ingredient_id: str) -> Path:
    return config.repo_root / "web" / REL_DIR / ingredient_id / "image.png"


def _process_one(
    config: Config,
    ingredient_id: str,
    *,
    force: bool,
    no_write: bool,
    report: RunReport,
) -> None:
    out = _output_path(config, ingredient_id)
    if out.exists() and not force:
        report.skipped.append(ingredient_id)
        return
    try:
        data = thiings.fetch_image(ingredient_id)
    except thiings.ThiingsNotFound as exc:
        report.misses.append((ingredient_id, exc.reason))
        return
    except thiings.ThiingsError as exc:
        report.failed.append((ingredient_id, exc.reason))
        return

    if not no_write:
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_bytes(data)
    report.fetched.append(ingredient_id)


def _run_single(args: argparse.Namespace, config: Config) -> int:
    sb = sb_client.service_client(config)
    rows = sb.table("ingredients").select("id").eq("id", args.id).execute().data or []
    if not rows:
        log.error(f"ingredient '{args.id}' not found in public.ingredients")
        return 2
    report = RunReport()
    _process_one(config, rows[0]["id"], force=args.force, no_write=args.no_write, report=report)
    report.print()
    return 0 if not report.failed else 1


def _run_bulk(args: argparse.Namespace, config: Config) -> int:
    sb = sb_client.service_client(config)
    rows = sb.table("ingredients").select("id").order("id").execute().data or []
    if args.ids:
        wanted = {s.strip() for s in args.ids.split(",")}
        rows = [r for r in rows if r["id"] in wanted]
    if args.limit:
        rows = rows[: args.limit]

    log.step(f"fetch-ingredient-images · {len(rows)} ingredient(s)")
    report = RunReport()
    for i, row in enumerate(rows):
        _process_one(config, row["id"], force=args.force, no_write=args.no_write, report=report)
        if i < len(rows) - 1:
            time.sleep(SLEEP_BETWEEN_REQUESTS_S)
    report.print()

    if rows and not (report.fetched or report.skipped or report.misses):
        return 1
    return 0


def register(subparsers: argparse._SubParsersAction) -> None:
    p = subparsers.add_parser(
        "fetch-ingredient-image",
        help="Fetch one ingredient image from thiings.co",
    )
    p.add_argument("id", help="ingredient id (used as the thiings slug)")
    p.add_argument("--force", action="store_true")
    p.add_argument("--no-write", action="store_true")
    p.set_defaults(handler=_run_single)


def register_bulk(subparsers: argparse._SubParsersAction) -> None:
    p = subparsers.add_parser(
        "fetch-ingredient-images",
        help="Bulk fetch ingredient images from thiings.co (idempotent)",
    )
    p.add_argument("--force", action="store_true")
    p.add_argument("--no-write", action="store_true")
    p.add_argument("--limit", type=int, default=None)
    p.add_argument("--ids", default=None, help="comma-separated ingredient ids")
    p.set_defaults(handler=_run_bulk)
