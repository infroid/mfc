"""Download a single object from Supabase Storage to artifacts/<run_id>/."""

from pathlib import PurePosixPath

from dagster import Config, OpExecutionContext, job, op

from ..lib.paths import artifact_dir
from ..resources.supabase import SupabaseResource


class DownloadConfig(Config):
    bucket: str = "recipe-images"
    object_path: str


@op
def download(context: OpExecutionContext, config: DownloadConfig, supabase: SupabaseResource) -> str:
    name = PurePosixPath(config.object_path).name
    dest = artifact_dir(context) / name
    if dest.exists():
        raise FileExistsError(f"refusing to overwrite {dest}")
    blob = supabase.client().storage.from_(config.bucket).download(config.object_path)
    dest.write_bytes(blob)
    context.log.info(f"wrote {len(blob)} bytes to {dest}")
    return str(dest)


@job
def storage_fetch_job() -> None:
    download()
