"""`mfc suspend-user` — ban a user.

Privileged mutation. Sets auth.users.banned_until via the Auth admin API
and force-signs the target out of all active sessions. Honours `--yes`;
otherwise prompts for confirmation.
"""

from __future__ import annotations

import argparse

from ..core import log
from ..core.config import Config
from ..core.prompts import confirm
from ..ops import users as users_ops


def register(subparsers: argparse._SubParsersAction) -> None:
    p = subparsers.add_parser(
        "suspend-user",
        help="Suspend a user (bans login, ends sessions)",
    )
    p.add_argument("--user", required=True, help="Target email or UUID")
    p.add_argument(
        "--duration",
        default="876000h",
        help="GoTrue ban_duration (e.g. '24h', '876000h' for permanent; default permanent)",
    )
    p.set_defaults(handler=run)


def run(args: argparse.Namespace, config: Config) -> int:
    try:
        before = users_ops.lookup(config, args.user)
        ok = confirm(
            f"  ! Suspend {before.email} ({before.role})? "
            f"They will be signed out and unable to log back in.",
            assume_yes=getattr(args, "yes", False),
        )
        if not ok:
            log.warn("aborted")
            return 1

        after, signed_out = users_ops.suspend(
            config, target=args.user, duration=args.duration,
        )
        sig = "yes" if signed_out else "no"
        log.ok(f"{after.email}  suspended  (signed out: {sig})")
        return 0
    except users_ops.RoleError as exc:
        log.error(str(exc))
        return 2
