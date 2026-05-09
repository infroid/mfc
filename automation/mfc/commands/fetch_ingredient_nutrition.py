"""`mfc fetch-ingredient-nutrition[s]` — populate USDA FDC nutrition into
ingredient bundle JSONs. AI fallback available via --ai-fallback flag.

State model (read from `nutrition.source` in the bundle JSONB):
  - unset       → never attempted; will try FDC (and AI if --ai-fallback).
  - "fdc"       → FDC succeeded; skip unless --force.
  - "ai"        → AI fallback filled; skip unless --force.
  - "manual"    → hand-filled; skip unless --force.
  - "fdc-miss"  → FDC missed, AI not actually invoked. Skip unless --force,
                  EXCEPT when --ai-fallback is now set: retry AI only (FDC
                  is known to miss for this name; no point re-asking).
  - "ai-miss"   → both FDC and AI tried, both failed. Skip unless --force.

The miss block written to the JSONB is { source, filledAt, per:"100g" } so
sync-ingredients pull/push round-trips it cleanly and the bundle file is
self-describing about the row's state.
"""

from __future__ import annotations

import argparse
import json
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

from ..clients import sb as sb_client
from ..core import log
from ..core.config import Config
from ..ops import aifill, fdc


REL_DIR = "assets/ingredients"
SLEEP_BETWEEN_REQUESTS_S = 0.5
_TERMINAL_SOURCES = {"fdc", "ai", "manual", "ai-miss"}


def _now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _row_state(row: dict) -> str | None:
    """Return the row's nutrition state, preferring the JSONB `source`
    field (the canonical surface) and falling back to the
    `nutrition_source` column for rows written by older code paths."""
    nutrition = row.get("nutrition") or {}
    if isinstance(nutrition, dict):
        src = nutrition.get("source")
        if src:
            return src
    return row.get("nutrition_source")


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


def _persist_miss(
    sb, config: Config, iid: str, name: str, marker: str, *, no_write: bool,
) -> None:
    """Write the miss block to both the bundle JSONB and the column so
    subsequent runs skip this row (and the bundle on disk is
    self-describing)."""
    if no_write:
        return
    miss_block = {"source": marker, "filledAt": _now_iso(), "per": "100g"}
    bundle = _load_or_init_bundle(config, iid, name)
    bundle["nutrition"] = miss_block
    _write_bundle(config, iid, bundle)
    sb.table("ingredients").update({
        "nutrition": miss_block,
        "nutrition_source": marker,
    }).eq("id", iid).execute()


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
    state = _row_state(row)
    ai_requested = bool(getattr(args_namespace, "ai_fallback", False))

    # Decide which sub-steps to run based on existing state. --force bypasses
    # everything (re-do FDC and re-do AI if requested). --fdc-id pin is also
    # an explicit user action; treat like --force for skip purposes.
    do_fdc = True
    do_ai = ai_requested
    if not force and fdc_id_pin is None:
        if state in _TERMINAL_SOURCES:
            report.skipped.append(iid)
            return
        if state == "fdc-miss":
            if ai_requested:
                # FDC already tried + missed for this row's name/aliases.
                # Don't re-burn FDC quota; just retry AI.
                do_fdc = False
            else:
                report.skipped.append(iid)
                return
        # state is None → process normally (do_fdc=True, do_ai=ai_requested)

    api_key = config.require_fdc()
    block = None
    miss_reason = None

    if do_fdc and fdc_id_pin is not None:
        # Manual override: skip the search + alias dance.
        try:
            block = fdc.fetch_for_id(fdc_id_pin, api_key=api_key)
        except fdc.FdcNotFound:
            miss_reason = "fdc-no-match"
        except fdc.FdcError as exc:
            report.failed.append((iid, f"fdc-error: {exc}"))
            return
    elif do_fdc:
        # Try the main name first, then each alias verbatim, in order.
        names_to_try: list[str] = [row["name"]]
        for alias in (row.get("aliases") or []):
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
        # Skipping FDC because we already know it misses for this row.
        miss_reason = "fdc-no-match (cached)"

    # AI fallback: opted in, key configured, not disabled mid-run.
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
                # Auth / permission errors won't recover mid-run; disable
                # AI for the rest so we don't repeat the same error 393
                # times. Rate-limit and network errors are NOT auto-
                # disabling — those can recover within a run.
                msg = str(exc)
                if (
                    "AuthenticationError" in msg
                    or "PermissionDeniedError" in msg
                    or "invalid x-api-key" in msg
                ):
                    args_namespace._ai_disabled_mid_run = True
                    log.warn(f"AI fallback disabled for rest of run: {exc}")

    if block is None:
        # Marker semantics:
        #   "ai-miss"  — AI was actually invoked this run (success path
        #                taken or AiFillError raised) and FDC was either
        #                tried-and-missed this run or known-missed before.
        #   "fdc-miss" — FDC missed; AI was NOT actually invoked (not
        #                requested, no key, disabled mid-run). Subsequent
        #                runs with --ai-fallback can retry AI without
        #                re-burning FDC quota.
        marker = "ai-miss" if ai_was_called else "fdc-miss"
        report.misses.append((iid, miss_reason or "fdc-no-match"))
        _persist_miss(sb, config, iid, row["name"], marker, no_write=no_write)
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
    rows = sb.table("ingredients").select("id, name, category, aliases, nutrition, nutrition_source").eq("id", args.id).execute().data or []
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
    rows = sb.table("ingredients").select("id, name, category, aliases, nutrition, nutrition_source").order("id").execute().data or []
    if args.ids:
        wanted = {s.strip() for s in args.ids.split(",")}
        rows = [r for r in rows if r["id"] in wanted]
    if args.limit:
        rows = rows[: args.limit]

    ai_requested = bool(args.ai_fallback)

    def _is_pending(r: dict) -> bool:
        if args.force:
            return True
        st = _row_state(r)
        if st in _TERMINAL_SOURCES:
            return False
        if st == "fdc-miss" and not ai_requested:
            return False
        return True

    pending = sum(1 for r in rows if _is_pending(r))
    log.step(
        f"fetch-ingredient-nutrition · {len(rows)} ingredient(s) "
        f"({pending} pending; FDC rate limit ~1000/hr)"
    )
    if pending > 950:
        log.warn(f"about to attempt {pending} FDC requests — close to the 1000/hr limit; consider LIMIT=900")
    report = RunReport()
    try:
        for i, row in enumerate(rows):
            will_skip = not _is_pending(row)
            _process_one(
                sb, config, row,
                force=args.force,
                no_write=args.no_write,
                fdc_id_pin=None,
                report=report,
                args_namespace=args,
            )
            if not will_skip and i < len(rows) - 1:
                time.sleep(SLEEP_BETWEEN_REQUESTS_S)
    finally:
        # Always print the report so partial progress + miss reasons
        # are visible even when the loop is interrupted (Ctrl-C,
        # unexpected exception, etc.).
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
