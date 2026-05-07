"""Filesystem path helpers for routine jobs."""

from __future__ import annotations

from functools import cache
from pathlib import Path


@cache
def repo_root() -> Path:
    """Return the mfc repo root.

    Resolved from this file's location: routine/routine/lib/paths.py
    parents[0] = lib/, [1] = routine package, [2] = routine project, [3] = repo root.
    """
    return Path(__file__).resolve().parents[3]


def artifact_dir(context) -> Path:
    """Return (and create) routine/artifacts/<run_id>/ for the current run."""
    out = repo_root() / "routine" / "artifacts" / context.run_id
    out.mkdir(parents=True, exist_ok=True)
    return out
