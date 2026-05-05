"""Repo filesystem access — SQL files and recipe bundles.

After the v2 layout move:
  automation/db/*.sql       — Python tooling only
  web/assets/recipes/<id>/  — recipe bundles served by the browser
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Iterator


def schema_sql(repo_root: Path) -> Path:
    return repo_root / "automation" / "db" / "schema.sql"


def seed_metrics_sql(repo_root: Path) -> Path:
    return repo_root / "automation" / "db" / "seed_metrics.sql"


def recipe_bundles_root(repo_root: Path) -> Path:
    return repo_root / "web" / "assets" / "recipes"


def read_sql(path: Path) -> str:
    if not path.exists():
        raise FileNotFoundError(f"SQL file not found: {path}")
    return path.read_text(encoding="utf-8")


def iter_recipe_bundles(repo_root: Path) -> Iterator[Path]:
    """Yield each `recipe.json` under web/assets/recipes/, sorted by id."""
    root = recipe_bundles_root(repo_root)
    if not root.exists():
        return
    for child in sorted(root.iterdir()):
        if not child.is_dir():
            continue
        recipe_file = child / "recipe.json"
        if recipe_file.exists():
            yield recipe_file


def load_recipe_json(path: Path) -> dict:
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)
