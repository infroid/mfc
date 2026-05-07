from __future__ import annotations

import uuid

from dagster import build_op_context

from routine.jobs.schema_report import (
    Column,
    ForeignKey,
    SchemaReport,
    Table,
    collect_schema,
)
from routine.resources.supabase import SupabaseResource

# Module-level registry keyed by token. Survives Dagster's resource re-instantiation
# because the token is stored in a real Pydantic field (fake_token).
_REGISTRY: dict[str, dict] = {}


class _FakeCursor:
    def __init__(self, scripted: dict[str, list[tuple]]) -> None:
        self.scripted = scripted
        self._rows: list[tuple] = []

    def execute(self, sql, params=None):
        # Return a different row set per query keyword.
        for key, rows in self.scripted.items():
            if key in sql:
                self._rows = rows
                return
        self._rows = []

    def fetchone(self):
        return self._rows[0] if self._rows else None

    def fetchall(self):
        return list(self._rows)

    def __iter__(self):
        return iter(self._rows)

    def __enter__(self): return self
    def __exit__(self, *a): pass


class _FakeConn:
    def __init__(self, scripted): self.scripted = scripted
    def cursor(self): return _FakeCursor(self.scripted)
    def close(self): pass
    def __enter__(self): return self
    def __exit__(self, *a): self.close()


class _FakeSupabase(SupabaseResource):
    # Extra field that survives Dagster re-instantiation; used as registry key.
    fake_token: str = ""

    def pg(self):  # type: ignore[override]
        return _FakeConn(_REGISTRY.get(self.fake_token, {}))


def _resource(scripted: dict) -> _FakeSupabase:
    token = str(uuid.uuid4())
    _REGISTRY[token] = scripted
    return _FakeSupabase(
        url="x", publishable_key="x", secret_key="x", db_url="x",
        fake_token=token,
    )


def test_collect_schema_returns_structured_report():
    # Map keywords to row sets matching the SQL constants in the implementation.
    scripted = {
        "pg_class": [("recipes", "Recipe catalog")],
        "information_schema.columns": [
            ("recipes", "id", "uuid", "NO", None, "Primary key"),
            ("recipes", "title", "text", "NO", None, None),
        ],
        "PRIMARY KEY": [("recipes", "id")],
        "referential_constraints": [],  # FKs (none)
        "pg_policies": [("recipes", "recipes_select", "SELECT", "true")],
        "count(*)": [(42,)],
    }
    ctx = build_op_context(resources={"supabase": _resource(scripted)})
    report = collect_schema(ctx)
    assert isinstance(report, SchemaReport)
    assert len(report.tables) == 1
    t = report.tables[0]
    assert isinstance(t, Table)
    assert t.name == "recipes"
    assert t.row_count == 42
    assert [c.name for c in t.columns] == ["id", "title"]
    assert t.primary_key == ["id"]
    assert t.foreign_keys == []
    assert any("SELECT" in p for p in t.policies)


from routine.jobs.schema_report import render_html


def _sample_report() -> SchemaReport:
    return SchemaReport(
        generated_at="2026-05-08T00:00:00+00:00",
        tables=[Table(
            name="recipes", comment="Recipe catalog",
            columns=[Column(name="id", type="uuid", nullable=False, default=None, comment="PK")],
            primary_key=["id"], foreign_keys=[], policies=[],
            row_count=42, stats=[],
        )],
    )


def test_render_html_writes_file_with_table_name(tmp_path, monkeypatch):
    monkeypatch.setattr("routine.lib.paths.repo_root", lambda: tmp_path)
    ctx = build_op_context()
    out = render_html(ctx, _sample_report())
    body = open(out).read()
    assert "recipes" in body
    assert "Recipe catalog" in body
    assert "42" in body
