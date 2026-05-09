"""`mfc fetch-ingredient-nutrition[s]` — populate USDA FDC nutrition into
ingredient bundle JSONs. AI fallback available via --ai-fallback flag."""

from __future__ import annotations

import argparse
import json
import time
from dataclasses import dataclass, field
from pathlib import Path

from ..clients import sb as sb_client
from ..core import log
from ..core.config import Config
from ..ops import aifill, fdc


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
        for label, items in (("Misses", self.misses), ("Failed", self.failed)):
            if items:
                log.info(f"{label}:")
                for slug, reason in items:
                    log.info(f"  - {slug}   ({reason})")


def _bundle_path(config: Config, ingredient_id: str) -> Path:
    return config.repo_root / "web" / REL_DIR / ingredient_id / "ingredient.json"


def _load_or_init_bundle(config: Config, ingredient_id: str, name: str) -> dict:
    p = _bundle_path(config, ingredient_id)
    if p.exists():
        return json.loads(p.read_text())
    return {"id": ingredient_id, "name": name}


def _write_bundle(config: Config, ingredient_id: str, bundle: dict) -> None:
    p = _bundle_path(config, ingredient_id)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(bundle, indent=2, ensure_ascii=False) + "\n")


def _process_one(
    sb,
    config: Config,
    row: dict,
    *,
    force: bool,
    no_write: bool,
    fdc_id_pin: int | None,
    report: RunReport,
    args_namespace,
) -> None:
    iid = row["id"]
    existing_block = (row.get("nutrition") or {}) if isinstance(row.get("nutrition"), dict) else {}
    if existing_block.get("source") and not force:
        report.skipped.append(iid)
        return

    api_key = config.require_fdc()
    try:
        if fdc_id_pin is not None:
            block = fdc.fetch_for_id(fdc_id_pin, api_key=api_key)
        else:
            block = fdc.fetch_for_name(row["name"], api_key=api_key)
    except fdc.FdcNotFound:
        if not getattr(args_namespace, "ai_fallback", False):
            report.misses.append((iid, "fdc-no-match"))
            return
        if not config.anthropic_api_key:
            # AI fallback opted in but no key configured — skip silently
            # so the FDC-only enrichment elsewhere in the run still proceeds.
            report.misses.append((iid, "ai-fallback-skipped-no-key"))
            return
        try:
            block = aifill.suggest_nutrition(row["name"], category=row.get("category"), api_key=config.anthropic_api_key)
        except aifill.AiFillError as exc:
            report.misses.append((iid, f"ai-fallback-failed: {exc}"))
            return
    except fdc.FdcError as exc:
        report.failed.append((iid, f"fdc-error: {exc}"))
        return

    if not no_write:
        bundle = _load_or_init_bundle(config, iid, row["name"])
        bundle["nutrition"] = block
        _write_bundle(config, iid, bundle)

        sb.table("ingredients").update({
            "nutrition": block,
            "nutrition_source": block["source"],
            "fdc_id": block.get("fdcId"),
            "ai_filled_at": block.get("aiFilledAt"),
        }).eq("id", iid).execute()

    report.fetched.append(iid)


def _run_single(args: argparse.Namespace, config: Config) -> int:
    sb = sb_client.service_client(config)
    rows = sb.table("ingredients").select("id, name, category, nutrition").eq("id", args.id).execute().data or []
    if not rows:
        log.error(f"ingredient '{args.id}' not found")
        return 2
    report = RunReport()
    _process_one(
        sb, config, rows[0],
        force=args.force,
        no_write=args.no_write,
        fdc_id_pin=args.fdc_id,
        report=report,
        args_namespace=args,
    )
    report.print()
    return 0 if not report.failed else 1


def _run_bulk(args: argparse.Namespace, config: Config) -> int:
    sb = sb_client.service_client(config)
    rows = sb.table("ingredients").select("id, name, category, nutrition").order("id").execute().data or []
    if args.ids:
        wanted = {s.strip() for s in args.ids.split(",")}
        rows = [r for r in rows if r["id"] in wanted]
    if args.limit:
        rows = rows[: args.limit]

    log.step(f"fetch-ingredient-nutrition · {len(rows)} ingredient(s)")
    report = RunReport()
    for i, row in enumerate(rows):
        _process_one(
            sb, config, row,
            force=args.force,
            no_write=args.no_write,
            fdc_id_pin=None,
            report=report,
            args_namespace=args,
        )
        if i < len(rows) - 1:
            time.sleep(SLEEP_BETWEEN_REQUESTS_S)
    report.print()
    if rows and not (report.fetched or report.skipped or report.misses):
        return 1
    return 0


def register(subparsers: argparse._SubParsersAction) -> None:
    p = subparsers.add_parser(
        "fetch-ingredient-nutrition",
        help="Fetch USDA FDC nutrition for one ingredient (or bulk if no id)",
    )
    p.add_argument("id", nargs="?", help="ingredient id (omit for bulk form)")
    p.add_argument("--force", action="store_true")
    p.add_argument("--no-write", action="store_true")
    p.add_argument("--fdc-id", type=int, default=None,
                   help="(single only) skip search; pull this FDC food id directly")
    p.add_argument("--ai-fallback", action="store_true",
                   help="try Anthropic AI when FDC misses (requires ANTHROPIC_API_KEY)")
    p.add_argument("--limit", type=int, default=None,
                   help="(bulk only) cap to first N rows after --ids filter")
    p.add_argument("--ids", default=None,
                   help="(bulk only) comma-separated ingredient ids")
    p.set_defaults(handler=_dispatch)


def _dispatch(args: argparse.Namespace, config: Config) -> int:
    if args.id:
        return _run_single(args, config)
    return _run_bulk(args, config)
