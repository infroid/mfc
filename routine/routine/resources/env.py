"""Loads the repo-root .env so resources see SUPABASE_* env vars."""

from __future__ import annotations

from dotenv import load_dotenv

from ..lib.paths import repo_root


def load_repo_root_env() -> None:
    """Idempotent: load <repo-root>/.env without overriding existing env vars."""
    load_dotenv(repo_root() / ".env", override=False)
