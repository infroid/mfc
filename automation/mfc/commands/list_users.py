"""`mfc list-users` — list users with role + identity columns."""

from __future__ import annotations

import argparse

from ..core import log
from ..core.config import Config
from ..ops import users as users_ops


def register(subparsers: argparse._SubParsersAction) -> None:
    p = subparsers.add_parser(
        "list-users",
        help="List users (paginated) with role + identity columns",
    )
    p.add_argument(
        "--role",
        default="all",
        choices=("all", *users_ops.VALID_ROLES),
        help="Filter by role (default: all)",
    )
    p.add_argument("--q", default=None, help="Email substring (ILIKE)")
    p.add_argument("--page", type=int, default=1)
    p.add_argument("--per-page", type=int, default=50)
    p.set_defaults(handler=run)


def _truncate(s: str | None, n: int) -> str:
    s = s or ""
    return s if len(s) <= n else s[: n - 1] + "…"


def run(args: argparse.Namespace, config: Config) -> int:
    rows = users_ops.list_users(
        config,
        role=args.role,
        q=args.q,
        page=args.page,
        per_page=args.per_page,
    )
    if not rows:
        log.warn("no users match")
        return 0

    w_role = max(5, max(len(r.role) for r in rows))
    w_email = max(5, max(len(r.email) for r in rows))
    w_name = max(4, max(len(r.full_name or "") for r in rows))
    w_prov = max(8, max(len(r.provider) for r in rows))

    log.step(f"page {args.page} · {len(rows)} row(s)")
    header = f"  {'role':<{w_role}}  {'email':<{w_email}}  {'name':<{w_name}}  {'provider':<{w_prov}}  created"
    print(header)
    print("  " + "─" * (len(header) - 2))
    for r in rows:
        print(
            f"  {r.role:<{w_role}}  "
            f"{_truncate(r.email, w_email):<{w_email}}  "
            f"{_truncate(r.full_name or '—', w_name):<{w_name}}  "
            f"{r.provider:<{w_prov}}  "
            f"{(r.created_at or '')[:19]}"
        )
    return 0
