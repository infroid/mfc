"""Shared pytest fixtures for the mfc test suite."""

from __future__ import annotations

from pathlib import Path

import pytest


FIXTURES_DIR = Path(__file__).parent / "fixtures"


@pytest.fixture
def fixture_path():
    """Return a callable that resolves <fixtures>/<relpath>."""
    def _resolve(relpath: str) -> Path:
        return FIXTURES_DIR / relpath
    return _resolve
