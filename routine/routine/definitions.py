"""Dagster code location for the routine project. Loaded by workspace.yaml."""

from __future__ import annotations

from dagster import Definitions, EnvVar

from .jobs.ocr_image import ocr_image_job
from .jobs.pdf_text import pdf_text_job
from .jobs.recipe_sync import recipe_sync_job
from .jobs.storage_fetch import storage_fetch_job
from .resources.env import load_repo_root_env
from .resources.supabase import SupabaseResource

load_repo_root_env()

defs = Definitions(
    jobs=[storage_fetch_job, ocr_image_job, pdf_text_job, recipe_sync_job],
    resources={
        "supabase": SupabaseResource(
            url=EnvVar("SUPABASE_URL"),
            publishable_key=EnvVar("SUPABASE_PUBLISHABLE_KEY"),
            secret_key=EnvVar("SUPABASE_SECRET_KEY"),
            db_url=EnvVar("SUPABASE_DB_URL"),
        ),
    },
)
