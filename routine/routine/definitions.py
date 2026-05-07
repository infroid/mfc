"""Dagster code location for the routine project. Loaded by workspace.yaml."""

from __future__ import annotations

from dagster import Definitions

from .resources.env import load_repo_root_env

load_repo_root_env()

defs = Definitions(jobs=[], resources={})
