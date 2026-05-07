"""Run `mfc sync-recipes` from the automation/ project as a Dagster op."""

import subprocess
from typing import Literal

from dagster import Config, OpExecutionContext, job, op

from ..lib.paths import repo_root


class SyncConfig(Config):
    direction: Literal["pull", "push", "both"]
    only: list[str] = []


def _build_cmd(direction: str, only: list[str]) -> list[str]:
    cmd = [
        "uv",
        "--project",
        str(repo_root() / "automation"),
        "run",
        "mfc",
        "sync-recipes",
        "--direction",
        direction,
    ]
    for rid in only:
        cmd.extend(["--recipe", rid])
    return cmd


@op
def run_sync(context: OpExecutionContext, config: SyncConfig) -> str:
    cmd = _build_cmd(config.direction, config.only)
    context.log.info("running: " + " ".join(cmd))
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.stdout:
        context.log.info(proc.stdout)
    if proc.stderr:
        context.log.warning(proc.stderr)
    if proc.returncode != 0:
        raise RuntimeError(
            f"recipe-sync failed (exit {proc.returncode}): {proc.stderr.strip() or 'no stderr'}"
        )
    return proc.stdout


@job
def recipe_sync_job() -> None:
    run_sync()
