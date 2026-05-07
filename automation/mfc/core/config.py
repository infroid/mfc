"""Loads configuration from .env. The single source of truth for credentials."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

# `dotenv` is a dev tool; tolerate its absence so the package imports cleanly
# even when used in CI with env vars set externally.
try:
    from dotenv import load_dotenv  # type: ignore[import-untyped]
except ImportError:  # pragma: no cover — dotenv is in pyproject.toml
    def load_dotenv(*_args, **_kwargs):
        return False


# automation/mfc/core/config.py
#   parents[0] = automation/mfc/core/
#   parents[1] = automation/mfc/
#   parents[2] = automation/        ← pyproject.toml lives here
#   parents[3] = repo root          ← .env, .env.sample, data/, docs/
PACKAGE_DIR    = Path(__file__).resolve().parents[1]
AUTOMATION_DIR = Path(__file__).resolve().parents[2]
REPO_ROOT      = Path(__file__).resolve().parents[3]


@dataclass(frozen=True)
class Config:
    """Resolved configuration. Construct via `Config.load()`.

    Fields are populated only when present so subcommands can validate the
    keys they actually need rather than failing on unrelated misses.
    """

    db_url: Optional[str]
    supabase_url: Optional[str]
    supabase_secret_key: Optional[str]
    supabase_publishable_key: Optional[str]
    repo_root: Path

    @classmethod
    def load(cls, env_file: Optional[str] = None) -> "Config":
        # Default: <repo-root>/.env (shared with routine/).
        path = Path(env_file) if env_file else (REPO_ROOT / ".env")
        if path.exists():
            load_dotenv(path, override=False)
        return cls(
            db_url=os.environ.get("SUPABASE_DB_URL") or None,
            supabase_url=os.environ.get("SUPABASE_URL") or None,
            supabase_secret_key=os.environ.get("SUPABASE_SECRET_KEY") or None,
            supabase_publishable_key=os.environ.get("SUPABASE_PUBLISHABLE_KEY") or None,
            repo_root=REPO_ROOT,
        )

    def require_db_url(self) -> str:
        if not self.db_url:
            raise ConfigError(
                "SUPABASE_DB_URL is required for this command. "
                "Copy .env.sample to .env and fill in the database connection string."
            )
        return self.db_url

    def require_supabase(self) -> tuple[str, str]:
        missing = []
        if not self.supabase_url:
            missing.append("SUPABASE_URL")
        if not self.supabase_secret_key:
            missing.append("SUPABASE_SECRET_KEY")
        if missing:
            raise ConfigError(
                f"{', '.join(missing)} required for this command. "
                "Set them in .env."
            )
        return self.supabase_url, self.supabase_secret_key  # type: ignore[return-value]


class ConfigError(RuntimeError):
    """Raised when a required configuration value is absent."""
