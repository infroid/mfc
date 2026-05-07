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
    proc = subprocess.Popen(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,  # interleave so order is preserved
        text=True,
        bufsize=1,
    )
    lines: list[str] = []
    assert proc.stdout is not None
    for line in proc.stdout:
        line = line.rstrip()
        if line:
            context.log.info(line)
            lines.append(line)
    rc = proc.wait()
    if rc != 0:
        tail = "\n".join(lines[-20:])
        raise RuntimeError(f"recipe-sync failed (exit {rc}). Last output:\n{tail}")
    return "\n".join(lines)


@job
def recipe_sync_job() -> None:
    run_sync()
