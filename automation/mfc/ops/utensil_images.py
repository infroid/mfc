"""Utensil image bytes sync between local web/assets/utensils/* and the
utensil-images Supabase Storage bucket.

Mirrors mfc.ops.images structurally. utensils.photo is the canonical column
that holds the full Storage URL post-migration; the local file is the cache.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Iterable, Literal, Optional

import httpx

from ..clients import sb as sb_client
from ..core import files, log
from ..core.config import Config


BUCKET = "utensil-images"
IMAGE_EXTS = (".jpg", ".jpeg", ".png", ".webp")
LEGACY_PATH_PREFIX = "assets/utensils/"

_HTTP_TIMEOUT_SECONDS = 60.0


@dataclass
class SyncReport:
    uploaded:   int = 0
    downloaded: int = 0
    skipped:    int = 0
    conflicts:  int = 0
    errors:     list[str] = field(default_factory=list)

    def line(self) -> str:
        return (
            f"↓ {self.downloaded} downloaded · "
            f"↑ {self.uploaded} uploaded · "
            f"- {self.skipped} skipped · "
            f"! {self.conflicts} conflicts"
        )


def _service_client(config: Config):
    client = sb_client.service_client(config)
    try:
        client.auth.admin._http_client.timeout = httpx.Timeout(_HTTP_TIMEOUT_SECONDS)
    except Exception:
        pass
    try:
        client.storage._client.timeout = httpx.Timeout(_HTTP_TIMEOUT_SECONDS)
    except Exception:
        pass
    return client


def storage_url(config: Config, *, utensil_id: str, filename: str) -> str:
    base = (config.supabase_url or "").rstrip("/")
    if not base:
        raise RuntimeError("SUPABASE_URL not set")
    return f"{base}/storage/v1/object/public/{BUCKET}/{utensil_id}/{filename}"


def normalize_image_value(config: Config, *, utensil_id: str, value) -> Optional[str]:
    """Convert legacy 'assets/utensils/<id>/file.jpg' -> full Storage URL.
    Pass through full URLs and empty values unchanged.
    """
    if not isinstance(value, str) or not value.strip():
        return value
    if value.startswith("http://") or value.startswith("https://"):
        return value
    if value.startswith(LEGACY_PATH_PREFIX):
        return storage_url(config, utensil_id=utensil_id, filename=Path(value).name)
    # Tolerate "/assets/utensils/..." shape (the leading-slash variant) too.
    if value.startswith("/" + LEGACY_PATH_PREFIX):
        return storage_url(config, utensil_id=utensil_id, filename=Path(value).name)
    return value


def _utensils_dir(config: Config) -> Path:
    return files.utensil_bundles_root(config.repo_root)


def _local_utensil_ids(config: Config) -> list[str]:
    root = _utensils_dir(config)
    if not root.exists():
        return []
    return sorted(p.name for p in root.iterdir() if p.is_dir())


def _local_files_for(config: Config, utensil_id: str) -> dict[str, dict]:
    out: dict[str, dict] = {}
    d = _utensils_dir(config) / utensil_id
    if not d.exists():
        return out
    for p in d.iterdir():
        if p.is_file() and p.suffix.lower() in IMAGE_EXTS:
            out[p.name] = {"mtime": p.stat().st_mtime}
    return out


def _storage_files_for(client, utensil_id: str) -> dict[str, dict]:
    out: dict[str, dict] = {}
    try:
        objects = client.storage.from_(BUCKET).list(utensil_id) or []
    except Exception:
        return out
    for o in objects:
        name = o.get("name") if isinstance(o, dict) else getattr(o, "name", None)
        if not name:
            continue
        if Path(name).suffix.lower() not in IMAGE_EXTS:
            continue
        ts_iso = (
            o.get("updated_at") if isinstance(o, dict) else getattr(o, "updated_at", None)
        )
        ts = _parse_iso_to_ts(ts_iso) if ts_iso else 0.0
        out[name] = {"updated_at_ts": ts}
    return out


def _parse_iso_to_ts(iso: str) -> float:
    if iso.endswith("Z"):
        iso = iso[:-1] + "+00:00"
    try:
        return datetime.fromisoformat(iso).timestamp()
    except Exception:
        return 0.0


CLOCK_SKEW_TOLERANCE_S = 1.0


def _decide(
    *,
    local: Optional[dict],
    remote: Optional[dict],
    direction: str,
) -> Literal["upload", "download", "skip"]:
    if not local and not remote:
        return "skip"
    if local and not remote:
        return "upload" if direction in ("push", "both") else "skip"
    if remote and not local:
        return "download" if direction in ("pull", "both") else "skip"
    delta = local["mtime"] - remote["updated_at_ts"]
    if abs(delta) <= CLOCK_SKEW_TOLERANCE_S:
        return "skip"
    if delta > 0:
        return "upload" if direction in ("push", "both") else "skip"
    return "download" if direction in ("pull", "both") else "skip"


def sync_files(
    config: Config,
    *,
    direction: Literal["pull", "push", "both"],
    only: Optional[list[str]] = None,
) -> SyncReport:
    if direction not in ("pull", "push", "both"):
        raise ValueError(f"invalid direction: {direction!r}")

    client = _service_client(config)
    report = SyncReport()

    if only:
        ids = list(only)
    else:
        local_ids = set(_local_utensil_ids(config))
        try:
            db_rows = client.table("utensils").select("id").execute().data or []
            db_ids = {r["id"] for r in db_rows}
        except Exception as e:
            log.warn(f"could not list DB utensils (continuing with local only): {e}")
            db_ids = set()
        ids = sorted(local_ids | db_ids)

    log.step(f"sync-utensil-images · {direction} · {len(ids)} utensil(s)")

    for uid in ids:
        local_files = _local_files_for(config, uid)
        remote_files = _storage_files_for(client, uid)
        all_names = sorted(set(local_files) | set(remote_files))

        for name in all_names:
            l = local_files.get(name)
            r = remote_files.get(name)
            action = _decide(local=l, remote=r, direction=direction)

            if action == "skip":
                report.skipped += 1
                continue
            if action == "upload":
                try:
                    _upload_one(client, config, uid, name)
                    report.uploaded += 1
                except Exception as e:
                    report.errors.append(f"upload {uid}/{name}: {e}")
            elif action == "download":
                try:
                    _download_one(client, config, uid, name)
                    report.downloaded += 1
                except Exception as e:
                    report.errors.append(f"download {uid}/{name}: {e}")

    log.ok(report.line())
    if report.errors:
        for err in report.errors[:10]:
            log.error(err)
        if len(report.errors) > 10:
            log.warn(f"…and {len(report.errors) - 10} more")
    return report


def _upload_one(client, config: Config, utensil_id: str, filename: str) -> None:
    p = _utensils_dir(config) / utensil_id / filename
    data = p.read_bytes()
    path = f"{utensil_id}/{filename}"
    content_type = _content_type_for(filename)
    client.storage.from_(BUCKET).upload(
        path,
        data,
        file_options={"content-type": content_type, "upsert": "true"},
    )


def _download_one(client, config: Config, utensil_id: str, filename: str) -> None:
    path = f"{utensil_id}/{filename}"
    data = client.storage.from_(BUCKET).download(path)
    p = _utensils_dir(config) / utensil_id / filename
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_bytes(data)


def _content_type_for(filename: str) -> str:
    ext = Path(filename).suffix.lower()
    return {
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".png": "image/png",
        ".webp": "image/webp",
    }.get(ext, "application/octet-stream")


def upload_one_for_utensil(
    config: Config, *, utensil_id: str, local_path: Path
) -> str:
    """One-shot upload helper used by `mfc create-utensil`. Returns the full
    Storage URL of the uploaded object."""
    client = _service_client(config)
    filename = local_path.name
    path = f"{utensil_id}/{filename}"
    data = local_path.read_bytes()
    client.storage.from_(BUCKET).upload(
        path,
        data,
        file_options={"content-type": _content_type_for(filename), "upsert": "true"},
    )
    return storage_url(config, utensil_id=utensil_id, filename=filename)
