"""psycopg connection helpers.

DDL and multi-statement SQL files run here. Single-row reads can also use
this client — keeps round-trip count low for `status`-style commands.
"""

from __future__ import annotations

from contextlib import contextmanager
from pathlib import Path
from typing import Iterator

import psycopg

from ..core.config import Config
from ..core.files import read_sql


@contextmanager
def connection(config: Config) -> Iterator[psycopg.Connection]:
    """Yield a psycopg connection scoped to `with`. autocommit defaults off."""
    url = config.require_db_url()
    conn = psycopg.connect(url, autocommit=False)
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def exec_sql_file(conn: psycopg.Connection, path: Path) -> None:
    """Run an entire SQL file. psycopg's `execute` happily handles the
    multi-statement string Postgres uses for our schema/seed files."""
    sql = read_sql(path)
    with conn.cursor() as cur:
        cur.execute(sql)


def exec_sql(conn: psycopg.Connection, sql: str, params: tuple | dict | None = None):
    """Single-statement parameterised exec. Returns the cursor for fetches."""
    cur = conn.cursor()
    cur.execute(sql, params)
    return cur
