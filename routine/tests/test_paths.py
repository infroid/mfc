from pathlib import Path

from dagster import build_op_context

from routine.lib.paths import artifact_dir, repo_root


def test_repo_root_points_at_mfc_repo():
    root = repo_root()
    assert (root / ".gitignore").exists()
    assert (root / "automation").is_dir()
    assert (root / "routine").is_dir()


def test_artifact_dir_creates_run_scoped_directory():
    ctx = build_op_context()
    out = artifact_dir(ctx)
    assert out.is_dir()
    assert out.parent.name == "artifacts"
    # run_id (or "EPHEMERAL" under build_op_context) is the leaf
    assert out.name == ctx.run_id
