"""`mfc fetch-ingredient-nutrition[s]` — populate USDA FDC nutrition into
automation/db.sqlite. AI fallback available via --ai-fallback flag.

State model (reads ingredients.source from SQLite):
  - NULL          → never attempted; try FDC (and AI if --ai-fallback).
  - 'fdc'/'ai'    → succeeded; skip unless --force.
  - 'manual'      → hand-filled; skip unless --force.
  - 'fdc-miss'    → FDC tried, AI not actually invoked. Skip unless --force,
                    EXCEPT when --ai-fallback is now set: retry AI only.
  - 'ai-miss'     → both FDC and AI tried, both failed. Skip unless --force.
"""

from __future__ import annotations

import argparse
import time
from dataclasses import dataclass, field

from ..core import log
from ..core.config import Config
from ..ops import aifill, fdc
from ..ops.catalog import Catalog
from ..ops.usda_nutrient_map import NUTRIENT_MAP


SLEEP_BETWEEN_REQUESTS_S = 0.5
_TERMINAL_SOURCES = {"fdc", "ai", "manual", "ai-miss"}
_DETAILS_COLUMNS = set(NUTRIENT_MAP.values())


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


def _aliases_from_row(aliases_raw) -> list[str]:
    """SQLite stores aliases as a JSON string; tolerate either str or list."""
    import json as _json
    if isinstance(aliases_raw, str):
        try:
            v = _json.loads(aliases_raw)
            if isinstance(v, list):
                return v
        except Exception:
            return []
        return []
    if isinstance(aliases_raw, list):
        return aliases_raw
    return []


def _is_pending(row: dict, *, force: bool, ai_requested: bool) -> bool:
    if force:
        return True
    state = row.get("source")
    if state in _TERMINAL_SOURCES:
        return False
    if state == "fdc-miss" and not ai_requested:
        return False
    return True


def _persist_miss(catalog: Catalog, iid: str, marker: str) -> None:
    # Row is guaranteed to exist (we just SELECT'd it). Use a direct UPDATE
    # so the SQLite NOT NULL check on `name` doesn't fire on an INSERT
    # attempt before the ON CONFLICT clause kicks in.
    catalog.conn.execute("UPDATE ingredients SET source = ? WHERE id = ?", (marker, iid))
    catalog.conn.commit()


def _write_success(catalog: Catalog, iid: str, block: dict) -> None:
    """Write block (success path) to ingredients + ingredient_details.

    Direct UPDATE on ingredients (not upsert) — the row already exists; an
    INSERT path would hit SQLite's NOT NULL check on `name` before the
    ON CONFLICT clause runs.
    """
    updates: dict = {"source": block["source"]}
    if block.get("fdcId") is not None:
        updates["fdc_id"] = int(block["fdcId"])
    if block.get("aiFilledAt"):
        updates["ai_filled_at"] = block["aiFilledAt"]
    set_clause = ", ".join(f"{k} = ?" for k in updates)
    catalog.conn.execute(
        f"UPDATE ingredients SET {set_clause} WHERE id = ?",
        (*updates.values(), iid),
    )
    catalog.conn.commit()

    det: dict = {"id": iid, "nutrition_per": block.get("per", "100g")}
    if block.get("filledAt"):
        det["nutrition_filled_at"] = block["filledAt"]
    for k, v in block.items():
        if k in _DETAILS_COLUMNS and v is not None:
            det[k] = v
    catalog.upsert_details(det)


