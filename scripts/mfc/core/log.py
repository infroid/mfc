"""Tiny styled logger — keeps CLI output legible without an extra dep.

ANSI colors only when stdout is a TTY; otherwise plain text so output
piped into a file (or CI logs) stays clean.
"""

from __future__ import annotations

import sys

_USE_COLOR = sys.stdout.isatty()


def _wrap(text: str, code: str) -> str:
    if not _USE_COLOR:
        return text
    return f"\033[{code}m{text}\033[0m"


def info(msg: str) -> None:
    print(f"  {msg}")


def step(label: str) -> None:
    """Major progress beat — bold-ish."""
    print(_wrap(f"\n→ {label}", "1"))


def ok(msg: str) -> None:
    print(_wrap(f"  ✓ {msg}", "32"))


def warn(msg: str) -> None:
    print(_wrap(f"  ! {msg}", "33"))


def error(msg: str) -> None:
    print(_wrap(f"  ✗ {msg}", "31"), file=sys.stderr)


def header(title: str) -> None:
    rule = "─" * max(4, min(60, len(title) + 4))
    print()
    print(_wrap(rule, "36"))
    print(_wrap(f"  {title}", "1;36"))
    print(_wrap(rule, "36"))
