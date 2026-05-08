from __future__ import annotations

from dagster import Definitions

from routine.definitions import defs


def test_definitions_are_loadable():
    Definitions.validate_loadable(defs)
