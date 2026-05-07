"""Generate a structured schema report from the live Postgres database.

This module currently exposes:
  - Pydantic models (Column, ForeignKey, AggregateStat, Table, SchemaReport)
  - collect_schema op: queries pg_catalog/information_schema/pg_policies via psycopg.

render_html and the wired job arrive in Task 10.
"""

from datetime import datetime, timezone
from typing import Any

from dagster import OpExecutionContext, op
from pydantic import BaseModel

from ..resources.supabase import SupabaseResource


class Column(BaseModel):
    name: str
    type: str
    nullable: bool
    default: str | None
    comment: str | None


class ForeignKey(BaseModel):
    column: str
    references_table: str
    references_column: str


class AggregateStat(BaseModel):
    column: str
    kind: str  # "numeric_range" | "distinct_values"
    detail: dict[str, Any]


class Table(BaseModel):
    name: str
    comment: str | None
    columns: list[Column]
    primary_key: list[str]
    foreign_keys: list[ForeignKey]
    policies: list[str]
    row_count: int
    stats: list[AggregateStat] = []


class SchemaReport(BaseModel):
    generated_at: str
    tables: list[Table]


_TABLES_SQL = """
SELECT c.relname,
       obj_description(c.oid, 'pg_class') AS comment
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public' AND c.relkind = 'r'
 ORDER BY c.relname;
"""

_COLUMNS_SQL = """
SELECT cols.table_name,
       cols.column_name,
       cols.data_type,
       cols.is_nullable,
       cols.column_default,
       col_description(format('public.%I', cols.table_name)::regclass, cols.ordinal_position)
  FROM information_schema.columns cols
 WHERE cols.table_schema = 'public'
 ORDER BY cols.table_name, cols.ordinal_position;
"""

_PK_SQL = """
SELECT tc.table_name, kcu.column_name
  FROM information_schema.table_constraints tc
  JOIN information_schema.key_column_usage kcu
    ON tc.constraint_name = kcu.constraint_name
 WHERE tc.table_schema = 'public' AND tc.constraint_type = 'PRIMARY KEY'
 ORDER BY tc.table_name, kcu.ordinal_position;
"""

_FK_SQL = """
SELECT tc.table_name, kcu.column_name,
       ccu.table_name AS ref_table, ccu.column_name AS ref_column
  FROM information_schema.referential_constraints rc
  JOIN information_schema.table_constraints tc
    ON tc.constraint_name = rc.constraint_name
  JOIN information_schema.key_column_usage kcu
    ON kcu.constraint_name = rc.constraint_name
  JOIN information_schema.constraint_column_usage ccu
    ON ccu.constraint_name = rc.unique_constraint_name
 WHERE tc.table_schema = 'public'
 ORDER BY tc.table_name, kcu.ordinal_position;
"""

_POLICIES_SQL = """
SELECT tablename, policyname, cmd, qual
  FROM pg_policies
 WHERE schemaname = 'public'
 ORDER BY tablename, policyname;
"""


@op
def collect_schema(context: OpExecutionContext, supabase: SupabaseResource) -> SchemaReport:
    with supabase.pg() as conn:
        cur = conn.cursor()
        cur.execute(_TABLES_SQL)
        tables_raw = list(cur.fetchall())

        cur.execute(_COLUMNS_SQL)
        cols_by_table: dict[str, list[Column]] = {}
        for row in cur.fetchall():
            tname, cname, ctype, is_null, cdefault, ccomment = row
            cols_by_table.setdefault(tname, []).append(
                Column(
                    name=cname, type=ctype, nullable=(is_null == "YES"),
                    default=cdefault, comment=ccomment,
                )
            )

        cur.execute(_PK_SQL)
        pk_by_table: dict[str, list[str]] = {}
        for tname, cname in cur.fetchall():
            pk_by_table.setdefault(tname, []).append(cname)

        cur.execute(_FK_SQL)
        fk_by_table: dict[str, list[ForeignKey]] = {}
        for tname, col, ref_table, ref_col in cur.fetchall():
            fk_by_table.setdefault(tname, []).append(
                ForeignKey(column=col, references_table=ref_table, references_column=ref_col)
            )

        cur.execute(_POLICIES_SQL)
        pol_by_table: dict[str, list[str]] = {}
        for tname, pname, cmd, qual in cur.fetchall():
            pol_by_table.setdefault(tname, []).append(f"{pname} ({cmd}): {qual}")

        tables: list[Table] = []
        for tname, tcomment in tables_raw:
            cur.execute(f'SELECT count(*) FROM public."{tname}"')
            row = cur.fetchone() or (0,)
            rcount = row[0]
            cols = cols_by_table.get(tname, [])
            stats = _collect_stats(cur, tname, cols)
            tables.append(Table(
                name=tname, comment=tcomment, columns=cols,
                primary_key=pk_by_table.get(tname, []),
                foreign_keys=fk_by_table.get(tname, []),
                policies=pol_by_table.get(tname, []),
                row_count=rcount, stats=stats,
            ))

    return SchemaReport(
        generated_at=datetime.now(timezone.utc).isoformat(timespec="seconds"),
        tables=tables,
    )


_NUMERIC_TYPES = {"smallint", "integer", "bigint", "numeric", "real", "double precision"}


def _collect_stats(cur, table: str, columns: list[Column]) -> list[AggregateStat]:
    stats: list[AggregateStat] = []
    for col in columns:
        if col.type in _NUMERIC_TYPES:
            cur.execute(f'SELECT min("{col.name}"), max("{col.name}") FROM public."{table}"')
            row = cur.fetchone() or (None, None)
            mn, mx = row
            stats.append(AggregateStat(
                column=col.name, kind="numeric_range",
                detail={"min": mn, "max": mx},
            ))
        elif col.type == "text":
            cur.execute(f'SELECT count(DISTINCT "{col.name}") FROM public."{table}"')
            row = cur.fetchone() or (0,)
            n = row[0]
            if n is not None and n <= 32:
                cur.execute(
                    f'SELECT "{col.name}", count(*) FROM public."{table}" '
                    f'GROUP BY 1 ORDER BY 2 DESC LIMIT 32'
                )
                stats.append(AggregateStat(
                    column=col.name, kind="distinct_values",
                    detail={"counts": list(cur.fetchall())},
                ))
    return stats
