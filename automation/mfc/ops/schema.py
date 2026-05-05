"""DDL operations against the public schema."""

from __future__ import annotations

from ..clients import pg
from ..core import files, log
from ..core.config import Config


# Same DROP block that lives commented at the top of data/db/schema.sql.
# Listed here so commands can wipe without uncomment-edit-recomment churn.
DROP_ALL_SQL = """
DROP TABLE IF EXISTS public.meal_logs, public.cooking_sessions, public.saved_recipes,
  public.recommendations, public.user_health_markers, public.user_profiles,
  public.recipe_health_facts, public.recipe_tags, public.recipe_utensils,
  public.recipe_steps, public.recipe_ingredients, public.utensil_buy_links,
  public.recipes, public.utensils, public.ingredients, public.metric_definitions
  CASCADE;
DROP FUNCTION IF EXISTS public.touch_updated_at, public.is_admin CASCADE;
"""


def status(config: Config) -> None:
    """List public tables with row counts."""
    with pg.connection(config) as conn:
        cur = pg.exec_sql(
            conn,
            "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename",
        )
        tables = [row[0] for row in cur.fetchall()]
        if not tables:
            log.warn("no tables found in `public` schema — run `apply-schema` first")
            return
        log.step(f"public schema · {len(tables)} table(s)")
        # Format: "  table_name ........ N rows"
        max_name = max(len(t) for t in tables)
        for name in tables:
            cur = pg.exec_sql(conn, f"SELECT count(*) FROM public.{name}")
            count = cur.fetchone()[0]
            dots = "." * max(3, max_name + 4 - len(name))
            log.info(f"{name} {dots} {count:>6} row{'s' if count != 1 else ''}")


def apply(config: Config) -> None:
    """Run the canonical schema.sql top-to-bottom (idempotent)."""
    path = files.schema_sql(config.repo_root)
    log.step(f"applying schema from {path.relative_to(config.repo_root)}")
    with pg.connection(config) as conn:
        pg.exec_sql_file(conn, path)
    log.ok("schema applied")


def drop(config: Config) -> None:
    """DROP all known public tables CASCADE. Confirmation is the caller's job."""
    log.step("dropping all known public tables (CASCADE)")
    with pg.connection(config) as conn:
        with conn.cursor() as cur:
            cur.execute(DROP_ALL_SQL)
    log.ok("schema dropped")
