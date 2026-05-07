from __future__ import annotations

from pathlib import Path

from dagster import build_op_context

from routine.jobs.ocr_image import OcrConfig, extract


def test_extract_writes_text_next_to_artifact(tmp_path, monkeypatch):
    monkeypatch.setattr("routine.lib.paths.repo_root", lambda: tmp_path)
    monkeypatch.setattr("pytesseract.image_to_string", lambda _img: "HEMOGLOBIN 14.2")
    img = tmp_path / "report.png"
    img.write_bytes(b"\x89PNG\r\n\x1a\n")  # not actually opened — pytesseract is mocked

    # Pillow's Image.open is called before pytesseract; mock it too.
    class _FakeImg: ...
    monkeypatch.setattr("PIL.Image.open", lambda _p: _FakeImg())

    ctx = build_op_context()
    text = extract(ctx, OcrConfig(image_path=str(img)))
    assert text == "HEMOGLOBIN 14.2"
    out = Path(tmp_path) / "routine" / "artifacts" / ctx.run_id / "report.txt"
    assert out.read_text() == "HEMOGLOBIN 14.2"
