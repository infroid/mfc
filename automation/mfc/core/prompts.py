"""Confirmation prompts honoring the global --yes flag."""

from __future__ import annotations

import sys


def confirm(question: str, *, assume_yes: bool = False) -> bool:
    """Yes/no prompt; assume_yes short-circuits to True."""
    if assume_yes:
        return True
    if not sys.stdin.isatty():
        # Non-interactive (CI / pipe) without --yes is a hard no by default.
        return False
    answer = input(f"{question} [y/N]: ").strip().lower()
    return answer in {"y", "yes"}


def confirm_destructive(prompt: str, expected: str, *, assume_yes: bool = False) -> bool:
    """Type-the-magic-word confirmation for destructive ops.

    Refuses non-interactive runs unless `assume_yes` is set, so a misfired
    `mfc reset` in CI doesn't wipe production by default.
    """
    if assume_yes:
        return True
    if not sys.stdin.isatty():
        return False
    print(prompt)
    answer = input(f"  Type '{expected}' to proceed (anything else aborts): ").strip()
    return answer == expected
