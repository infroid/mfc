"""Dagster code location for the routine project. Loaded by workspace.yaml."""

from __future__ import annotations

from dagster import Definitions, EnvVar

from .resources.env import load_repo_root_env
from .resources.supabase import SupabaseResource

load_repo_root_env()

defs = Definitions(
    jobs=[],
    resources={
        "supabase": SupabaseResource(
            url=EnvVar("SUPABASE_URL"),
            publishable_key=EnvVar("SUPABASE_PUBLISHABLE_KEY"),
            secret_key=EnvVar("SUPABASE_SECRET_KEY"),
            db_url=EnvVar("SUPABASE_DB_URL"),
        ),
    },
)
