"""Seed operations — currently just `metric_definitions`."""

from __future__ import annotations

from ..clients import pg
from ..core import files, log
from ..core.config import Config


def seed_metrics(config: Config) -> None:
    path = files.seed_metrics_sql(config.repo_root)
    log.step(f"seeding metric_definitions from {path.relative_to(config.repo_root)}")
    with pg.connection(config) as conn:
        pg.exec_sql_file(conn, path)
        # Quick sanity: how many rows landed.
        cur = pg.exec_sql(conn, "SELECT count(*) FROM public.metric_definitions")
        count = cur.fetchone()[0]
    log.ok(f"metric_definitions has {count} rows")
