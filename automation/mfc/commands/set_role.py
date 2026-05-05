"""`mfc set-role` — change a user's role.

Privileged mutation. Validates input, applies the last-admin guard, writes
app_metadata.role, and on demotion invalidates all of the target's sessions.

Honours the global --yes flag; otherwise prompts for demotion confirmations.
"""

from __future__ import annotations

import argparse

from ..core import log
from ..core.config import Config
from ..core.prompts import confirm
from ..ops import users as users_ops


def register(subparsers: argparse._SubParsersAction) -> None:
    p = subparsers.add_parser(
        "set-role",
        help="Change a user's role (user|chef|admin)",
    )
    p.add_argument("--user", required=True, help="Target email or UUID")
    p.add_argument(
        "--role",
        required=True,
        choices=users_ops.VALID_ROLES,
        help="New role",
    )
    p.add_argument(
        "--no-signout",
        action="store_true",
        help="Skip force-signout on demotion (rare; use with care)",
    )
    p.set_defaults(handler=run)


def run(args: argparse.Namespace, config: Config) -> int:
    try:
        before = users_ops.lookup(config, args.user)

        if before.role == args.role:
            log.warn(f"{before.email} is already {before.role} — no-op")
            return 0

        is_demote = users_ops.is_demotion(before.role, args.role)
        if is_demote and not args.no_signout:
            ok = confirm(
                f"  ! Demote {before.email} from {before.role} to {args.role}? "
                f"All active sessions will be ended.",
                assume_yes=getattr(args, "yes", False),
            )
            if not ok:
                log.warn("aborted")
                return 1

        before, after, signed_out = users_ops.set_role(
            config,
            target=args.user,
            new_role=args.role,
            force_signout=not args.no_signout,
        )
        sig = "yes" if signed_out else "no"
        log.ok(f"{before.email}  {before.role} → {after.role}  (signed out: {sig})")
        return 0
    except users_ops.RoleError as exc:
        log.error(str(exc))
        return 2
