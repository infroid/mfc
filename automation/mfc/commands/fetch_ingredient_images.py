"""`mfc fetch-ingredient-image[s]` — download illustrated PNGs from
thiings.co/things/<slug> into ingredient bundle dirs.

Idempotent on disk: files that already exist are skipped unless --force.
DB rows are NOT updated by this command — sync-ingredient-images +
sync-ingredients handle that downstream.
"""

from __future__ import annotations

import argparse
import json
import re
import time
from dataclasses import dataclass, field
from pathlib import Path

from ..clients import sb as sb_client
from ..core import log
from ..core.config import Config
from ..ops import thiings


REL_DIR = "assets/ingredients"
SLEEP_BETWEEN_REQUESTS_S = 0.5
_SLUG_RX = re.compile(r"[^a-z0-9]+")


def _slugify(s: str) -> str:
    return _SLUG_RX.sub("-", (s or "").lower()).strip("-")


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


def _bundle_path(config: Config, ingredient_id: str) -> Path:
    return config.repo_root / "web" / REL_DIR / ingredient_id / "ingredient.json"


def _ensure_bundle_photo(config: Config, ingredient_id: str) -> bool:
    """Set bundle.photo to the legacy repo-relative path if not already set.

    Returns True if a write happened.
    """
    p = _bundle_path(config, ingredient_id)
    expected = f"{REL_DIR}/{ingredient_id}/image.png"
    bundle: dict = {}
    if p.exists():
        try:
            bundle = json.loads(p.read_text())
        except Exception:
            bundle = {}
    if bundle.get("photo") == expected:
        return False
    bundle.setdefault("id", ingredient_id)
    bundle["photo"] = expected
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(bundle, indent=2, ensure_ascii=False) + "\n")
    return True


def _candidate_slugs(ingredient_id: str, aliases: list[str] | None) -> list[str]:
    """Slugs to try in order: the id itself, then each alias slugified.
    Duplicates and empty values are dropped, order preserved."""
    seen: set[str] = set()
    out: list[str] = []
    for raw in (ingredient_id, *(aliases or [])):
        s = _slugify(raw)
        if s and s not in seen:
            seen.add(s)
            out.append(s)
    return out


def _process_one(
    config: Config,
    ingredient_id: str,
    aliases: list[str] | None,
    *,
    force: bool,
    no_write: bool,
    report: RunReport,
) -> None:
    out = _output_path(config, ingredient_id)
    if out.exists() and not force:
        report.skipped.append(ingredient_id)
        return

    slugs = _candidate_slugs(ingredient_id, aliases)
    data: bytes | None = None
    last_miss_reason: str | None = None
    for i, slug in enumerate(slugs):
        try:
            data = thiings.fetch_image(slug)
            if i > 0:
                log.info(f"  ↳ {ingredient_id}: matched alias {slug!r}")
            break
        except thiings.ThiingsNotFound as exc:
            last_miss_reason = exc.reason
            continue
        except thiings.ThiingsError as exc:
            report.failed.append((ingredient_id, f"{slug}: {exc.reason}"))
            return

    if data is None:
        tried = "/".join(slugs) if slugs else ingredient_id
        report.misses.append((ingredient_id, f"{last_miss_reason or 'no-slugs'} (tried: {tried})"))
        return

    if not no_write:
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_bytes(data)
        _ensure_bundle_photo(config, ingredient_id)
    report.fetched.append(ingredient_id)


def _run_single(args: argparse.Namespace, config: Config) -> int:
    sb = sb_client.service_client(config)
    rows = sb.table("ingredients").select("id, aliases").eq("id", args.id).execute().data or []
    if not rows:
        log.error(f"ingredient '{args.id}' not found in public.ingredients")
        return 2
    report = RunReport()
    _process_one(
        config, rows[0]["id"], rows[0].get("aliases"),
        force=args.force, no_write=args.no_write, report=report,
    )
    report.print()
    return 0 if not report.failed else 1


def _run_bulk(args: argparse.Namespace, config: Config) -> int:
    sb = sb_client.service_client(config)
    rows = sb.table("ingredients").select("id, aliases").order("id").execute().data or []
    if args.ids:
        wanted = {s.strip() for s in args.ids.split(",")}
        rows = [r for r in rows if r["id"] in wanted]
    if args.limit:
        rows = rows[: args.limit]

    log.step(f"fetch-ingredient-images · {len(rows)} ingredient(s)")
    report = RunReport()
    for i, row in enumerate(rows):
        will_skip = _output_path(config, row["id"]).exists() and not args.force
        _process_one(
            config, row["id"], row.get("aliases"),
            force=args.force, no_write=args.no_write, report=report,
        )
        if not will_skip and i < len(rows) - 1:
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