def _process_one(
    catalog: Catalog,
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
    state = row.get("source")
    ai_requested = bool(getattr(args_namespace, "ai_fallback", False))

    do_fdc = True
    do_ai = ai_requested
    if not force and fdc_id_pin is None:
        if state in _TERMINAL_SOURCES:
            report.skipped.append(iid)
            return
        if state == "fdc-miss":
            if ai_requested:
                do_fdc = False  # already known miss; only retry AI
            else:
                report.skipped.append(iid)
                return

    api_key = config.require_fdc()
    block = None
    miss_reason = None

    if do_fdc and fdc_id_pin is not None:
        try:
            block = fdc.fetch_for_id(fdc_id_pin, api_key=api_key)
        except fdc.FdcNotFound:
            miss_reason = "fdc-no-match"
        except fdc.FdcError as exc:
            report.failed.append((iid, f"fdc-error: {exc}"))
            return
    elif do_fdc:
        names_to_try: list[str] = [row["name"]]
        for alias in _aliases_from_row(row.get("aliases")):
            if alias and alias not in names_to_try:
                names_to_try.append(alias)
        for i, name_attempt in enumerate(names_to_try):
            try:
                block = fdc.fetch_for_name(name_attempt, api_key=api_key)
                if i > 0:
                    log.info(f"  ↳ {iid}: matched alias {name_attempt!r}")
                break
            except fdc.FdcNotFound:
                miss_reason = f"fdc-no-match (tried: {' / '.join(names_to_try[:i + 1])})"
                continue
            except fdc.FdcError as exc:
                report.failed.append((iid, f"fdc-error on {name_attempt!r}: {exc}"))
                return
    elif state == "fdc-miss":
        miss_reason = "fdc-no-match (cached)"

    ai_was_called = False
    if block is None and do_ai:
        if getattr(args_namespace, "_ai_disabled_mid_run", False):
            miss_reason = "ai-fallback-disabled-after-auth-error"
        elif not config.anthropic_api_key:
            miss_reason = "ai-fallback-skipped-no-key"
        else:
            try:
                ai_was_called = True
                block = aifill.suggest_nutrition(
                    row["name"],
                    category=row.get("category"),
                    api_key=config.anthropic_api_key,
                )
                miss_reason = None
            except aifill.AiFillError as exc:
                miss_reason = f"ai-fallback-failed: {exc}"
                msg = str(exc)
                if (
                    "AuthenticationError" in msg
                    or "PermissionDeniedError" in msg
                    or "invalid x-api-key" in msg
                ):
                    args_namespace._ai_disabled_mid_run = True
                    log.warn(f"AI fallback disabled for rest of run: {exc}")

    if block is None:
        marker = "ai-miss" if ai_was_called else "fdc-miss"
        report.misses.append((iid, miss_reason or "fdc-no-match"))
        if not no_write:
            _persist_miss(catalog, iid, marker)
        return

    if not no_write:
        _write_success(catalog, iid, block)
    report.fetched.append(iid)


def _run_single(args: argparse.Namespace, config: Config) -> int:
    catalog = Catalog(config.repo_root / "automation" / "db.sqlite")
    cur = catalog.conn.execute(
        "SELECT id, name, category, aliases, source FROM ingredients WHERE id=?",
        (args.id,),
    )
    r = cur.fetchone()
    if not r:
        log.error(f"ingredient '{args.id}' not found in automation/db.sqlite")
        catalog.close()
        return 2
    report = RunReport()
    _process_one(
        catalog, config, dict(r),
        force=args.force,
        no_write=args.no_write,
        fdc_id_pin=args.fdc_id,
        report=report,
        args_namespace=args,
    )
    catalog.close()
    report.print()
    return 0 if not report.failed else 1


def _run_bulk(args: argparse.Namespace, config: Config) -> int:
    catalog = Catalog(config.repo_root / "automation" / "db.sqlite")
    cur = catalog.conn.execute(
        "SELECT id, name, category, aliases, source FROM ingredients ORDER BY id"
    )
    rows = [dict(r) for r in cur.fetchall()]
    if args.ids:
        wanted = {s.strip() for s in args.ids.split(",")}
        rows = [r for r in rows if r["id"] in wanted]
    if args.limit:
        rows = rows[: args.limit]

    ai_requested = bool(args.ai_fallback)
    pending = sum(1 for r in rows if _is_pending(r, force=args.force, ai_requested=ai_requested))
    log.step(
        f"fetch-ingredient-nutrition · {len(rows)} ingredient(s) "
        f"({pending} pending; FDC rate limit ~1000/hr)"
    )
    if pending > 950:
        log.warn(f"about to attempt {pending} FDC requests — close to the 1000/hr limit; consider LIMIT=900")

    report = RunReport()
    try:
        for i, row in enumerate(rows):
            will_skip = not _is_pending(row, force=args.force, ai_requested=ai_requested)
            _process_one(
                catalog, config, row,
                force=args.force,
                no_write=args.no_write,
                fdc_id_pin=None,
                report=report,
                args_namespace=args,
            )
            if not will_skip and i < len(rows) - 1:
                time.sleep(SLEEP_BETWEEN_REQUESTS_S)
    finally:
        catalog.close()
        report.print()
    if rows and not (report.fetched or report.skipped or report.misses):
        return 1
    return 0


def register(subparsers: argparse._SubParsersAction) -> None:
    p = subparsers.add_parser(
        "fetch-ingredient-nutrition",
        help="Fetch USDA FDC nutrition for one ingredient (or bulk if no id); writes SQLite catalog",
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
